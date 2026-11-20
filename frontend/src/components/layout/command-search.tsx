'use client';

import * as React from 'react';
import { useUiStore, type NavigationTab } from '@/lib/store/ui-store';
import { useWorkspaceStore } from '@/lib/store/workspace-store';
import { useTheme } from 'next-themes';
import {
  Search,
  Compass,
  Video,
  Film,
  FolderKanban,
  Share2,
  Cpu,
  Settings,
  Building2,
  Sun,
  Moon,
  Flame,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface CommandItem {
  id: string;
  category: 'Navigation' | 'Workspaces' | 'Actions';
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
}

export function CommandSearchTrigger({ className }: { className?: string }) {
  const { setCommandSearchOpen } = useUiStore();

  return (
    <button
      type="button"
      onClick={() => setCommandSearchOpen(true)}
      aria-label="Open command palette (Press Command+K or Control+K)"
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border/80 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition-all hover:bg-muted/80 hover:text-foreground cursor-pointer select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
    >
      <Search className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="hidden lg:inline font-normal">Search tools, workspaces, navigation...</span>
      <span className="lg:hidden inline font-normal">Search...</span>
      <kbd className="pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-0.5 rounded border border-border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
        <span className="text-xs">⌘</span>K
      </kbd>
    </button>
  );
}

export function CommandSearchDialog() {
  const { commandSearchOpen, setCommandSearchOpen, setActiveTab, openModal } = useUiStore();
  const { workspaces, setWorkspace, setTenantKey, setApiKey } = useWorkspaceStore();
  const { resolvedTheme, setTheme } = useTheme();

  const [query, setQuery] = React.useState('');
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Global keyboard shortcut
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandSearchOpen(!commandSearchOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandSearchOpen, setCommandSearchOpen]);

  // Focus input when opened
  React.useEffect(() => {
    if (commandSearchOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandSearchOpen]);

  const commands: CommandItem[] = React.useMemo(() => {
    const items: CommandItem[] = [
      // Navigation
      {
        id: 'nav-discovery',
        category: 'Navigation',
        label: 'Discovery & Ingestion',
        description: 'Analyze video, view retention curve and highlight candidates',
        icon: Compass,
        action: () => setActiveTab('discovery'),
      },
      {
        id: 'nav-studio',
        category: 'Navigation',
        label: 'Studio Workspace',
        description: 'Multi-track timeline, canvas preview, and export',
        icon: Video,
        action: () => setActiveTab('studio'),
      },
      {
        id: 'nav-editor',
        category: 'Navigation',
        label: 'Video Editor',
        description: 'Frame inspection, waveform scrub, and subtitle presets',
        icon: Film,
        action: () => setActiveTab('editor'),
      },
      {
        id: 'nav-projects',
        category: 'Navigation',
        label: 'Projects & Library',
        description: 'Workspace project collections and clip sidecars',
        icon: FolderKanban,
        action: () => setActiveTab('projects'),
      },
      {
        id: 'nav-publishing',
        category: 'Navigation',
        label: 'Multi-Platform Publishing',
        description: 'Multi-platform social distribution and receipts',
        icon: Share2,
        action: () => setActiveTab('publishing'),
      },
      {
        id: 'nav-pipeline',
        category: 'Navigation',
        label: 'Processing Pipeline',
        description: 'Job queue status, concurrency, and worker health',
        icon: Cpu,
        action: () => setActiveTab('pipeline'),
      },
      {
        id: 'nav-settings',
        category: 'Navigation',
        label: 'Settings & Telemetry',
        description: 'Governor thresholds, API keys, and preferences',
        icon: Settings,
        action: () => setActiveTab('settings'),
      },
      // Actions
      {
        id: 'act-trending',
        category: 'Actions',
        label: 'Top 10M Viral Discovery',
        description: 'Browse top trending viral videos for 1-click clipping',
        icon: Flame,
        action: () => {
          setActiveTab('discovery');
          openModal('trending-modal');
        },
      },
      {
        id: 'act-theme',
        category: 'Actions',
        label: `Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`,
        description: 'Toggle UI color theme',
        icon: resolvedTheme === 'dark' ? Sun : Moon,
        action: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
      },
    ];

    // Workspaces
    workspaces.forEach((ws: any) => {
      items.push({
        id: `ws-${ws.id}`,
        category: 'Workspaces',
        label: `Switch to: ${ws.name}`,
        description: `Workspace tenancy ID: ${ws.id}`,
        icon: Building2,
        action: () => {
          setWorkspace(ws.id);
          setTenantKey(ws.id);
          if (ws.apiKey) {
            setApiKey(ws.apiKey);
          }
        },
      });
    });

    return items;
  }, [workspaces, resolvedTheme, setActiveTab, setWorkspace, setTenantKey, setApiKey, setTheme, openModal]);

  const filteredCommands = React.useMemo(() => {
    if (!query.trim()) return commands;
    const lower = query.toLowerCase();
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(lower) ||
        c.category.toLowerCase().includes(lower) ||
        c.description?.toLowerCase().includes(lower)
    );
  }, [commands, query]);

  // Reset selected index when list changes
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands]);

  const executeItem = (item: CommandItem) => {
    item.action();
    setCommandSearchOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        executeItem(filteredCommands[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setCommandSearchOpen(false);
    }
  };

  return (
    <Dialog open={commandSearchOpen} onOpenChange={setCommandSearchOpen}>
      <DialogContent
        className="max-w-xl p-0 overflow-hidden bg-popover text-popover-foreground border-border shadow-2xl"
        onClose={() => setCommandSearchOpen(false)}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="w-full bg-transparent px-3 py-3.5 text-sm text-foreground placeholder:text-muted-foreground outline-none border-none focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 rounded-sm text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Command List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filteredCommands.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No matching commands or navigation routes found.
            </div>
          ) : (
            filteredCommands.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => executeItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded-md text-xs cursor-pointer select-none transition-colors text-left',
                    isSelected
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'hover:bg-muted text-foreground'
                  )}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon className={cn('w-4 h-4 shrink-0', isSelected ? 'text-primary-foreground' : 'text-blue-500')} />
                    <div className="truncate">
                      <div className="truncate">{item.label}</div>
                      {item.description && (
                        <div
                          className={cn(
                            'text-[11px] truncate',
                            isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                          )}
                        >
                          {item.description}
                        </div>
                      )}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0 ml-2',
                      isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {item.category}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts helper */}
        <div className="px-3 py-2 border-t border-border/60 bg-muted/20 flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>Esc Close</span>
          </div>
          <span>ClipIntel Command Palette</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
