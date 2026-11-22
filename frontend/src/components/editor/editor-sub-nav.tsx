'use client';

import * as React from 'react';
import { Film, Type, Crop, Volume2, Share2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EditorSubTab = 'edit' | 'captions' | 'crop' | 'audio' | 'export';

export interface EditorSubNavProps {
  activeTab: EditorSubTab;
  onTabChange: (tab: EditorSubTab) => void;
  className?: string;
}

export function EditorSubNav({ activeTab, onTabChange, className }: EditorSubNavProps) {
  const tabs = [
    { id: 'edit' as EditorSubTab, label: 'Edit', icon: Film },
    { id: 'captions' as EditorSubTab, label: 'Captions', icon: Type },
    { id: 'crop' as EditorSubTab, label: 'Crop & Frame', icon: Crop },
    { id: 'audio' as EditorSubTab, label: 'Audio', icon: Volume2 },
    { id: 'export' as EditorSubTab, label: 'Export', icon: Share2 },
  ];

  return (
    <div className={cn('flex items-center gap-1.5 p-1 rounded-xl bg-card border border-border/80 shadow-2xs shrink-0 w-fit', className)}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={cn(
              'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer',
              isActive
                ? 'bg-primary/10 text-primary border border-primary/25 shadow-2xs font-bold dark:bg-primary/20'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
