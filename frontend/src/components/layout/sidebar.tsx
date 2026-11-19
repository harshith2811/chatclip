'use client';

import * as React from 'react';
import { useUiStore, type NavigationTab } from '@/lib/store/ui-store';
import { cn } from '@/lib/utils';
import {
  Compass,
  Video,
  Film,
  FolderKanban,
  Share2,
  Cpu,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface NavItem {
  id: NavigationTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'discovery', label: 'Viral Discovery', icon: Compass },
  { id: 'studio', label: 'Studio Workspace', icon: Video },
  { id: 'editor', label: 'Video Editor', icon: Film },
  { id: 'projects', label: 'Projects Archive', icon: FolderKanban },
  { id: 'publishing', label: 'OmniPost Publishing', icon: Share2 },
  { id: 'pipeline', label: 'Processing Pipeline', icon: Cpu },
  { id: 'settings', label: 'Settings & Telemetry', icon: Settings },
];

export interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const { activeTab, setActiveTab, sidebarCollapsed, toggleSidebar } = useUiStore();

  return (
    <aside
      aria-label="Sidebar Navigation"
      className={cn(
        'hidden md:flex flex-col h-[calc(100vh-3.5rem)] border-r border-border bg-panel/90 backdrop-blur-md select-none transition-all duration-200 justify-between shrink-0',
        sidebarCollapsed ? 'w-16' : 'w-60',
        className
      )}
    >
      <nav aria-label="Main Navigation" className="p-2 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <div key={item.id} className="relative group">
              <button
                type="button"
                onClick={() => setActiveTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer text-left',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className={cn('w-5 h-5 shrink-0', isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground')} />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>

              {/* Accessible Hover & Focus Tooltip in Collapsed Mode */}
              {sidebarCollapsed && (
                <span
                  role="tooltip"
                  className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 text-xs font-medium rounded-md bg-popover text-popover-foreground border border-border shadow-md opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-50 whitespace-nowrap"
                >
                  {item.label}
                </span>
              )}
            </div>
          );
        })}
      </nav>

      {/* Collapse Dock Toggle */}
      <div className="p-2 border-t border-border/80">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
          className={cn(
            'w-full flex items-center justify-center p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
          )}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <div className="flex items-center gap-2 text-xs font-medium">
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse Sidebar</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
