'use client';

import * as React from 'react';
import {
  ChevronDown,
  Clock,
  RefreshCw,
  Scissors,
  Sparkles,
  Share2,
  Check,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface EditorHeaderProps {
  effectiveVideoId: string;
  projects: any[];
  totalDuration: number;
  trimDuration: number;
  trimStart: number;
  isExporting: boolean;
  solidHighlights: any[];
  onSelectProject: (videoId: string) => void;
  onApplyExport: () => void;
  onJumpHighlight: (cut: any, idx: number) => void;
  formatTime: (seconds: number) => string;
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({
  effectiveVideoId,
  projects,
  totalDuration,
  trimDuration,
  trimStart,
  isExporting,
  solidHighlights,
  onSelectProject,
  onApplyExport,
  onJumpHighlight,
  formatTime,
}) => {
  const currentProject = projects.find((p: any) => p.video_id === effectiveVideoId);
  const videoTitle = currentProject?.title || "Macbook PROLED Review: It's Not About That";

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card/90 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-border/80 shadow-xs shrink-0">
      {/* Left / Center: Red YouTube Icon + Project Dropdown + Duration & 1080p (Matching Target Mockup) */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/40 border border-border/70 hover:bg-muted/70 transition-colors">
          {/* Red YouTube Icon */}
          <div className="w-5 h-4 rounded bg-red-600 flex items-center justify-center text-white shrink-0 shadow-2xs">
            <div className="w-0 h-0 border-y-[3px] border-y-transparent border-l-[6px] border-l-white ml-0.5" />
          </div>

          {/* Project Title Dropdown */}
          <div className="relative">
            <select
              value={effectiveVideoId}
              onChange={(e) => onSelectProject(e.target.value)}
              className="pr-6 bg-transparent text-xs font-bold text-foreground focus:outline-none cursor-pointer max-w-[220px] sm:max-w-[340px] truncate appearance-none"
            >
              {projects.map((p: any) => (
                <option key={p.video_id} value={p.video_id}>
                  {p.title || `Project ${p.video_id}`}
                </option>
              ))}
              {projects.length === 0 && (
                <option value="hdMszZ2ah5Q">Macbook PROLED Review: It&apos;s Not About That</option>
              )}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-0 top-0.5 pointer-events-none" />
          </div>
        </div>

        {/* Duration & Resolution Metadata (e.g. 15:14.0 • 1080p) */}
        <div className="hidden sm:flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <span>{formatTime(totalDuration)}</span>
          <span>•</span>
          <span className="font-semibold text-foreground">1080p</span>
        </div>
      </div>

      {/* Right: Saved Status Badge + Share Button + Render & Export (Matching Target Mockup) */}
      <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto">
        {/* '✓ Saved' Soft Green Badge */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 font-semibold text-xs shadow-2xs">
          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Saved</span>
        </div>

        {/* Share Button */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 gap-1.5 text-xs font-semibold border-border/80 hover:bg-muted cursor-pointer rounded-xl"
        >
          <Share2 className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Share</span>
        </Button>

        {/* Primary 'Render & Export' Button */}
        <Button
          size="sm"
          onClick={onApplyExport}
          disabled={isExporting}
          className="h-8 px-4 gap-2 text-xs font-bold cursor-pointer shadow-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
        >
          {isExporting ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Scissors className="w-3.5 h-3.5" />
          )}
          <span>Render &amp; Export</span>
        </Button>
      </div>
    </div>
  );
};
