'use client';

import * as React from 'react';
import { useUiStore, type NavigationTab } from '@/lib/store/ui-store';
import { WorkspaceSwitcher } from './workspace-switcher';
import { ThemeToggle } from './theme-toggle';
import { GovernorPill } from './governor-pill';
import {
  Compass,
  Video,
  Film,
  FolderKanban,
  Share2,
  Cpu,
  Settings,
  Scissors,
  X,
  Menu,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

export function MobileDrawer() {
  const { mobileDrawerOpen, setMobileDrawerOpen, activeTab, setActiveTab } = useUiStore();
  const drawerRef = React.useRef<HTMLDivElement>(null);

  // Close on Escape key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileDrawerOpen) {
        setMobileDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileDrawerOpen, setMobileDrawerOpen]);

  // Lock body scroll when drawer is open
  React.useEffect(() => {
    if (mobileDrawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileDrawerOpen]);

  if (!mobileDrawerOpen) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity animate-in fade-in-0 duration-200"
        onClick={() => setMobileDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer Surface */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation Menu"
        className="fixed inset-y-0 left-0 w-[280px] max-w-[85vw] bg-card border-r border-border p-4 flex flex-col justify-between shadow-2xl z-50 animate-in slide-in-from-left duration-200"
      >
        {/* Top: Brand Header & Close */}
        <div>
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-xs">
                <Scissors className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-sm tracking-tight text-foreground">
                  ClipIntel
                </span>
                <span className="text-[10px] text-muted-foreground">
                  YouTube Clipping Intelligence
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setMobileDrawerOpen(false)}
              aria-label="Close navigation menu"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Workspace Switcher */}
          <div className="py-3 border-b border-border">
            <WorkspaceSwitcher className="w-full" compact={false} />
          </div>

          {/* Navigation Items */}
          <nav aria-label="Mobile Navigation" className="py-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileDrawerOpen(false);
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer text-left',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isActive
                      ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-primary-foreground' : 'text-blue-500')} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Drawer Footer: Telemetry & Theme */}
        <div className="pt-3 border-t border-border space-y-3">
          <div className="flex justify-center">
            <GovernorPill />
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">Color Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileBottomBar() {
  const { activeTab, setActiveTab, toggleMobileDrawer } = useUiStore();

  const primaryActions: { id: NavigationTab | 'menu'; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'discovery', label: 'Discovery', icon: Compass },
    { id: 'studio', label: 'Studio', icon: Video },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'publishing', label: 'Publish', icon: Share2 },
    { id: 'menu', label: 'Menu', icon: Menu },
  ];

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      className="fixed bottom-0 left-0 right-0 h-16 bg-card/95 backdrop-blur-md border-t border-border z-40 px-2 flex items-center justify-around sm:hidden pb-[env(safe-area-inset-bottom,0px)] select-none"
    >
      {primaryActions.map((action) => {
        const Icon = action.icon;
        const isActive = action.id !== 'menu' && activeTab === action.id;

        return (
          <button
            key={action.id}
            type="button"
            onClick={() => {
              if (action.id === 'menu') {
                toggleMobileDrawer();
              } else {
                setActiveTab(action.id as NavigationTab);
              }
            }}
            aria-label={action.label}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex flex-col items-center justify-center min-w-[56px] h-12 rounded-md transition-colors cursor-pointer select-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isActive
                ? 'text-primary font-bold'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className={cn('w-5 h-5 transition-transform duration-150', isActive && 'scale-110')} />
            <span className="text-[10px] mt-0.5 tracking-tight font-medium">
              {action.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
