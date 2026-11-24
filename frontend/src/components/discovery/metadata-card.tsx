'use client';

import * as React from 'react';
import Image from 'next/image';
import type { EnrichedVideoInfo } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Eye, ThumbsUp, MessageSquare, Clock, ExternalLink, ShieldCheck, Sparkles, Video, RefreshCw, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Complete YouTube Data API v3 category mapping
export const YOUTUBE_CATEGORY_MAP: Record<string, string> = {
  '1': 'Film & Animation',
  '2': 'Autos & Vehicles',
  '10': 'Music',
  '15': 'Pets & Animals',
  '17': 'Sports',
  '18': 'Short Movies',
  '19': 'Travel & Events',
  '20': 'Gaming',
  '21': 'Videoblogging',
  '22': 'People & Blogs',
  '23': 'Comedy',
  '24': 'Entertainment',
  '25': 'News & Politics',
  '26': 'Howto & Style',
  '27': 'Education',
  '28': 'Science & Tech',
  '29': 'Nonprofits & Activism',
  '30': 'Movies',
  '31': 'Anime/Animation',
  '32': 'Action/Adventure',
  '43': 'Shows',
  '44': 'Trailers',
};

export interface MetadataCardProps {
  metadata: EnrichedVideoInfo;
  className?: string;
  onRenderClips?: () => void;
  onOpenStudio?: () => void;
  isRendering?: boolean;
  candidatesCount?: number;
  targetClipCount?: number;
  onTargetClipCountChange?: (count: number) => void;
  videoVelocity?: {
    views_per_hour?: number;
    velocity_tier?: string;
    velocity_score?: number;
    engagement_ratio?: number;
  } | null;
}

