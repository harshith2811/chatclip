import React from 'react';
import { Video, Sparkles, Type } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SUBTITLE_STYLES } from './subtitle-styles';

export interface VerticalPreviewProps {
  safeZonePlatform: 'none' | 'tiktok' | 'reels' | 'shorts';
  setSafeZonePlatform: (platform: 'none' | 'tiktok' | 'reels' | 'shorts') => void;
  resolvedSourceUrl: string | null;
  phoneBgVideoRef: React.RefObject<HTMLVideoElement | null>;
  phoneFgVideoRef: React.RefObject<HTMLVideoElement | null>;
  metadata: any;
  layoutMode: string;
  cropCenterX: number;
  trimStart: number;
  showHeadline: boolean;
  setShowHeadline: (show: boolean) => void;
  headlineText: string;
  setHeadlineText: (text: string) => void;
  activeEditorSubtitle: { phrase: string } | null;
  activeStyle: string;
  setActiveStyle: (styleId: string) => void;
  currentTime: number;
  togglePlay: () => void;
  formatTime: (seconds: number) => string;
}

export const VerticalPreview: React.FC<VerticalPreviewProps> = ({
  safeZonePlatform,
  setSafeZonePlatform,
  resolvedSourceUrl,
  phoneBgVideoRef,
  phoneFgVideoRef,
  metadata,
  layoutMode,
  cropCenterX,
  trimStart,
  showHeadline,
  setShowHeadline,
  headlineText,
  setHeadlineText,
  activeEditorSubtitle,
  activeStyle,
  setActiveStyle,
  currentTime,
  togglePlay,
  formatTime,
}) => {
  return (
    <div className="lg:col-span-3 flex flex-col min-h-0 h-full bg-card border border-border/80 rounded-xl shadow-xs overflow-hidden">
      <div className="py-1.5 px-3 border-b border-border/50 flex items-center justify-between shrink-0 bg-card">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Video className="w-3.5 h-3.5 text-primary" />
          9:16 Preview
        </span>
        {/* Safe Zone Selector */}
        <div className="flex items-center gap-0.5 p-0.5 rounded bg-muted/60 border border-border/60">
          {(['none', 'tiktok', 'reels', 'shorts'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSafeZonePlatform(p)}
              className={cn(
                'px-1.5 py-0.2 rounded text-[8px] font-semibold transition-all cursor-pointer capitalize',
                safeZonePlatform === p
                  ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p === 'none' ? 'Off' : p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 p-2 flex flex-col items-center justify-between overflow-y-auto gap-2 bg-muted/10">
        {/* Smartphone Frame (constrained height) */}
        <div className="relative h-[260px] sm:h-[285px] aspect-[9/16] rounded-[20px] overflow-hidden bg-black border-4 border-zinc-800 shadow-xl flex items-center justify-center select-none shrink-0">
          {/* Dynamic Island */}
          <div className="absolute top-1.5 w-12 h-2 rounded-full bg-zinc-900 z-30 pointer-events-none" />

          {resolvedSourceUrl ? (
            layoutMode === 'blur_background' ? (
              <div
                className="relative w-full h-full flex items-center justify-center overflow-hidden cursor-pointer"
                onClick={togglePlay}
              >
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
              <div
                className="relative w-full h-full overflow-hidden cursor-pointer"
                onClick={togglePlay}
              >
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
            <div className="p-4 text-center text-muted-foreground">
              <Sparkles className="w-5 h-5 mx-auto mb-1 text-primary" />
              <span className="text-[10px] font-mono">1080 x 1920 (9:16)</span>
            </div>
          )}

          {/* Viral Headline Overlay */}
          {showHeadline && headlineText && (
            <div className="absolute top-6 inset-x-2 flex justify-center z-20 pointer-events-none">
              <div className="px-2 py-0.5 rounded bg-black/85 backdrop-blur-md border border-white/15 text-center max-w-[92%] shadow-lg">
                <span className="text-[9px] font-black tracking-wide text-white uppercase line-clamp-2 leading-tight">
                  {headlineText}
                </span>
              </div>
            </div>
          )}

          {/* Real-time Subtitle Animated Caption */}
          {activeEditorSubtitle && (
            <div className="absolute bottom-12 inset-x-2 flex justify-center z-20 pointer-events-none">
              <div
                className={cn(
                  'inline-block px-2 py-0.5 rounded shadow-xl backdrop-blur-md transition-all duration-75 text-center max-w-[92%]',
                  activeStyle === 'bold-yellow' && 'bg-black/90 border border-yellow-400/50 font-black tracking-wider uppercase',
                  activeStyle === 'neon-cyan' && 'bg-slate-950/95 border border-cyan-400/50 font-extrabold uppercase tracking-wide shadow-[0_0_15px_rgba(34,211,238,0.3)]',
                  activeStyle === 'gradient-fire' && 'bg-black/90 border border-orange-500/50 font-black uppercase tracking-wide',
                  activeStyle === 'clean-white' && 'bg-black/80 border border-white/20 font-semibold text-xs text-white'
                )}
              >
                <span
                  className={cn(
                    'text-[10px] sm:text-[11px] font-black',
                    activeStyle === 'bold-yellow' && 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.8)]',
                    activeStyle === 'neon-cyan' && 'text-cyan-300 drop-shadow-[0_0_12px_rgba(34,211,238,0.9)]',
                    activeStyle === 'gradient-fire' && 'text-amber-400 drop-shadow-[0_0_10px_rgba(251,146,60,0.8)]',
                    activeStyle === 'clean-white' && 'text-white'
                  )}
                >
                  {activeEditorSubtitle.phrase}
                </span>
              </div>
            </div>
          )}

          {/* Safe Zone Margins */}
          {safeZonePlatform !== 'none' && (
            <div
              className={cn(
                'absolute inset-0 pointer-events-none border border-dashed m-1 rounded-xl flex flex-col justify-between p-1 z-30',
                safeZonePlatform === 'tiktok' && 'border-cyan-400/40 bg-cyan-500/5',
                safeZonePlatform === 'reels' && 'border-rose-400/40 bg-rose-500/5',
                safeZonePlatform === 'shorts' && 'border-red-400/40 bg-red-500/5'
              )}
            >
              <div className="text-[6px] font-mono text-white/90 bg-black/80 px-1 py-0.2 rounded self-start uppercase font-bold">
                {safeZonePlatform}
              </div>
              <div className="text-[6px] font-mono text-white/90 bg-black/80 px-1 py-0.2 rounded self-end uppercase font-bold">
                Margin
              </div>
            </div>
          )}

          {/* Timecode Badge */}
          <div className="absolute bottom-1.5 left-1.5 bg-black/90 font-mono tnum text-[7px] text-white px-1 py-0.2 rounded border border-white/10 z-20">
            {formatTime(currentTime)}
          </div>
        </div>

        {/* Packaging & Polish Decks */}
        <div className="w-full space-y-1.5 shrink-0">
          {/* Viral Hook Title Input */}
          <div className="p-1.5 rounded-lg bg-card border border-border/70 space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Type className="w-2.5 h-2.5 text-primary" />
                Viral Hook Title
              </label>
              <button
                type="button"
                onClick={() => setShowHeadline(!showHeadline)}
                className={cn(
                  'text-[8px] font-mono px-1 py-0.2 rounded font-bold cursor-pointer transition-colors',
                  showHeadline
                    ? 'bg-primary/20 text-primary border border-primary/40'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                {showHeadline ? 'ON' : 'OFF'}
              </button>
            </div>
            <Input
              value={headlineText}
              onChange={(e) => setHeadlineText(e.target.value)}
              placeholder="Hook headline overlay..."
              disabled={!showHeadline}
              className="font-bold text-xs bg-background h-6 px-2"
            />
          </div>

          {/* Animated Caption Style Selector */}
          <div className="p-1.5 rounded-lg bg-card border border-border/70 space-y-1">
            <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5 text-primary" />
              Caption Style
            </label>
            <div className="grid grid-cols-2 gap-1">
              {SUBTITLE_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => setActiveStyle(style.id)}
                  className={cn(
                    'p-1 rounded border text-left transition-all text-xs font-medium cursor-pointer flex items-center justify-between',
                    activeStyle === style.id
                      ? 'border-primary bg-primary/10 ring-1 ring-primary'
                      : 'border-border/60 bg-muted/20 hover:bg-muted/40 text-muted-foreground'
                  )}
                >
                  <span className="font-bold text-[9px] truncate">{style.name}</span>
                  <span className={cn('text-[7px] px-1 py-0.2 rounded font-bold', style.color)}>
                    Aa
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
