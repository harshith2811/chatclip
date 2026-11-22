import React from 'react';
import {
  Tv,
  Film,
  MoveHorizontal,
  Play,
  Pause,
  SkipBack,
  Volume2,
  VolumeX,
  Maximize2,
  Wand2,
  Layers,
  Scissors,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface MasterCanvasProps {
  playerContainerRef: React.RefObject<HTMLDivElement | null>;
  cropStageRef: React.RefObject<HTMLDivElement | null>;
  sourceVideoRef: React.RefObject<HTMLVideoElement | null>;
  timelineBarRef: React.RefObject<HTMLDivElement | null>;
  waveformCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  resolvedSourceUrl: string | null;
  metadata: any;
  layoutMode: string;
  cropCenterX: number;
  isMuted: boolean;
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  trimStart: number;
  trimEnd: number;
  trimDuration: number;
  playbackSpeed: number;
  activePreset: string;
  togglePlay: () => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  handleTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  setIsPlaying: (playing: boolean) => void;
  handleCropStageMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleCropStageMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleCropStageMouseUp: () => void;
  applyFramingPreset: (presetKey: string) => void;
  handleStepSeek: (deltaSeconds: number) => void;
  handleSetSpeed: (speed: number) => void;
  handleMarkIn: () => void;
  handleMarkOut: () => void;
  handleSetWindowFromCurrent: (windowSeconds: number) => void;
  handleResetToFullVideo: () => void;
  handleTimelineSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
  setCurrentTime: (time: number) => void;
  syncPlayback: (targetTime: number) => void;
  formatTime: (seconds: number) => string;
}

export const MasterCanvas: React.FC<MasterCanvasProps> = ({
  playerContainerRef,
  cropStageRef,
  sourceVideoRef,
  timelineBarRef,
  waveformCanvasRef,
  resolvedSourceUrl,
  metadata,
  layoutMode,
  cropCenterX,
  isMuted,
  isPlaying,
  currentTime,
  totalDuration,
  trimStart,
  trimEnd,
  trimDuration,
  playbackSpeed,
  activePreset,
  togglePlay,
  toggleMute,
  toggleFullscreen,
  handleTimeUpdate,
  setIsPlaying,
  handleCropStageMouseDown,
  handleCropStageMouseMove,
  handleCropStageMouseUp,
  applyFramingPreset,
  handleStepSeek,
  handleSetSpeed,
  handleMarkIn,
  handleMarkOut,
  handleSetWindowFromCurrent,
  handleResetToFullVideo,
  handleTimelineSeek,
  setCurrentTime,
  syncPlayback,
  formatTime,
}) => {
  return (
    <div className="lg:col-span-5 flex flex-col gap-2 min-h-0 h-full overflow-hidden">
      {/* 16:9 Master Video & Crop Framing Card */}
      <Card
        ref={playerContainerRef}
        className="bg-card text-card-foreground border-border/80 overflow-hidden shadow-xs shrink-0 flex flex-col"
      >
        <CardHeader className="py-1.5 px-3 border-b border-border/50 flex flex-row items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Tv className="w-3.5 h-3.5 text-primary" />
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Original 16:9 Master Video Canvas
            </CardTitle>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono">
            {layoutMode === 'blur_background'
              ? 'Ambient Flowing Blur'
              : `Crop Focus: ${Math.round(cropCenterX * 100)}%`}
          </Badge>
        </CardHeader>

        <CardContent className="p-2 bg-muted/10 flex flex-col items-center">
          {/* Interactive Video Container */}
          <div
            ref={cropStageRef}
            onMouseDown={handleCropStageMouseDown}
            onMouseMove={handleCropStageMouseMove}
            onMouseUp={handleCropStageMouseUp}
            className="relative w-full h-[160px] sm:h-[175px] rounded-lg overflow-hidden bg-black flex items-center justify-center select-none cursor-crosshair group shadow-inner"
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
                onClick={togglePlay}
              />
            ) : (
              <div className="text-center p-4 text-muted-foreground">
                <Film className="w-7 h-7 mx-auto mb-1 opacity-50" />
                <p className="text-xs">Connecting to master video stream...</p>
              </div>
            )}

            {/* Interactive 9:16 Crop Boundary Overlay */}
            {layoutMode === 'crop' && (
              <div className="absolute inset-0 pointer-events-none flex items-center">
                {/* Dark Mask Left */}
                <div
                  className="h-full bg-black/60 backdrop-blur-2xs transition-all duration-75"
                  style={{
                    width: `calc(${cropCenterX * 100}% - ((${cropStageRef.current?.clientHeight || 190}px * 9 / 16) / 2))`,
                  }}
                />

                {/* Active 9:16 Framing Bounding Box */}
                <div className="relative h-full aspect-[9/16] border-2 border-primary bg-primary/10 shadow-[0_0_20px_rgba(59,130,246,0.35)] flex flex-col justify-between p-1 pointer-events-auto cursor-ew-resize transition-all duration-75">
                  <div className="flex items-center justify-between text-[8px] font-mono font-bold text-primary bg-black/90 px-1 py-0.2 rounded shadow border border-primary/30">
                    <MoveHorizontal className="w-2.5 h-2.5 mr-0.5" />
                    <span>9:16 CROP</span>
                  </div>

                  {/* Rule of Thirds Guide Grid */}
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-20 border border-primary/40">
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

                  <div className="self-center bg-black/90 text-white font-mono text-[8px] px-1.5 py-0.2 rounded border border-white/15">
                    X: {Math.round(cropCenterX * 100)}%
                  </div>
                </div>

                {/* Dark Mask Right */}
                <div className="flex-1 h-full bg-black/60 backdrop-blur-2xs" />
              </div>
            )}

            {/* Floating Play/Pause Indicator */}
            {!isPlaying && (
              <div
                onClick={togglePlay}
                className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-2xs cursor-pointer z-20 group"
              >
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
                  <Play className="w-5 h-5 ml-0.5 fill-current" />
                </div>
              </div>
            )}
          </div>

          {/* Dedicated Video Player Transport Deck */}
          <div className="w-full mt-1.5 p-1 rounded-lg bg-card border border-border/70 flex items-center justify-between gap-1 text-xs text-foreground shadow-xs">
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCurrentTime(0);
                  syncPlayback(0);
                }}
                className="h-6 w-6 p-0"
                title="Jump to Start"
              >
                <SkipBack className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleStepSeek(-5)}
                className="h-6 w-6 p-0 font-mono text-[10px]"
                title="Seek -5s"
              >
                -5s
              </Button>
              <Button
                variant={isPlaying ? 'secondary' : 'default'}
                size="sm"
                onClick={togglePlay}
                className="h-6 px-2.5 font-bold text-xs gap-1 cursor-pointer bg-primary text-primary-foreground"
              >
                {isPlaying ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                {isPlaying ? 'Pause' : 'Play'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleStepSeek(5)}
                className="h-6 w-6 p-0 font-mono text-[10px]"
                title="Seek +5s"
              >
                +5s
              </Button>
            </div>

            <div className="font-mono text-[11px] font-bold text-foreground bg-muted/60 px-2 py-0.5 rounded border border-border/60">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </div>

            <div className="flex items-center gap-0.5">
              {[1, 1.5, 2].map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => handleSetSpeed(spd)}
                  className={cn(
                    'h-5 px-1.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer',
                    playbackSpeed === spd
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {spd}x
                </button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleMute}
                className="h-6 w-6 p-0"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX className="w-3 h-3 text-destructive" /> : <Volume2 className="w-3 h-3" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleFullscreen}
                className="h-6 w-6 p-0"
                title="Toggle Fullscreen"
              >
                <Maximize2 className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {/* AI Framing Presets */}
          <div className="w-full mt-1 flex items-center justify-between gap-1 text-[10px] font-mono">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
              <button
                type="button"
                onClick={() => applyFramingPreset('ai_center')}
                className={cn(
                  'px-2 py-0.5 rounded border transition-all cursor-pointer font-bold shrink-0 flex items-center gap-1',
                  activePreset === 'ai_center'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card hover:bg-muted text-muted-foreground border-border/70'
                )}
              >
                <Wand2 className="w-2.5 h-2.5" />
                Smart Center
              </button>
              <button
                type="button"
                onClick={() => applyFramingPreset('left_focus')}
                className={cn(
                  'px-1.5 py-0.5 rounded border transition-all cursor-pointer shrink-0',
                  activePreset === 'left_focus'
                    ? 'bg-primary text-primary-foreground border-primary font-bold'
                    : 'bg-card hover:bg-muted text-muted-foreground border-border/70'
                )}
              >
                Left (30%)
              </button>
              <button
                type="button"
                onClick={() => applyFramingPreset('center')}
                className={cn(
                  'px-1.5 py-0.5 rounded border transition-all cursor-pointer shrink-0',
                  activePreset === 'center'
                    ? 'bg-primary text-primary-foreground border-primary font-bold'
                    : 'bg-card hover:bg-muted text-muted-foreground border-border/70'
                )}
              >
                Center (50%)
              </button>
              <button
                type="button"
                onClick={() => applyFramingPreset('right_focus')}
                className={cn(
                  'px-1.5 py-0.5 rounded border transition-all cursor-pointer shrink-0',
                  activePreset === 'right_focus'
                    ? 'bg-primary text-primary-foreground border-primary font-bold'
                    : 'bg-card hover:bg-muted text-muted-foreground border-border/70'
                )}
              >
                Right (70%)
              </button>
              <button
                type="button"
                onClick={() => applyFramingPreset('blur_background')}
                className={cn(
                  'px-2 py-0.5 rounded border transition-all cursor-pointer shrink-0 flex items-center gap-1',
                  activePreset === 'blur_background'
                    ? 'bg-primary text-primary-foreground border-primary font-bold'
                    : 'bg-card hover:bg-muted text-muted-foreground border-border/70'
                )}
              >
                <Layers className="w-2.5 h-2.5" />
                Ambient Blur
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Acoustic Audio Waveform & Cut Bounds Card */}
      <Card className="bg-card text-card-foreground border-border/80 shadow-xs shrink-0 flex flex-col gap-1.5 p-2.5 pb-2.5 min-h-[125px]">
        <div className="flex items-center justify-between pb-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Scissors className="w-3 h-3 text-primary" />
            Acoustic Waveform & Cut Bounds
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkIn}
              className="h-5 px-1.5 text-[9px] font-mono text-amber-700 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/10 cursor-pointer font-bold"
              title="Shortcut: [I]"
            >
              [ In: {formatTime(trimStart)} ]
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkOut}
              className="h-5 px-1.5 text-[9px] font-mono text-amber-700 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/10 cursor-pointer font-bold"
              title="Shortcut: [O]"
            >
              [ Out: {formatTime(trimEnd)} ]
            </Button>
          </div>
        </div>

        {/* Interactive Acoustic Waveform Canvas */}
        <div
          ref={timelineBarRef}
          onClick={handleTimelineSeek}
          className="relative w-full h-10 bg-muted/20 rounded overflow-hidden border border-border/60 cursor-crosshair select-none"
        >
          <canvas ref={waveformCanvasRef} width={800} height={40} className="w-full h-full block" />

          {/* Shaded Trim Region */}
          <div
            className="absolute top-0 bottom-0 bg-primary/20 border-y-2 border-primary/60 pointer-events-none z-10"
            style={{
              left: `${Math.max(0, Math.min(100, (trimStart / Math.max(0.1, totalDuration)) * 100))}%`,
              width: `${Math.max(0, Math.min(100, ((trimEnd - trimStart) / Math.max(0.1, totalDuration)) * 100))}%`,
            }}
          />

          {/* Playhead Line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-20 pointer-events-none shadow-[0_0_8px_rgba(244,63,94,0.9)]"
            style={{
              left: `${Math.max(0, Math.min(100, (currentTime / Math.max(0.1, totalDuration)) * 100))}%`,
            }}
          >
            <div className="w-2 h-2 bg-rose-500 -ml-0.5 rounded-full shadow-xs" />
          </div>

          {/* Trim In Handle */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-amber-500 z-15 pointer-events-none shadow-sm"
            style={{
              left: `${Math.max(0, Math.min(100, (trimStart / Math.max(0.1, totalDuration)) * 100))}%`,
            }}
          >
            <div className="text-[7px] font-mono bg-amber-500 text-black font-black px-1 py-0.2 rounded -ml-2 -mt-3 absolute shadow">
              IN
            </div>
          </div>

          {/* Trim Out Handle */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-amber-500 z-15 pointer-events-none shadow-sm"
            style={{
              left: `${Math.max(0, Math.min(100, (trimEnd / Math.max(0.1, totalDuration)) * 100))}%`,
            }}
          >
            <div className="text-[7px] font-mono bg-amber-500 text-black font-black px-1 py-0.2 rounded -ml-2 -mt-3 absolute shadow">
              OUT
            </div>
          </div>
        </div>

        {/* Precise Controls & Actions Footer */}
        <div className="flex items-center justify-between pt-1.5 pb-0.5">
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSetWindowFromCurrent(30)}
              className="h-6 text-[10px] font-mono px-2 font-medium cursor-pointer"
            >
              +30s Window
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetToFullVideo}
              className="h-6 text-[10px] font-mono px-2 font-medium cursor-pointer"
            >
              Full Video
            </Button>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-mono tnum">
            <span className="text-muted-foreground text-[11px]">Cut Length:</span>
            <span className="text-primary font-bold bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
              {trimDuration.toFixed(1)}s
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
};