export function MetadataCard({
  metadata,
  className,
  onRenderClips,
  onOpenStudio,
  isRendering = false,
  candidatesCount = 0,
  targetClipCount = 8,
  onTargetClipCountChange,
  videoVelocity,
}: MetadataCardProps) {
  const viewsFormatted =
    metadata.view_count == null
      ? '--'
      : metadata.view_count >= 1_000_000
      ? `${(metadata.view_count / 1_000_000).toFixed(1)}M`
      : metadata.view_count >= 1_000
      ? `${Math.round(metadata.view_count / 1_000)}K`
      : String(metadata.view_count);

  const likesFormatted =
    metadata.like_count == null
      ? '--'
      : metadata.like_count >= 1_000_000
      ? `${(metadata.like_count / 1_000_000).toFixed(1)}M`
      : metadata.like_count >= 1_000
      ? `${Math.round(metadata.like_count / 1_000)}K`
      : String(metadata.like_count);

  const durationFormatted =
    metadata.duration != null && metadata.duration > 0
      ? `${Math.floor(metadata.duration / 60)}:${Math.floor(metadata.duration % 60).toString().padStart(2, '0')}`
      : '--:--';

  return (
    <Card className={cn('bg-card/70 backdrop-blur-xs border-border/80 shadow-xs overflow-hidden', className)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col md:flex-row gap-4 sm:gap-5 items-start">
          {/* Thumbnail with duration badge */}
          <div className="relative aspect-video w-full md:w-64 lg:w-72 rounded-lg overflow-hidden bg-muted shrink-0 border border-border/60">
            {metadata.thumbnail_url ? (
              <Image
                src={metadata.thumbnail_url}
                alt={metadata.title}
                fill
                sizes="(max-width: 768px) 100vw, 288px"
                className="object-cover"
                unoptimized
                priority
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                Thumbnail Unavailable
              </div>
            )}
            <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded text-xs font-mono bg-black/85 text-white font-semibold z-10">
              {durationFormatted}
            </span>
          </div>

          {/* Details & Telemetry */}
          <div className="flex-1 min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs font-mono">
                ID: {metadata.video_id}
              </Badge>
              {(metadata.category || (metadata as any).category_id) && (
                <Badge variant="secondary" className="text-xs font-semibold px-2 py-0.5">
                  {YOUTUBE_CATEGORY_MAP[String(metadata.category || (metadata as any).category_id)] || metadata.category || (metadata as any).category_id}
                </Badge>
              )}
              {metadata.compliance_bucket && (
                <Badge
                  variant={metadata.compliance_bucket === 'approved' ? 'success' : 'outline'}
                  className="text-xs flex items-center gap-1"
                >
                  <ShieldCheck className="w-3 h-3" />
                  <span className="capitalize">{metadata.compliance_bucket}</span>
                </Badge>
              )}
              {videoVelocity?.velocity_tier && (
                <Badge
                  variant={videoVelocity.velocity_tier === 'VIRAL_BREAKOUT' ? 'destructive' : 'warning'}
                  className="text-xs font-bold gap-1 shadow-xs"
                >
                  <Sparkles className="w-3 h-3 fill-current" />
                  <span>
                    {videoVelocity.velocity_tier === 'VIRAL_BREAKOUT' ? '🔥 Viral Outlier' : '⚡ High Velocity'}
                    {videoVelocity.views_per_hour ? ` (${Math.round(videoVelocity.views_per_hour).toLocaleString()} v/hr)` : ''}
                  </span>
                </Badge>
              )}
            </div>

            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground leading-snug line-clamp-2">
              {metadata.title}
            </h2>

            <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
              <span className="font-semibold text-foreground truncate">
                {metadata.channel_title}
              </span>
              {metadata.channel_handle && (
                <>
                  <span>•</span>
                  <span className="font-mono text-muted-foreground">{metadata.channel_handle}</span>
                </>
              )}
              {metadata.canonical_url && (
                <a
                  href={metadata.canonical_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-400 hover:underline ml-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="sr-only">Open on YouTube</span>
                </a>
              )}
            </div>

            {/* Metrics Ribbon */}
            <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-1 text-xs text-muted-foreground border-t border-border/40">
              <div className="flex items-center gap-1.5 font-mono">
                <Eye className="w-4 h-4 text-blue-500" />
                <span className="font-semibold text-foreground">{viewsFormatted}</span> views
              </div>
              <div className="flex items-center gap-1.5 font-mono">
                <ThumbsUp className="w-4 h-4 text-emerald-500" />
                <span className="font-semibold text-foreground">{likesFormatted}</span> likes
              </div>
              {metadata.comment_count !== undefined && (
                <div className="flex items-center gap-1.5 font-mono">
                  <MessageSquare className="w-4 h-4 text-purple-400" />
                  <span className="font-semibold text-foreground">
                    {metadata.comment_count > 1000
                      ? `${Math.round(metadata.comment_count / 1000)}K`
                      : metadata.comment_count}
                  </span>{' '}
                  comments
                </div>
              )}
              {metadata.published_at && (
                <div className="flex items-center gap-1.5 text-[11px]">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Published {metadata.published_at.slice(0, 10)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Hub Column: Direct Render & Studio Transition */}
          <div className="w-full lg:w-56 shrink-0 flex flex-col justify-between p-3.5 rounded-xl border border-border/70 bg-muted/25 self-stretch space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Badge variant="success" className="text-[11px] px-2 py-0.5 gap-1 font-mono">
                  <Zap className="w-3 h-3 fill-current" />
                  <span>{candidatesCount > 0 ? `${candidatesCount} Cuts Detected` : 'Ready to Clip'}</span>
                </Badge>
                <span className="text-[10px] font-mono text-muted-foreground uppercase font-bold">9:16 Format</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                One-click automatic vertical cropping, speech alignment, and viral packaging.
              </p>
            </div>

            <div className="space-y-2 pt-1">
              <label className="flex items-center justify-between gap-3 text-[11px] font-semibold text-muted-foreground">
                <span>Clips to generate</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={targetClipCount}
                  onChange={(event) => {
                    const next = Math.max(1, Math.min(24, Number(event.target.value) || 1));
                    onTargetClipCountChange?.(next);
                  }}
                  className="h-8 w-16 rounded-md border border-border bg-background px-2 text-center font-mono text-sm font-bold text-foreground"
                  aria-label="Number of clips to generate"
                />
              </label>
              <Button
                type="button"
                size="default"
                disabled={isRendering}
                onClick={onRenderClips}
                className="w-full h-10 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-md transition-all cursor-pointer select-none"
              >
                {isRendering ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 fill-current" />
                )}
                <span>{isRendering ? `Rendering ${targetClipCount} Shorts...` : `Render ${targetClipCount} Clips`}</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenStudio}
                className="w-full h-8 text-xs gap-1.5 font-semibold border-border/80 hover:bg-card cursor-pointer select-none"
              >
                <Video className="w-3.5 h-3.5 text-blue-500" />
                <span>Open in Studio</span>
              </Button>
            </div>

            <div className="text-[10px] font-mono text-muted-foreground flex items-center justify-between pt-1 border-t border-border/40">
              <span>Smart-Crop Gimbal</span>
              <span className="text-emerald-500 font-bold">NVENC Ready</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
