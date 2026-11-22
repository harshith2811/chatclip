'use client';

import * as React from 'react';
import {
  FileText,
  Sparkles,
  FolderKanban,
  Search,
  Scissors,
  CheckSquare,
  Square,
  ArrowRight,
  ExternalLink,
  Film,
  Zap,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface BottomDeckProps {
  filteredSegments: any[];
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  transcriptSearch: string;
  setTranscriptSearch: (query: string) => void;
  solidHighlights: any[];
  renderedClips: any[];
  onSelectSegment: (seg: any) => void;
  onJumpHighlight: (cut: any, idx: number) => void;
  onSelectRenderedClip: (clip: any) => void;
  onQuickManualClip: () => void;
  onQuickFromTranscript: () => void;
  onQuickAiSuggestions: () => void;
  formatTime: (seconds: number) => string;
  className?: string;
}

export function BottomDeck({
  filteredSegments,
  currentTime,
  trimStart,
  trimEnd,
  transcriptSearch,
  setTranscriptSearch,
  solidHighlights,
  renderedClips,
  onSelectSegment,
  onJumpHighlight,
  onSelectRenderedClip,
  onQuickManualClip,
  onQuickFromTranscript,
  onQuickAiSuggestions,
  formatTime,
  className,
}: BottomDeckProps) {
  const [activeBottomTab, setActiveBottomTab] = React.useState<'transcript' | 'highlights' | 'clips'>('transcript');

  return (
    <div className={cn('grid grid-cols-1 lg:grid-cols-12 gap-3.5', className)}>
      {/* Left Panel: Transcript, AI Highlights, My Clips (8 Cols) */}
      <Card className="lg:col-span-8 bg-card border border-border/80 shadow-md rounded-2xl flex flex-col overflow-hidden">
        {/* Header Tabs: Transcript, AI Highlights (X), My Clips (Y) */}
        <div className="px-4 py-2 border-b border-border/70 flex flex-wrap items-center justify-between gap-3 bg-card shrink-0">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveBottomTab('transcript')}
              className={cn(
                'flex items-center gap-1.5 py-1 text-xs font-bold transition-all border-b-2 cursor-pointer',
                activeBottomTab === 'transcript'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Transcript</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveBottomTab('highlights')}
              className={cn(
                'flex items-center gap-1.5 py-1 text-xs font-bold transition-all border-b-2 cursor-pointer',
                activeBottomTab === 'highlights'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>AI Highlights</span>
              <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0 ml-0.5">
                {solidHighlights.length}
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => setActiveBottomTab('clips')}
              className={cn(
                'flex items-center gap-1.5 py-1 text-xs font-bold transition-all border-b-2 cursor-pointer',
                activeBottomTab === 'clips'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <FolderKanban className="w-3.5 h-3.5 text-blue-500" />
              <span>My Clips</span>
              <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0 ml-0.5">
                {renderedClips.length}
              </Badge>
            </button>
          </div>

          {/* Search Transcript Input */}
          {activeBottomTab === 'transcript' && (
            <div className="relative w-48 sm:w-60">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2 pointer-events-none" />
              <Input
                type="text"
                placeholder="Search transcript..."
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                className="h-7 pl-8 pr-2 text-xs bg-muted/40 rounded-lg"
              />
            </div>
          )}
        </div>

        {/* Tab Content Body */}
        <CardContent className="p-3 flex-1 min-h-[160px] max-h-[260px] overflow-y-auto space-y-1.5 bg-muted/10">
          {/* 1. Transcript List */}
          {activeBottomTab === 'transcript' && (
            <div className="space-y-1">
              {filteredSegments.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No matching transcript sentences found.
                </div>
              ) : (
                filteredSegments.map((seg: any, idx: number) => {
                  const s = seg.start ?? 0;
                  const e = seg.end ?? s + 3;
                  const isInsideTrim = s >= trimStart && e <= trimEnd;
                  const isCurrent = currentTime >= s && currentTime <= e;

                  return (
                    <div
                      key={seg.segment_id || idx}
                      onClick={() => onSelectSegment(seg)}
                      className={cn(
                        'flex items-start gap-2.5 p-2 rounded-xl border transition-all text-xs cursor-pointer select-none',
                        isInsideTrim
                          ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/80 text-foreground shadow-2xs'
                          : isCurrent
                          ? 'bg-muted/80 border-primary/40 text-foreground'
                          : 'bg-card border-border/60 hover:bg-muted/40 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {/* Checkbox Icon */}
                      <button
                        type="button"
                        className="mt-0.5 text-primary cursor-pointer shrink-0"
                        title="Toggle Cut Selection"
                      >
                        {isInsideTrim ? (
                          <CheckSquare className="w-3.5 h-3.5 fill-primary text-primary-foreground" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                      </button>

                      {/* Time Range Badge (e.g. 06:25.8 - 07:22.3) */}
                      <span
                        className={cn(
                          'font-mono text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 border',
                          isInsideTrim
                            ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                            : 'bg-muted text-muted-foreground border-border/60'
                        )}
                      >
                        {formatTime(s)} - {formatTime(e)}
                      </span>

                      {/* Dialogue Line Text */}
                      <p className="flex-1 min-w-0 leading-relaxed font-medium">
                        {seg.text}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* 2. AI Highlights List */}
          {activeBottomTab === 'highlights' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {solidHighlights.map((cut: any, idx: number) => {
                const s = cut.start_seconds ?? cut.startTime ?? 0;
                const e = cut.end_seconds ?? cut.endTime ?? s + 35;
                const score = cut.score != null ? Math.round(cut.score) : 95;
                const cutTitle = cut.title || cut.hook_title || `Viral Highlight #${idx + 1}`;

                return (
                  <div
                    key={idx}
                    onClick={() => onJumpHighlight(cut, idx)}
                    className="p-3 rounded-xl border border-border/80 bg-card hover:border-primary/50 transition-all flex flex-col justify-between gap-2 cursor-pointer shadow-2xs group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                        {cutTitle}
                      </span>
                      <Badge variant="outline" className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                        {score}% Virality
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                      <span>[{formatTime(s)} - {formatTime(e)}]</span>
                      <span className="text-primary font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                        Select Cut <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 3. My Clips List */}
          {activeBottomTab === 'clips' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {renderedClips.length === 0 ? (
                <div className="col-span-2 py-8 text-center text-xs text-muted-foreground">
                  No rendered clips yet. Click &quot;+ Create Clip&quot; to export your first Short!
                </div>
              ) : (
                renderedClips.map((clip: any, idx: number) => (
                  <div
                    key={idx}
                    onClick={() => onSelectRenderedClip(clip)}
                    className="p-2.5 rounded-xl border border-border/80 bg-card hover:border-primary/50 transition-all flex items-center justify-between gap-2 cursor-pointer shadow-2xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                        <Film className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h5 className="font-bold text-xs text-foreground truncate">
                          {clip.title || clip.filename || `Clip #${idx + 1}`}
                        </h5>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {clip.duration ? `${Math.round(clip.duration)}s` : 'Short Ready'}
                        </span>
                      </div>
                    </div>
                    {clip.file_url && (
                      <a
                        href={clip.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                        title="Download MP4"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Right Panel: Quick Actions (4 Cols) */}
      <Card className="lg:col-span-4 bg-card border border-border/80 shadow-md rounded-2xl flex flex-col justify-between overflow-hidden">
        <CardHeader className="py-2.5 px-4 border-b border-border/60 flex flex-row items-center gap-2 shrink-0">
          <Zap className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-bold text-foreground">
            Quick Actions
          </CardTitle>
        </CardHeader>

        <CardContent className="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
          {/* Action 1: Create Manual Clip */}
          <button
            type="button"
            onClick={onQuickManualClip}
            className="w-full p-2.5 rounded-xl border border-border/70 hover:border-primary/60 bg-muted/20 hover:bg-muted/40 transition-all text-left flex items-center gap-3 cursor-pointer group"
          >
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Scissors className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-xs text-foreground group-hover:text-primary transition-colors">
                Create Manual Clip
              </div>
              <div className="text-[11px] text-muted-foreground">
                Set custom start &amp; end time
              </div>
            </div>
          </button>

          {/* Action 2: From Transcript */}
          <button
            type="button"
            onClick={onQuickFromTranscript}
            className="w-full p-2.5 rounded-xl border border-border/70 hover:border-primary/60 bg-muted/20 hover:bg-muted/40 transition-all text-left flex items-center gap-3 cursor-pointer group"
          >
            <div className="w-9 h-9 rounded-xl bg-slate-500/10 text-slate-700 dark:text-slate-300 border border-slate-500/20 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform font-mono font-bold text-xs">
              [-]
            </div>
            <div className="min-w-0">
              <div className="font-bold text-xs text-foreground group-hover:text-primary transition-colors">
                From Transcript
              </div>
              <div className="text-[11px] text-muted-foreground">
                Select text to create a clip
              </div>
            </div>
          </button>

          {/* Action 3: AI Suggestions (Soft Purple Gradient Background - Matching Target Design!) */}
          <button
            type="button"
            onClick={onQuickAiSuggestions}
            className="w-full p-2.5 rounded-xl border border-purple-200 dark:border-purple-800/60 bg-gradient-to-r from-purple-500/10 to-indigo-500/10 hover:from-purple-500/15 hover:to-indigo-500/15 transition-all text-left flex items-center gap-3 cursor-pointer group shadow-2xs"
          >
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-xs text-purple-900 dark:text-purple-200 group-hover:text-purple-700 dark:group-hover:text-purple-300 transition-colors">
                AI Suggestions
              </div>
              <div className="text-[11px] text-purple-700/80 dark:text-purple-300/70">
                Get viral-ready moments
              </div>
            </div>
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
