import React from 'react';
import { SlidersHorizontal, Film, ChevronDown, Clock, RefreshCw, Scissors, Sparkles } from 'lucide-react';
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
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-card/90 backdrop-blur-md px-3.5 py-2 rounded-xl border border-border/80 shadow-xs shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-foreground">
                Precision Video & Crop Editor
              </h1>
              <Badge variant="outline" className="font-mono text-[9px] uppercase text-primary border-primary/30">
                Studio-Grade
              </Badge>
            </div>
            {/* Active Video Project Dropdown */}
            <div className="flex items-center gap-2">
              <Film className="w-3 h-3 text-primary shrink-0" />
              <div className="relative inline-block">
                <select
                  value={effectiveVideoId}
                  onChange={(e) => onSelectProject(e.target.value)}
                  className="h-5 pl-2 pr-6 rounded bg-muted/60 border border-border/60 text-xs font-semibold text-foreground focus:ring-1 focus:ring-primary cursor-pointer max-w-[240px] sm:max-w-[340px] truncate appearance-none"
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
                <ChevronDown className="w-3 h-3 text-muted-foreground absolute right-1.5 top-1 pointer-events-none" />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">
                • {formatTime(totalDuration)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <Badge
            variant={trimDuration <= 60 ? 'default' : 'secondary'}
            className="font-mono text-xs px-2 py-0.5 flex items-center gap-1"
          >
            <Clock className="w-3 h-3" />
            Trim: {trimDuration.toFixed(1)}s {trimDuration <= 60 ? '(Shorts Ready)' : '(Over 60s)'}
          </Badge>
          <Button
            size="sm"
            onClick={onApplyExport}
            disabled={isExporting}
            className="h-7 px-3 gap-1.5 text-xs font-bold cursor-pointer shadow-xs bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {isExporting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />}
            Apply Crop & Render
          </Button>
        </div>
      </div>

      {/* AI Highlights Quick-Jump Ribbon */}
      {solidHighlights.length > 0 && (
        <div className="p-2.5 rounded-xl bg-card/60 border border-border/60 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider shrink-0 px-1">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>AI Highlights ({solidHighlights.length}):</span>
          </div>
          <div className="flex items-center gap-2">
            {solidHighlights.map((cut: any, idx: number) => {
              const s = cut.start_seconds ?? cut.startTime ?? 0;
              const e = cut.end_seconds ?? cut.endTime ?? s + 35;
              const score = cut.score != null ? Math.round(cut.score) : 95;
              const isCurrent = Math.abs(trimStart - s) < 1.0;
              const cutTitle = cut.title || cut.hook_title || `Cut #${idx + 1}`;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onJumpHighlight(cut, idx)}
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 cursor-pointer border',
                    isCurrent
                      ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                      : 'bg-muted/40 hover:bg-muted border-border/70 text-foreground'
                  )}
                >
                  <span className="font-bold truncate max-w-[160px]">{cutTitle}</span>
                  <span className="font-mono text-[10px] opacity-75">
                    [{formatTime(s)} - {formatTime(e)}]
                  </span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">
                    {score}%
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};
