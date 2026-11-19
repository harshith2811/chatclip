'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ThemeToggleProps {
  className?: string;
  compact?: boolean;
}

export function ThemeToggle({ className, compact = false }: ThemeToggleProps) {
  const [mounted, setMounted] = React.useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Hydration skeleton prevents SSR icon flash
  if (!mounted) {
    return (
      <div
        className={cn(
          compact ? 'w-8 h-8' : 'w-9 h-9',
          'rounded-md bg-muted/40 animate-pulse',
          className
        )}
        aria-hidden="true"
      />
    );
  }

  const isDark = resolvedTheme === 'dark';

  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode (current: ${theme || 'dark'})`}
      className={cn(
        'relative inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer select-none',
        compact ? 'p-1.5' : 'p-2',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
    >
      {isDark ? (
        <Sun className={cn('transition-transform duration-200 rotate-0 scale-100', compact ? 'w-4 h-4' : 'w-4 h-4')} />
      ) : (
        <Moon className={cn('transition-transform duration-200 rotate-0 scale-100', compact ? 'w-4 h-4' : 'w-4 h-4')} />
      )}
    </button>
  );
}
