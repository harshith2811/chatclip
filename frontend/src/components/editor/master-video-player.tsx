'use client';

import * as React from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Film,
  MoveHorizontal,
  Wand2,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface MasterVideoPlayerProps {
  playerContainerRef: React.RefObject<HTMLDivElement | null>;
  cropStageRef: React.RefObject<HTMLDivElement | null>;
  sourceVideoRef: React.RefObject<HTMLVideoElement | null>;
  resolvedSourceUrl: string | null;
  metadata: any;
  layoutMode: 'crop' | 'blur_background';
  cropCenterX: number;
  isMuted: boolean;
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  trimStart: number;
  playbackSpeed: number;
  activePreset: string;
  showFramingGuides?: boolean;
  togglePlay: () => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  handleTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  setIsPlaying: (playing: boolean) => void;
  handleCropStageMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleCropStageMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleCropStageMouseUp: () => void;
  applyFramingPreset: (presetKey: string) => void;
  handleSetSpeed: (speed: number) => void;
  setCurrentTime: (time: number) => void;
  syncPlayback: (targetTime: number) => void;
  formatTime: (seconds: number) => string;
  className?: string;
}

export function MasterVideoPlayer({
  playerContainerRef,
  cropStageRef,
  sourceVideoRef,
  resolvedSourceUrl,
  metadata,
  layoutMode,
  cropCenterX,
  isMuted,
  isPlaying,
  currentTime,
  totalDuration,
  trimStart,
  playbackSpeed,
  activePreset,
  showFramingGuides = false,
  togglePlay,
  toggleMute,
  toggleFullscreen,
  handleTimeUpdate,
  setIsPlaying,
  handleCropStageMouseDown,
  handleCropStageMouseMove,
  handleCropStageMouseUp,
  applyFramingPreset,
  handleSetSpeed,
  setCurrentTime,
  syncPlayback,
  formatTime,
  className,
}: MasterVideoPlayerProps) {
  const [isScrubbing, setIsScrubbing] = React.useState(false);
  const progressBarRef = React.useRef<HTMLDivElement | null>(null);

  const progressPercent = totalDuration > 0 ? Math.min(100, Math.max(0, (currentTime / totalDuration) * 100)) : 0;

  const handleSeekFromSlider = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || totalDuration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const target = ratio * totalDuration;
    setCurrentTime(target);
    syncPlayback(target);
  };

  return (
    <div
      ref={playerContainerRef}
      className={cn(
        'relative flex flex-col rounded-2xl overflow-hidden bg-card border border-border/80 shadow-md group',
        className
      )}
    >
      {/* 16:9 Video Display Stage */}
      <div
        ref={cropStageRef}
        onMouseDown={handleCropStageMouseDown}
        onMouseMove={handleCropStageMouseMove}
        onMouseUp={handleCropStageMouseUp}
        className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden cursor-pointer select-none"
        onClick={togglePlay}
      >
        {resolvedSourceUrl ? (
          <video
            ref={sourceVideoRef}
            src={resolvedSourceUrl}
            poster={metadata?.thumbnail_url}
            playsInline
            preload="auto"
            muted={isMuted}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              if (trimStart > 0) el.currentTime = trimStart;
              else el.currentTime = 0.05;
            }}
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => setIsPlaying(false)}
            className="w-full h-full object-contain pointer-events-auto"
          />
        ) : (
          <div className="text-center p-6 text-muted-foreground flex flex-col items-center gap-2">
            <Film className="w-10 h-10 opacity-40 animate-pulse" />
            <p className="text-xs font-medium">Connecting to master high-resolution stream...</p>
          </div>
        )}

        {/* 9:16 Crop Boundary Overlay (Visible when crop mode or guides enabled) */}
        {layoutMode === 'crop' && showFramingGuides && (
          <div className="absolute inset-0 pointer-events-none flex items-center z-10">
            {/* Dark Mask Left */}
            <div
              className="h-full bg-black/60 backdrop-blur-2xs transition-all duration-75"
              style={{
                width: `calc(${cropCenterX * 100}% - ((${cropStageRef.current?.clientHeight || 240}px * 9 / 16) / 2))`,
              }}
            />

            {/* Active 9:16 Framing Bounding Box */}
            <div className="relative h-full aspect-[9/16] border-2 border-primary bg-primary/10 shadow-[0_0_20px_rgba(59,130,246,0.35)] flex flex-col justify-between p-1.5 pointer-events-auto cursor-ew-resize transition-all duration-75">
              <div className="flex items-center justify-between text-[9px] font-mono font-bold text-primary bg-black/90 px-1.5 py-0.5 rounded shadow border border-primary/30">
                <MoveHorizontal className="w-3 h-3 mr-1" />
                <span>9:16 CROP</span>
              </div>

              {/* Rule of Thirds Guide Grid */}
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-25 border border-primary/40">
                <div className="border-r border-b border-primary/30" />
                <div className="border-r border-b border-primary/30" />
                <div className="border-b border-primary/30" />
                <div className="border-r border-b border-primary/30" />
                <div className="border-r border-b border-primary/30" />
                <div className="border-b border-primary/30" />
                <div className="border-r border-b border-primary/30" />
                <div className="border-r border-b border-primary/30" />
                <div />
              </div>

              <div className="self-center bg-black/90 text-white font-mono text-[9px] px-2 py-0.5 rounded border border-white/15">
                X: {Math.round(cropCenterX * 100)}%
              </div>
            </div>

            {/* Dark Mask Right */}
            <div className="flex-1 h-full bg-black/60 backdrop-blur-2xs" />
          </div>
        )}

        {/* Center Floating Play Button on Pause */}
        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-2xs pointer-events-none z-20">
            <div className="w-14 h-14 rounded-full bg-primary/95 text-primary-foreground flex items-center justify-center shadow-2xl scale-100 group-hover:scale-110 transition-transform">
              <Play className="w-7 h-7 ml-1 fill-current" />
            </div>
          </div>
        )}
      </div>

      {/* Integrated Bottom Player Transport Bar (Matching Target Mockup) */}
      <div className="p-3 bg-card/95 backdrop-blur-md border-t border-border/70 flex flex-col gap-2">
        {/* Scrubber Progress Slider */}
        <div
          ref={progressBarRef}
          onClick={handleSeekFromSlider}
          className="relative w-full h-2 bg-muted/60 hover:h-2.5 rounded-full overflow-hidden cursor-pointer transition-all select-none group/bar"
          title="Click to seek"
        >
          {/* Filled Progress Track */}
          <div
            className="h-full bg-primary group-hover/bar:bg-primary/90 transition-all rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
          {/* White Circular Scrubber Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -ml-1.5 w-3 h-3 bg-white rounded-full shadow-md pointer-events-none border border-slate-300"
            style={{ left: `${progressPercent}%` }}
          />
        </div>

        {/* Transport Controls Row */}
        <div className="flex items-center justify-between gap-2 text-xs">
          {/* Left: Play/Pause & Timecode */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={togglePlay}
              className="text-foreground hover:text-primary transition-colors cursor-pointer p-1 rounded-md"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            </button>

            <span className="font-mono text-xs font-semibold text-foreground tracking-tight">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
          </div>

          {/* Right: Volume, Speed Toggle, Fullscreen */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMute}
              className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-1 rounded-md"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-destructive" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {/* Speed Toggle (1x, 1.5x, 2x) */}
            <button
              type="button"
              onClick={() => {
                const speeds = [1, 1.5, 2];
                const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
                handleSetSpeed(speeds[nextIdx]);
              }}
              className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-muted/60 hover:bg-muted text-foreground transition-colors cursor-pointer border border-border/60"
              title="Playback Speed"
            >
              {playbackSpeed}x
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-1 rounded-md"
              title="Fullscreen"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
