'use client';

import * as React from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SUBTITLE_STYLES } from './subtitle-styles';

export interface OutputPreviewCardProps {
  resolvedSourceUrl: string | null;
  phoneBgVideoRef: React.RefObject<HTMLVideoElement | null>;
  phoneFgVideoRef: React.RefObject<HTMLVideoElement | null>;
  metadata: any;
  layoutMode: 'crop' | 'blur_background';
  cropCenterX: number;
  trimStart: number;
  trimDuration: number;
  showHeadline: boolean;
  headlineText: string;
  activeEditorSubtitle: { phrase: string; activeWord?: string } | null;
  activeStyle: string;
  currentTime: number;
  togglePlay: () => void;
  formatTime: (seconds: number) => string;
  aspectMode?: '9:16' | '1:1' | '4:5';
  onAspectChange?: (mode: '9:16' | '1:1' | '4:5') => void;
  className?: string;
}

export function OutputPreviewCard({
  resolvedSourceUrl,
  phoneBgVideoRef,
  phoneFgVideoRef,
  metadata,
  layoutMode,
  cropCenterX,
  trimStart,
  trimDuration,
  showHeadline,
  headlineText,
  activeEditorSubtitle,
  activeStyle,
  currentTime,
  togglePlay,
  formatTime,
  aspectMode = '9:16',
  onAspectChange,
  className,
}: OutputPreviewCardProps) {
  const [selectedAspect, setSelectedAspect] = React.useState<'9:16' | '1:1' | '4:5'>(aspectMode);

  const handleAspectChange = (val: '9:16' | '1:1' | '4:5') => {
    setSelectedAspect(val);
    if (onAspectChange) onAspectChange(val);
  };

  const durationMinSec = React.useMemo(() => {
    const mins = Math.floor(trimDuration / 60);
    const secs = Math.floor(trimDuration % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, [trimDuration]);

  return (
    <Card className={cn('bg-card border border-border/80 shadow-md rounded-2xl flex flex-col overflow-hidden', className)}>
      {/* Header with Title & Aspect Ratio Dropdown */}
      <CardHeader className="py-2.5 px-4 border-b border-border/60 flex flex-row items-center justify-between shrink-0">
        <CardTitle className="text-sm font-bold text-foreground">
          Output Preview
        </CardTitle>

        {/* Dropdown: 9:16 (Shorts) ▾ */}
        <div className="relative">
          <select
            value={selectedAspect}
            onChange={(e) => handleAspectChange(e.target.value as any)}
            className="h-6 pl-2 pr-6 rounded-md bg-muted/60 hover:bg-muted border border-border/70 text-xs font-semibold text-foreground focus:ring-1 focus:ring-primary cursor-pointer appearance-none transition-colors"
          >
            <option value="9:16">9:16 (Shorts)</option>
            <option value="1:1">1:1 (Square)</option>
            <option value="4:5">4:5 (Portrait)</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-1.5 top-1.5 pointer-events-none" />
        </div>
      </CardHeader>

      <CardContent className="p-3 flex-1 flex flex-col items-center justify-center bg-muted/15 min-h-0">
        {/* Smartphone Output Frame (Matching Target Design) */}
        <div
          className={cn(
            'relative rounded-[22px] overflow-hidden bg-black border-4 border-zinc-800 shadow-xl flex items-center justify-center select-none cursor-pointer group shrink-0',
            selectedAspect === '9:16' && 'aspect-[9/16] h-[310px] sm:h-[330px] max-h-full',
            selectedAspect === '1:1' && 'aspect-square h-[280px]',
            selectedAspect === '4:5' && 'aspect-[4/5] h-[300px]'
          )}
          onClick={togglePlay}
        >
          {resolvedSourceUrl ? (
            layoutMode === 'blur_background' ? (
              <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                <video
                  ref={phoneBgVideoRef}
                  src={resolvedSourceUrl}
                  poster={metadata?.thumbnail_url}
                  playsInline
                  preload="auto"
                  muted
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover filter blur-2xl scale-110 brightness-60 pointer-events-none select-none"
                />
                <video
                  ref={phoneFgVideoRef}
                  src={resolvedSourceUrl}
                  poster={metadata?.thumbnail_url}
                  playsInline
                  preload="auto"
                  muted
                  className="relative z-10 w-full h-auto max-h-full object-contain shadow-2xl"
                />
              </div>
            ) : (
              <div className="relative w-full h-full overflow-hidden">
                <video
                  ref={phoneFgVideoRef}
                  src={resolvedSourceUrl}
                  poster={metadata?.thumbnail_url}
                  playsInline
                  preload="auto"
                  muted
                  onLoadedMetadata={(e) => {
                    const el = e.currentTarget;
                    if (trimStart > 0) el.currentTime = trimStart;
                    else el.currentTime = 0.05;
                  }}
                  className="w-full h-full object-cover transition-[object-position] duration-75"
                  style={{
                    objectPosition: `${Math.round(cropCenterX * 100)}% center`,
                  }}
                />
              </div>
            )
          ) : (
            <div className="p-4 text-center text-muted-foreground flex flex-col items-center gap-1.5">
              <Sparkles className="w-6 h-6 text-primary animate-pulse" />
              <span className="text-[10px] font-mono">1080 x 1920 (9:16)</span>
            </div>
          )}

          {/* Top Viral Hook Headline Overlay (Matching Target Mockup) */}
          {showHeadline && headlineText && (
            <div className="absolute top-5 inset-x-3 flex justify-center z-20 pointer-events-none">
              <div className="px-2.5 py-1 rounded bg-black/80 backdrop-blur-md border border-white/10 text-center max-w-[94%] shadow-lg">
                <span className="text-[10px] sm:text-[11px] font-black tracking-wider text-white uppercase line-clamp-2 leading-tight drop-shadow-md">
                  {headlineText}
                </span>
              </div>
            </div>
          )}

          {/* Real-time Subtitle Animated Caption (Matching Target Design: Yellow on Black) */}
          {activeEditorSubtitle && (
            <div className="absolute bottom-12 inset-x-2 flex justify-center z-20 pointer-events-none">
              <div
                className={cn(
                  'inline-block px-2.5 py-1 rounded-md shadow-2xl backdrop-blur-md transition-all duration-75 text-center max-w-[90%]',
                  activeStyle === 'bold-yellow' && 'bg-black/90 border border-yellow-400/50',
                  activeStyle === 'neon-cyan' && 'bg-slate-950/95 border border-cyan-400/50 shadow-[0_0_15px_rgba(34,211,238,0.3)]',
                  activeStyle === 'gradient-fire' && 'bg-black/90 border border-orange-500/50',
                  activeStyle === 'clean-white' && 'bg-black/80 border border-white/20'
                )}
              >
                <span
                  className={cn(
                    'text-[10px] sm:text-[11px] font-black tracking-wider uppercase',
                    activeStyle === 'bold-yellow' && 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.8)]',
                    activeStyle === 'neon-cyan' && 'text-cyan-300 drop-shadow-[0_0_12px_rgba(34,211,238,0.9)]',
                    activeStyle === 'gradient-fire' && 'text-amber-400 drop-shadow-[0_0_10px_rgba(251,146,60,0.8)]',
                    activeStyle === 'clean-white' && 'text-white'
                  )}
                >
                  {activeEditorSubtitle.activeWord || activeEditorSubtitle.phrase}
                </span>
              </div>
            </div>
          )}

          {/* Bottom Duration Badge (e.g. 00:56 - Matching Target Design) */}
          <div className="absolute bottom-2 left-2 bg-black/85 font-mono text-[9px] font-bold text-white px-1.5 py-0.5 rounded border border-white/10 shadow-xs z-20">
            {durationMinSec}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
