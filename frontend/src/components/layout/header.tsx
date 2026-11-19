'use client';

import * as React from 'react';
import { useUiStore } from '@/lib/store/ui-store';
import { GovernorPill } from './governor-pill';
import { WorkspaceSwitcher } from './workspace-switcher';
import { ThemeToggle } from './theme-toggle';
import { CommandSearchTrigger } from './command-search';
import { HeaderTaskIndicator } from './header-task-indicator';
import { Menu, Scissors, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface HeaderProps {
  className?: string;
}

export function Header({ className }: HeaderProps) {
  const { toggleMobileDrawer } = useUiStore();

  return (
    <header
      role="banner"
      className={cn(
        'h-14 border-b border-border bg-panel/90 backdrop-blur-md px-2.5 sm:px-4 flex items-center justify-between sticky top-0 z-40 w-full min-w-0 select-none subtle-border',
        className
      )}
    >
      {/* Left: Mobile Drawer Trigger & Brand Mark */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* Hamburger Trigger for Mobile */}
        <button
          type="button"
          onClick={toggleMobileDrawer}
          aria-label="Open navigation menu"
          className="md:hidden flex items-center justify-center w-10 h-10 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Brand Mark: Architectural Sapphire Studio Mark */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground shadow-xs ring-1 ring-primary/40 shrink-0">
            <Scissors className="w-4 h-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight truncate text-foreground font-sans">
                ClipIntel
              </span>
              <span className="hidden sm:inline-block text-[10px] font-mono uppercase bg-primary/10 text-primary border border-primary/25 px-1 py-0 rounded">
                Studio
              </span>
            </div>
            <span className="hidden xl:inline-block text-[11px] text-muted-foreground truncate leading-none">
              YouTube Clipping Intelligence
            </span>
          </div>
        </div>
      </div>

      {/* Center: Command Search Trigger */}
      <div className="flex-1 max-w-xs sm:max-w-md mx-2 sm:mx-4 flex justify-center min-w-0">
        <CommandSearchTrigger className="w-full max-w-[340px]" />
      </div>

      {/* Right: Background Task Indicator, Governor Telemetry, Workspace Switcher, Theme Toggle */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        <HeaderTaskIndicator />

        <div className="hidden lg:flex items-center">
          <GovernorPill />
        </div>

        <WorkspaceSwitcher compact={true} />

        <ThemeToggle compact={true} />
      </div>
    </header>
  );
}
