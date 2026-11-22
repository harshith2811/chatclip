'use client';

import * as React from 'react';
import {
  Film,
  Clock,
  Plus,
  X,
  MoreVertical,
  Scissors,
  Check,
  Calendar,
  Share2,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface ClipSettingsCardProps {
  trimStart: number;
  trimEnd: number;
  trimDuration: number;
  currentTime: number;
  clipTitle: string;
  setClipTitle: (title: string) => void;
  tags: string[];
  setTags: React.Dispatch<React.SetStateAction<string[]>>;
  onSetInToCurrent: () => void;
  onSetOutToCurrent: () => void;
  onAdjustStart: (delta: number) => void;
  onAdjustEnd: (delta: number) => void;
  onCreateClip: () => void;
  onAddToTimeline: () => void;
  isCreating?: boolean;
  className?: string;
}

export function ClipSettingsCard({
  trimStart,
  trimEnd,
  trimDuration,
  currentTime,
  clipTitle,
  setClipTitle,
  tags,
  setTags,
  onSetInToCurrent,
  onSetOutToCurrent,
  onAdjustStart,
  onAdjustEnd,
  onCreateClip,
  onAddToTimeline,
  isCreating = false,
  className,
}: ClipSettingsCardProps) {
  const [newTagInput, setNewTagInput] = React.useState('');

  const formatHMS = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newTagInput.trim()) {
      e.preventDefault();
      const clean = newTagInput.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
      if (clean && !tags.includes(clean)) {
        setTags([...tags, clean]);
      }
      setNewTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  return (
    <Card className={cn('bg-card border border-border/80 shadow-md rounded-2xl flex flex-col justify-between overflow-hidden', className)}>
      <CardHeader className="py-2.5 px-4 border-b border-border/60 flex flex-row items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-bold text-foreground">
            Clip Settings
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent className="p-4 flex-1 flex flex-col justify-between gap-3 text-xs">
        <div className="space-y-3">
          {/* Start Time (In) Row */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="font-semibold text-muted-foreground text-[11px] shrink-0">
              Start Time (In)
            </span>
            <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
              <div className="flex items-center justify-between bg-muted/40 border border-border/80 rounded-lg px-2 py-1 font-mono text-[11px] font-semibold text-foreground">
                <span>{formatHMS(trimStart)}</span>
                <div className="flex flex-col gap-0.5 ml-1">
                  <button
                    type="button"
                    onClick={() => onAdjustStart(0.5)}
                    className="text-[9px] hover:text-primary leading-none cursor-pointer"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => onAdjustStart(-0.5)}
                    className="text-[9px] hover:text-primary leading-none cursor-pointer"
                  >
                    ▼
                  </button>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onSetInToCurrent}
                className="h-7 px-2 text-[10px] font-semibold text-primary border-primary/30 hover:bg-primary/10 cursor-pointer shrink-0 whitespace-nowrap"
                title="Set Start to Current Playhead"
              >
                [← Set In
              </Button>
            </div>
          </div>

          {/* End Time (Out) Row */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="font-semibold text-muted-foreground text-[11px] shrink-0">
              End Time (Out)
            </span>
            <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
              <div className="flex items-center justify-between bg-muted/40 border border-border/80 rounded-lg px-2 py-1 font-mono text-[11px] font-semibold text-foreground">
                <span>{formatHMS(trimEnd)}</span>
                <div className="flex flex-col gap-0.5 ml-1">
                  <button
                    type="button"
                    onClick={() => onAdjustEnd(0.5)}
                    className="text-[9px] hover:text-primary leading-none cursor-pointer"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => onAdjustEnd(-0.5)}
                    className="text-[9px] hover:text-primary leading-none cursor-pointer"
                  >
                    ▼
                  </button>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onSetOutToCurrent}
                className="h-7 px-2 text-[10px] font-semibold text-primary border-primary/30 hover:bg-primary/10 cursor-pointer shrink-0 whitespace-nowrap"
                title="Set End to Current Playhead"
              >
                ]→ Set Out
              </Button>
            </div>
          </div>

          {/* Duration Pill Row */}
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-muted-foreground w-24 shrink-0">
              Duration
            </span>
            <div className="flex-1 flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-mono text-xs font-bold">
                <Clock className="w-3.5 h-3.5" />
                <span>{formatHMS(trimDuration)}</span>
              </div>
            </div>
          </div>

          {/* Clip Title Input */}
          <div className="space-y-1">
            <label className="font-semibold text-muted-foreground block text-[11px]">
              Clip Title
            </label>
            <Input
              value={clipTitle}
              onChange={(e) => setClipTitle(e.target.value)}
              placeholder="Enter clip title..."
              className="h-8 text-xs font-semibold bg-background"
            />
          </div>

          {/* Tags Row */}
          <div className="space-y-1.5">
            <label className="font-semibold text-muted-foreground block text-[11px]">
              Tags
            </label>
            <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-lg bg-muted/20 border border-border/70 min-h-[34px]">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-[11px] font-medium text-foreground border border-border/60"
                >
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-destructive cursor-pointer"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                placeholder={tags.length === 0 ? "Add tag (press Enter)..." : "+ tag"}
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                className="flex-1 min-w-[70px] bg-transparent text-[11px] outline-none text-foreground px-1"
              />
            </div>
          </div>
        </div>

        {/* Action Buttons Row (Matching Target Design) */}
        <div className="space-y-2 pt-2">
          {/* Large Primary '+ Create Clip' Button */}
          <Button
            onClick={onCreateClip}
            disabled={isCreating}
            className="w-full h-9 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs gap-2 shadow-xs cursor-pointer rounded-xl"
          >
            <Plus className="w-4 h-4" />
            <span>{isCreating ? 'Creating Short...' : '+ Create Clip'}</span>
          </Button>

          {/* Secondary Action Row: '[+] Add to Timeline' + More Options */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onAddToTimeline}
              className="flex-1 h-8 text-xs font-semibold gap-1.5 border-border/80 hover:bg-muted cursor-pointer rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add to Timeline</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 border-border/80 hover:bg-muted cursor-pointer rounded-lg"
              title="More Options"
            >
              <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
