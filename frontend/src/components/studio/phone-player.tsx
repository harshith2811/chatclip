'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Smartphone,
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircle,
  Bookmark,
  Share2,
  Music2,
  ThumbsUp,
  ThumbsDown,
  Repeat,
  Search,
  Sliders,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlaybackStore } from '@/lib/store/playback-store';

export type SafeZonePlatform = 'none' | 'tiktok' | 'reels' | 'shorts';

function formatSocialMetric(count?: number, fallbackLabel: string = ''): string {
  if (count == null || count < 0) return fallbackLabel;
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return String(count);
}

interface PhonePlayerProps {
  videoUrl?: string;
  posterUrl?: string;
  clipTitle?: string;
  duration?: number;
  startTime?: number;
  endTime?: number;
  channelName?: string;
  likeCount?: number;
  commentCount?: number;
  layoutMode?: 'active_speaker' | 'blur_background' | 'split_screen';
  className?: string;
}

export function PhonePlayer({
  videoUrl,
  posterUrl,
  clipTitle = '',
  duration = 0,
  startTime = 0,
  endTime = 0,
  channelName,
  likeCount,
  commentCount,
  layoutMode = 'active_speaker',
  className,
}: PhonePlayerProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const bgVideoRef = React.useRef<HTMLVideoElement>(null);
  const progressBarRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [relativeTime, setRelativeTime] = React.useState(0);
  const [isMuted, setIsMuted] = React.useState(false);
  const [showNotch, setShowNotch] = React.useState(true);
  const [safeZonePlatform, setSafeZonePlatform] = React.useState<SafeZonePlatform>('none');
  const [activeLayout, setActiveLayout] = React.useState<'active_speaker' | 'blur_background'>(
    layoutMode === 'blur_background' ? 'blur_background' : 'active_speaker'
  );
  const [playbackRate, setPlaybackRate] = React.useState<number>(1);
  const [showCenterFeedback, setShowCenterFeedback] = React.useState(false);

  // Synchronize layout if prop changes
  React.useEffect(() => {
    if (layoutMode === 'blur_background') {
      setActiveLayout('blur_background');
    }
  }, [layoutMode]);

  const syncBgVideo = React.useCallback(() => {
    if (bgVideoRef.current && videoRef.current) {
      if (Math.abs(bgVideoRef.current.currentTime - videoRef.current.currentTime) > 0.12) {
        bgVideoRef.current.currentTime = videoRef.current.currentTime;
      }
      if (videoRef.current.paused && !bgVideoRef.current.paused) {
        bgVideoRef.current.pause();
      } else if (!videoRef.current.paused && bgVideoRef.current.paused) {
        bgVideoRef.current.play().catch(() => {});
      }
    }
  }, []);

  // Sync playhead state when clip bounds, title, or source changes
  React.useEffect(() => {
    setRelativeTime(0);
    setIsPlaying(false);
    usePlaybackStore.getState().setTime(startTime);

    const video = videoRef.current;
    if (video) {
      video.pause();
      try {
        const canSeek = Number.isFinite(video.duration) && video.duration >= startTime;
        video.currentTime = canSeek ? startTime : 0;
      } catch {}
    }
  }, [startTime, endTime, duration, clipTitle, videoUrl]);

  // Explicit lifecycle cleanup for HTMLVideoElement
  React.useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, []);

  const togglePlay = React.useCallback(() => {
    if (!videoRef.current) {
      setIsPlaying((prev) => !prev);
      return;
    }

    if (isPlaying) {
      videoRef.current.pause();
      if (bgVideoRef.current) bgVideoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (relativeTime >= duration - 0.1) {
        setRelativeTime(0);
        try {
          const canSeek = Number.isFinite(videoRef.current.duration) && videoRef.current.duration >= startTime;
          videoRef.current.currentTime = canSeek ? startTime : 0;
          if (bgVideoRef.current) bgVideoRef.current.currentTime = canSeek ? startTime : 0;
        } catch {}
      }
      videoRef.current.play().catch(() => {});
      if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }

    setShowCenterFeedback(true);
    setTimeout(() => setShowCenterFeedback(false), 500);
  }, [isPlaying, relativeTime, duration, startTime]);

  const stepTime = React.useCallback(
    (seconds: number) => {
      const newRel = Math.max(0, Math.min(duration, relativeTime + seconds));
      setRelativeTime(newRel);
      usePlaybackStore.getState().setTime(startTime + newRel);

      if (videoRef.current) {
        try {
          const canSeek = Number.isFinite(videoRef.current.duration) && videoRef.current.duration >= startTime;
          videoRef.current.currentTime = canSeek ? startTime + newRel : newRel;
        } catch {}
      }
    },
    [duration, relativeTime, startTime]
  );

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = pos * duration;
    setRelativeTime(targetTime);
    usePlaybackStore.getState().setTime(startTime + targetTime);

    if (videoRef.current) {
      try {
        const canSeek = Number.isFinite(videoRef.current.duration) && videoRef.current.duration >= startTime;
        videoRef.current.currentTime = canSeek ? startTime + targetTime : targetTime;
      } catch {}
    }
  };

  const cycleSpeed = () => {
    const nextSpeed = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextSpeed);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextSpeed;
    }
  };

  // Keyboard navigation shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        stepTime(e.shiftKey ? -1.0 : -0.1);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        stepTime(e.shiftKey ? 1.0 : 0.1);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setIsMuted((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, stepTime]);

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const vTime = videoRef.current.currentTime;
    const isAbsolute = startTime > 0 && vTime >= startTime;
    const rel = isAbsolute ? vTime - startTime : vTime;

    if (rel >= duration) {
      videoRef.current.pause();
      if (bgVideoRef.current) bgVideoRef.current.pause();
      setIsPlaying(false);
      setRelativeTime(duration);
      usePlaybackStore.getState().setTime(startTime + duration);
    } else {
      setRelativeTime(rel);
      usePlaybackStore.getState().setTime(startTime + rel);
    }
  };

  const formatTimecode = (sec: number) => {
    const safeSec = Math.max(0, sec);
    const m = Math.floor(safeSec / 60);
    const s = Math.floor(safeSec % 60);
    const ms = Math.floor((safeSec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div className={cn('flex flex-col items-center w-full max-w-sm mx-auto select-none space-y-4', className)}>
      {/* Platform Safe-Zone & Layout Mode Switcher Toolbar */}
      <div className="w-full flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs px-1 gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px] font-mono">
            Layout:
          </span>
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/60 border border-border/60">
            <button
              type="button"
              onClick={() => setActiveLayout('active_speaker')}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer',
                activeLayout === 'active_speaker'
                  ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Smart Crop
            </button>
            <button
              type="button"
              onClick={() => setActiveLayout('blur_background')}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer',
                activeLayout === 'blur_background'
                  ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Ambient Blur
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto">
          <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px] font-mono">
            Safe Zone:
          </span>
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/60 border border-border/60">
            {(
              [
                { id: 'none', label: 'Off' },
                { id: 'tiktok', label: 'TikTok' },
                { id: 'reels', label: 'Reels' },
                { id: 'shorts', label: 'Shorts' },
              ] as const
            ).map((platform) => (
              <button
                key={platform.id}
                type="button"
                onClick={() => setSafeZonePlatform(platform.id)}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer font-mono',
                  safeZonePlatform === platform.id
                    ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/40'
                )}
              >
                {platform.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Titanium Smartphone Chassis (iPhone 16 Pro 9:16 Aspect) */}
      <div
        ref={containerRef}
        className="relative w-[285px] sm:w-[320px] aspect-[9/16] rounded-[48px] bg-slate-900 p-[8px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.6)] ring-1 ring-white/20 border border-slate-800"
      >
        {/* Dynamic Island Pill */}
        {showNotch && (
          <div className="absolute top-3.5 left-1/2 -translate-x-1/2 w-22 h-4.5 bg-black rounded-full z-40 flex items-center justify-between px-2.5 shadow-md border border-white/5">
            <div className="w-2 h-2 rounded-full bg-slate-900 ring-1 ring-slate-800" />
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        )}

        {/* Video Canvas Container */}
        <div className="relative w-full h-full rounded-[40px] overflow-hidden bg-black flex items-center justify-center">
          {videoUrl ? (
            activeLayout === 'blur_background' ? (
              <div
                className="relative w-full h-full flex items-center justify-center overflow-hidden cursor-pointer"
                onClick={togglePlay}
              >
                {/* Synchronized Flowing Blurred 9:16 Canvas Background */}
                <video
                  ref={bgVideoRef}
                  src={videoUrl}
                  playsInline
                  muted
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover filter blur-2xl scale-110 brightness-60 pointer-events-none select-none"
                />
                {/* Sharp Center Uncropped 16:9 Letterbox Video */}
                <video
                  ref={videoRef}
                  src={videoUrl}
                  poster={posterUrl}
                  playsInline
                  muted={isMuted}
                  onTimeUpdate={() => {
                    handleTimeUpdate();
                    syncBgVideo();
                  }}
                  onPlay={syncBgVideo}
                  onPause={syncBgVideo}
                  onEnded={() => setIsPlaying(false)}
                  className="relative z-10 w-full h-auto max-h-full object-contain shadow-2xl"
                />
              </div>
            ) : (
              <video
                ref={videoRef}
                src={videoUrl}
                poster={posterUrl}
                playsInline
                muted={isMuted}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => setIsPlaying(false)}
                className="w-full h-full object-cover cursor-pointer"
                style={{ objectPosition: 'center center' }}
                onClick={togglePlay}
              />
            )
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-zinc-950 text-muted-foreground select-none">
              <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-3 text-primary">
                <Play className="w-5 h-5 ml-0.5" />
              </div>
              <p className="text-xs font-semibold text-foreground">Media Playback Stage</p>
              <p className="text-[11px] text-muted-foreground mt-1 max-w-[200px]">
                {clipTitle ? `Preview for: ${clipTitle}` : 'Select a clip or run a render task to preview 9:16 video playback.'}
              </p>
            </div>
          )}

          {/* Center Play/Pause Floating Feedback */}
          {showCenterFeedback && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-35 animate-in zoom-in-75 fade-out duration-300">
              <div className="w-16 h-16 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-white shadow-2xl border border-white/20">
                {isPlaying ? <Play className="w-7 h-7 fill-white ml-1" /> : <Pause className="w-7 h-7 fill-white" />}
              </div>
            </div>
          )}

          {/* Idle Center Play Button */}
          {videoUrl && !isPlaying && !showCenterFeedback && (
            <div
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-2xs cursor-pointer z-20 group"
            >
              <div className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
                <Play className="w-6 h-6 ml-1 fill-current" />
              </div>
            </div>
          )}

          {/* =========================================================================
              PLATFORM OVERLAY: TIKTOK (Safe Zone Protected)
             ========================================================================= */}
          {safeZonePlatform === 'tiktok' && (
            <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between p-3.5 text-white">
              {/* TikTok Top Nav: Padded below Dynamic Island */}
              <div className="flex items-center justify-between pt-7 px-2 text-[12px] font-semibold text-white/90 drop-shadow">
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-black/50">
                  LIVE
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-white/60">Following</span>
                  <span className="border-b-2 border-white pb-0.5 font-bold">For You</span>
                </div>
                <Search className="w-4 h-4 text-white/90" />
              </div>

              {/* TikTok Bottom & Right Action Rail */}
              <div className="flex items-end justify-between pb-3">
                <div className="flex-1 max-w-[70%] space-y-1 drop-shadow">
                  {channelName && (
                    <p className="font-bold text-xs">
                      {`@${channelName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'creator'}`}
                    </p>
                  )}
                  <p className="text-[11px] text-white/90 line-clamp-2 leading-tight">
                    {clipTitle || 'Short Cut'}
                  </p>
                  <div className="flex items-center gap-1.5 text-[10px] text-white/80 pt-0.5">
                    <Music2 className="w-3 h-3 animate-spin" />
                    <span className="truncate">
                      {channelName ? `${channelName} - Original Audio` : 'Original Sound'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-center space-y-3 pb-1 shrink-0 drop-shadow">
                  <div className="relative w-8 h-8 rounded-full border border-white overflow-hidden bg-gradient-to-tr from-purple-500 to-pink-500 flex items-center justify-center text-[10px] font-bold">
                    {channelName ? channelName.slice(0, 2).toUpperCase() : 'YT'}
                  </div>
                  <div className="flex flex-col items-center">
                    <Heart className="w-5 h-5 fill-rose-500 text-rose-500" />
                    <span className="text-[9px] font-mono tnum">{formatSocialMetric(likeCount, 'Like')}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <MessageCircle className="w-5 h-5 fill-white/20" />
                    <span className="text-[9px] font-mono tnum">{formatSocialMetric(commentCount, 'Comment')}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <Bookmark className="w-5 h-5 fill-amber-400 text-amber-400" />
                    <span className="text-[9px] font-mono tnum">Save</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <Share2 className="w-5 h-5" />
                    <span className="text-[9px] font-mono tnum">Share</span>
                  </div>
                </div>
              </div>

              {/* Subtle Dashed Safe Zone Frame */}
              <div className="absolute inset-x-2 top-10 bottom-14 border border-dashed border-rose-500/30 rounded-[32px] pointer-events-none" />
            </div>
          )}

          {/* =========================================================================
              PLATFORM OVERLAY: INSTAGRAM REELS (Safe Zone Protected)
             ========================================================================= */}
          {safeZonePlatform === 'reels' && (
            <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between p-3.5 text-white">
              <div className="flex items-center justify-between pt-7 px-2">
                <span className="font-bold text-sm tracking-tight drop-shadow">Reels</span>
                <span className="text-[10px] font-mono bg-black/50 px-1.5 py-0.5 rounded border border-white/10">1080x1920</span>
              </div>

              <div className="flex items-end justify-between pb-3">
                <div className="flex-1 max-w-[72%] space-y-1.5 drop-shadow">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 p-[1px]">
                      <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-[9px] font-bold">
                        {channelName ? channelName.slice(0, 2).toUpperCase() : 'IG'}
                      </div>
                    </div>
                    {channelName && (
                      <span className="font-semibold text-xs">
                        {`@${channelName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'creator'}`}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/95 line-clamp-2 leading-tight">
                    {clipTitle || 'Short Cut'}
                  </p>
                  <div className="flex items-center gap-1.5 text-[10px] text-white/80">
                    <Music2 className="w-3 h-3" />
                    <span className="truncate">
                      {channelName ? `${channelName} - Original Audio` : 'Original Audio'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-center space-y-3 pb-1 drop-shadow">
                  <div className="flex flex-col items-center">
                    <Heart className="w-5 h-5 fill-rose-500 text-rose-500" />
                    <span className="text-[9px] font-mono tnum">{formatSocialMetric(likeCount, 'Like')}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <MessageCircle className="w-5 h-5" />
                    <span className="text-[9px] font-mono tnum">{formatSocialMetric(commentCount, 'Comment')}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <Share2 className="w-5 h-5" />
                    <span className="text-[9px] font-mono tnum">Share</span>
                  </div>
                </div>
              </div>

              <div className="absolute inset-x-2 top-10 bottom-14 border border-dashed border-purple-500/30 rounded-[32px] pointer-events-none" />
            </div>
          )}

          {/* =========================================================================
              PLATFORM OVERLAY: YOUTUBE SHORTS (Safe Zone Protected)
             ========================================================================= */}
          {safeZonePlatform === 'shorts' && (
            <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between p-3.5 text-white">
              <div className="flex items-center justify-between pt-7 px-2">
                <span className="text-[11px] font-bold uppercase tracking-wider bg-red-600 px-2 py-0.5 rounded shadow">
                  Shorts
                </span>
                <Search className="w-4 h-4 text-white drop-shadow" />
              </div>

              <div className="flex items-end justify-between pb-3">
                <div className="flex-1 max-w-[70%] space-y-1.5 drop-shadow">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-red-600 flex items-center justify-center text-[10px] font-bold">
                      {channelName ? channelName.slice(0, 2).toUpperCase() : 'YT'}
                    </div>
                    {channelName && (
                      <span className="font-semibold text-xs">
                        {`@${channelName.replace(/[^a-zA-Z0-9_]/g, '')}`}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/95 line-clamp-2 leading-tight">
                    {clipTitle || 'Short Cut'}
                  </p>
                </div>

                <div className="flex flex-col items-center space-y-3 pb-1 drop-shadow">
                  <div className="flex flex-col items-center">
                    <ThumbsUp className="w-5 h-5 fill-white/20" />
                    <span className="text-[9px] font-mono tnum">{formatSocialMetric(likeCount, 'Like')}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <ThumbsDown className="w-5 h-5" />
                    <span className="text-[9px]">Dislike</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <MessageCircle className="w-5 h-5" />
                    <span className="text-[9px] font-mono tnum">{formatSocialMetric(commentCount, 'Comment')}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <Share2 className="w-5 h-5" />
                    <span className="text-[9px]">Share</span>
                  </div>
                </div>
              </div>

              <div className="absolute inset-x-2 top-10 bottom-14 border border-dashed border-red-500/30 rounded-[32px] pointer-events-none" />
            </div>
          )}

          {/* Integrated Thin Bottom Scrub Indicator on Video */}
          <div className="absolute bottom-2 left-4 right-4 z-30">
            <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden backdrop-blur-xs">
              <div
                className="h-full bg-primary transition-all duration-75"
                style={{ width: `${Math.min(100, (relativeTime / Math.max(0.1, duration)) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Modern Unified Playback Control Capsule */}
      <div className="w-full space-y-2.5 bg-card/60 border border-border/70 rounded-2xl p-3 shadow-xs backdrop-blur-xs">
        {/* Interactive Scrub Line with Precision Timestamps */}
        <div className="space-y-1">
          <div
            ref={progressBarRef}
            onClick={handleProgressBarClick}
            className="group relative w-full h-2 bg-muted rounded-full cursor-pointer overflow-hidden flex items-center"
          >
            <div
              className="h-full bg-primary transition-all duration-100 group-hover:bg-primary/90"
              style={{ width: `${Math.min(100, (relativeTime / Math.max(0.1, duration)) * 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono tnum text-muted-foreground px-0.5">
            <span className="font-semibold text-foreground">{formatTimecode(relativeTime)}</span>
            <span>{formatTimecode(duration)}</span>
          </div>
        </div>

        {/* Floating Media Controls Dock */}
        <div className="flex items-center justify-between pt-1">
          {/* Left: Notch & Speed Toggles */}
          <div className="flex items-center gap-1.5">
            <Button
              variant={showNotch ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowNotch(!showNotch)}
              className="h-7 text-[10px] px-2 font-mono gap-1 cursor-pointer"
              title="Toggle iPhone Dynamic Island"
            >
              <Smartphone className="w-3 h-3" />
              Notch
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={cycleSpeed}
              className="h-7 text-[10px] px-2 font-mono cursor-pointer"
              title="Cycle Playback Speed"
            >
              {playbackRate}x
            </Button>
          </div>

          {/* Center: Stepping & Play/Pause Button */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => stepTime(-5)}
              className="h-8 w-8 p-0 rounded-full cursor-pointer hover:bg-muted"
              title="Rewind 5s"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => stepTime(-0.1)}
              className="h-8 w-8 p-0 rounded-full cursor-pointer hover:bg-muted"
              title="Step Back 0.1s"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <Button
              size="sm"
              onClick={togglePlay}
              className="h-10 w-10 p-0 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 ml-0.5 fill-current" />}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => stepTime(0.1)}
              className="h-8 w-8 p-0 rounded-full cursor-pointer hover:bg-muted"
              title="Step Forward 0.1s"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => stepTime(5)}
              className="h-8 w-8 p-0 rounded-full cursor-pointer hover:bg-muted"
              title="Forward 5s"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Right: Audio Volume Button */}
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMuted(!isMuted)}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground cursor-pointer rounded-full"
              title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-500" /> : <Volume2 className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
