'use client';

import * as React from 'react';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { MobileDrawer, MobileBottomBar } from './mobile-nav';
import { CommandSearchDialog } from './command-search';
import { GlobalTaskModal } from './global-task-modal';
import { cn } from '@/lib/utils';


export interface ShellProps {
  children: React.ReactNode;
  className?: string;
}

export function Shell({ children, className }: ShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground antialiased w-full max-w-full overflow-x-hidden">
      {/* 1. WCAG 2.2 AA Skip to Content Bypass Block */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
      >
        Skip to content
      </a>

      {/* 2. Global Brand Header */}
      <Header />

      {/* 3. Core Operational Body: Collapsible Desktop Dock & Accessible Main Surface */}
      <div className="flex flex-1 min-w-0 overflow-hidden">
        <Sidebar />
        <main
          id="main-content"
          role="main"
          tabIndex={-1}
          className={cn(
            'flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6 pb-20 sm:pb-6 focus:outline-none',
            className
          )}
        >
          {children}
        </main>
      </div>

      {/* 4. Mobile Navigation Overlays */}
      <MobileDrawer />
      <MobileBottomBar />

      {/* 5. Global Command Search Modal */}
      <CommandSearchDialog />

      {/* 6. Global Task Modal (Active Foreground Render Pipeline) */}
      <GlobalTaskModal />
    </div>

  );
}
