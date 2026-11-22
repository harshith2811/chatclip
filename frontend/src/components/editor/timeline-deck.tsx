'use client';

import * as React from 'react';
import {
  Undo2,
  Redo2,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Scissors,
  Trash2,
  SlidersHorizontal,
  Clock,
  Film,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface TimelineDeckProps {
  timelineBarRef: React.RefObject<HTMLDivElement | null>;
  waveformCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  trimStart: number;
  trimEnd: number;
  trimDuration: number;
  togglePlay: () => void;
  handleTimelineSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleMarkIn: () => void;
  handleMarkOut: () => void;
  handleStepSeek: (deltaSeconds: number) => void;
  setCurrentTime: (time: number) => void;
  syncPlayback: (targetTime: number) => void;
  onResetToFullVideo: () => void;
  formatTime: (seconds: number) => string;
  className?: string;
}

export function TimelineDeck({
  timelineBarRef,
  waveformCanvasRef,
  isPlaying,
  currentTime,
  totalDuration,
  trimStart,
  trimEnd,
  trimDuration,
  togglePlay,
  handleTimelineSeek,
  handleMarkIn,
  handleMarkOut,
  handleStepSeek,
  setCurrentTime,
  syncPlayback,
  onResetToFullVideo,
  formatTime,
  className,
}: TimelineDeckProps) {
  const [zoomLevel, setZoomLevel] = React.useState<number>(100);

  const formatPillTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  // Generate dynamic ruler tick marks around the current timeline
  const rulerTicks = React.useMemo(() => {
    if (totalDuration <= 0) return [];
    // Display ~10 evenly spaced markers
    const stepSec = Math.max(10, Math.round(totalDuration / 12));
    const ticks: { time: number; label: string; percent: number }[] = [];
    for (let t = 0; t <= totalDuration; t += stepSec) {
      const mins = Math.floor(t / 60);
      const secs = Math.floor(t % 60);
      ticks.push({
        time: t,
        label: `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`,
        percent: (t / totalDuration) * 100,
      });
    }
    return ticks;
  }, [totalDuration]);

  const inPercent = totalDuration > 0 ? Math.max(0, Math.min(100, (trimStart / totalDuration) * 100)) : 0;
  const outPercent = totalDuration > 0 ? Math.max(0, Math.min(100, (trimEnd / totalDuration) * 100)) : 100;
  const playheadPercent = totalDuration > 0 ? Math.max(0, Math.min(100, (currentTime / totalDuration) * 100)) : 0;

  return (
    <Card className={cn('bg-card border border-border/80 shadow-md rounded-2xl flex flex-col overflow-hidden', className)}>
      {/* 1. Full-Width Editing Toolbar (Matching Target Mockup) */}
      <div className="py-2.5 px-4 border-b border-border/70 flex flex-wrap items-center justify-between gap-3 bg-card shrink-0">
        {/* Left: Undo & Redo */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg"
            title="Undo"
          >
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg"
            title="Redo"
          >
            <Redo2 className="w-4 h-4" />
          </Button>
        </div>

        {/* Center: Jump In, Prominent Blue Play/Pause, Jump Out */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCurrentTime(trimStart);
              syncPlayback(trimStart);
            }}
            className="h-8 w-8 p-0 text-foreground hover:text-primary cursor-pointer rounded-lg"
            title="Jump to In Point"
          >
            <SkipBack className="w-4 h-4" />
          </Button>

          {/* Prominent Circular Blue Play Button */}
          <button
            type="button"
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center shadow-md transition-transform hover:scale-105 active:scale-95 cursor-pointer"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 ml-0.5 fill-current" />
            )}
          </button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCurrentTime(trimEnd);
              syncPlayback(trimEnd);
            }}
            className="h-8 w-8 p-0 text-foreground hover:text-primary cursor-pointer rounded-lg"
            title="Jump to Out Point"
          >
            <SkipForward className="w-4 h-4" />
          </Button>
        </div>

        {/* Center Tools: Set In, Set Out, Cut, Delete */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkIn}
            className="h-8 px-3 text-xs font-semibold border-border/80 hover:bg-muted cursor-pointer rounded-lg"
            title="Set In Point (I)"
          >
            Set In (I)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkOut}
            className="h-8 px-3 text-xs font-semibold border-border/80 hover:bg-muted cursor-pointer rounded-lg"
            title="Set Out Point (O)"
          >
            Set Out (O)
          </Button>

          <div className="h-4 w-px bg-border/80 mx-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Quick Cut Action: splits at current playhead
              if (currentTime > trimStart && currentTime < trimEnd) {
                handleMarkOut();
              }
            }}
            className="h-8 px-2.5 text-xs font-medium gap-1 text-foreground hover:text-primary cursor-pointer rounded-lg"
            title="Cut at Playhead"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Cut</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onResetToFullVideo}
            className="h-8 px-2.5 text-xs font-medium gap-1 text-destructive hover:bg-destructive/10 cursor-pointer rounded-lg"
            title="Reset Trim Range"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </Button>
        </div>

        {/* Right: Zoom Level Slider */}
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(50, z - 25))}
            className="hover:text-foreground cursor-pointer text-sm font-bold"
          >
            —
          </button>
          <div className="w-20 h-1.5 bg-muted/60 rounded-full relative cursor-pointer">
            <div
              className="h-full bg-primary rounded-full"
              style={{ width: `${(zoomLevel / 200) * 100}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(200, z + 25))}
            className="hover:text-foreground cursor-pointer text-sm font-bold"
          >
            +
          </button>
          <span className="w-10 text-right">{zoomLevel}%</span>
        </div>
      </div>

      {/* 2. Timeline Track & Acoustic Waveform Deck */}
      <CardContent className="p-4 pt-3 flex flex-col gap-2 bg-muted/10">
        <div className="flex items-center justify-between text-xs font-bold text-foreground">
          <div className="flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-primary" />
            <span>Timeline</span>
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
            <span>Cut Length: <strong className="text-primary font-bold">{trimDuration.toFixed(1)}s</strong></span>
          </div>
        </div>

        {/* Top Timecode Ruler */}
        <div className="relative w-full h-4 border-b border-border/60 select-none overflow-hidden text-[9px] font-mono text-muted-foreground">
          {rulerTicks.map((tick, idx) => (
            <div
              key={idx}
              className="absolute top-0 flex flex-col items-center -translate-x-1/2"
              style={{ left: `${tick.percent}%` }}
            >
              <span>{tick.label}</span>
              <div className="w-px h-1 bg-border/80 mt-0.5" />
            </div>
          ))}
        </div>

        {/* Full-Width Acoustic Waveform Interactive Container */}
        <div
          ref={timelineBarRef}
          onClick={handleTimelineSeek}
          className="relative w-full h-16 bg-muted/30 rounded-xl overflow-visible border border-border/70 cursor-crosshair select-none my-1 shadow-inner"
        >
          <canvas ref={waveformCanvasRef} width={1200} height={64} className="w-full h-full block rounded-xl" />

          {/* Highlighted Cut Selection Range (Vibrant Blue Area) */}
          <div
            className="absolute top-0 bottom-0 bg-primary/20 border-y-2 border-primary/70 pointer-events-none z-10"
            style={{
              left: `${inPercent}%`,
              width: `${Math.max(0.5, outPercent - inPercent)}%`,
            }}
          />

          {/* Left Handle: Blue Line + Blue In Pill Marker (Matching Mockup: 06:25.800) */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-blue-500 z-20 pointer-events-none shadow-sm"
            style={{ left: `${inPercent}%` }}
          >
            <div className="absolute -top-6 -translate-x-1/2 px-2 py-0.5 rounded-full bg-blue-600 text-white font-mono text-[9px] font-black shadow-md border border-white/20 whitespace-nowrap">
              {formatPillTime(trimStart)}
            </div>
          </div>

          {/* Right Handle: Red Line + Red Out Pill Marker (Matching Mockup: 07:22.300) */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-rose-500 z-20 pointer-events-none shadow-sm"
            style={{ left: `${outPercent}%` }}
          >
            <div className="absolute -top-6 -translate-x-1/2 px-2 py-0.5 rounded-full bg-rose-600 text-white font-mono text-[9px] font-black shadow-md border border-white/20 whitespace-nowrap">
              {formatPillTime(trimEnd)}
            </div>
          </div>

          {/* Current Playhead Scrubber */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-30 pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.9)]"
            style={{ left: `${playheadPercent}%` }}
          >
            <div className="w-2.5 h-2.5 bg-amber-400 -ml-1 rounded-full shadow-md" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
