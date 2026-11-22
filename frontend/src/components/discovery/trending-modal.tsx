'use client';

import * as React from 'react';
import Image from 'next/image';
import { useDiscoveryStore } from '@/lib/store/discovery-store';
import { useTop10mTrending } from '@/lib/hooks/use-discovery';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Flame, Eye, Clock, Users, Sparkles, Filter, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TrendingVideoDescriptor } from '@/types';

export interface TrendingModalProps {
  onSelectVideo: (videoId: string, url: string, video?: TrendingVideoDescriptor) => void;
}

export function TrendingModal({ onSelectVideo }: TrendingModalProps) {
  const { isTrendingModalOpen, setIsTrendingModalOpen } = useDiscoveryStore();
  const [filterMode, setFilterMode] = React.useState<string>('all');

  const { data: trendingVideos, isLoading, isError, refetch } = useTop10mTrending(15);

  const filteredVideos = React.useMemo(() => {
    if (!trendingVideos) return [];
    if (filterMode === 'virality') {
      return trendingVideos.filter((v) => (v.virality_score ?? 0) >= 85);
    }
    if (filterMode === 'engagement') {
      return trendingVideos.filter((v) => (v.like_count ?? 0) > 100000 || (v.view_count ?? 0) > 5000000);
    }
    if (filterMode === 'reviewed') {
      return trendingVideos.filter((v) => !v.review_required);
    }
    return trendingVideos;
  }, [trendingVideos, filterMode]);

  const handleSelect = (video: TrendingVideoDescriptor) => {
    setIsTrendingModalOpen(false);
    onSelectVideo(video.video_id, video.url || `https://www.youtube.com/watch?v=${video.video_id}`, video);
  };

  return (
    <Dialog open={isTrendingModalOpen} onOpenChange={setIsTrendingModalOpen}>
      <DialogContent
        className="max-w-4xl max-h-[85vh] p-0 flex flex-col bg-card border-border shadow-2xl overflow-hidden"
        onClose={() => setIsTrendingModalOpen(false)}
      >
        <DialogHeader className="p-4 sm:p-5 border-b border-border pb-3 shrink-0">
          <div className="flex items-center justify-between pr-6">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-500">
                <Flame className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  Top 10M Viral Trending Discovery
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Curated viral content from channels exceeding 10M subscribers, ranked by engagement potential.
                </DialogDescription>
              </div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 pt-3 overflow-x-auto">
            <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0 mr-1" />
            {[
              { id: 'all', label: 'All Trending' },
              { id: 'virality', label: 'Top Virality (≥85)' },
              { id: 'engagement', label: 'High Engagement' },
              { id: 'reviewed', label: 'Pre-Approved' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                  filterMode === tab.id
                    ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </DialogHeader>

        {/* Video Card Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4 animate-pulse">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5">
                  <div className="aspect-video w-full rounded-md bg-muted/50" />
                  <div className="space-y-1.5">
                    <div className="h-3 w-24 bg-muted/60 rounded" />
                    <div className="h-4 w-full bg-muted/50 rounded" />
                    <div className="h-3 w-3/4 bg-muted/40 rounded" />
                  </div>
                  <div className="h-7 w-full bg-muted/30 rounded mt-2" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-amber-500" />
              <p className="text-sm font-semibold text-foreground">Failed to load trending videos</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </Button>
            </div>
          ) : filteredVideos.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No videos found matching the current filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
              {filteredVideos.map((v) => {
                const virality = v.virality_score != null ? Math.round(v.virality_score) : null;
                const viewsFormatted =
                  v.view_count == null
                    ? '--'
                    : v.view_count >= 1_000_000
                    ? `${(v.view_count / 1_000_000).toFixed(1)}M`
                    : v.view_count >= 1_000
                    ? `${Math.round(v.view_count / 1_000)}K`
                    : String(v.view_count);

                return (
                  <div
                    key={v.video_id}
                    className="flex flex-col justify-between rounded-lg border border-border/80 bg-card/60 hover:bg-card hover:border-blue-500/40 transition-all p-3 space-y-2.5 shadow-xs"
                  >
                    {/* Thumbnail & Badges */}
                    <div className="relative aspect-video w-full rounded-md overflow-hidden bg-muted">
                      {v.thumbnail_url ? (
                        <Image
                          src={v.thumbnail_url}
                          alt={v.title}
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground text-xs">
                          Preview Unavailable
                        </div>
                      )}
                      {/* Duration Overlay */}
                      <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/80 text-white font-medium z-10">
                        {v.duration_formatted || (v.duration_seconds != null ? `${Math.round(v.duration_seconds)}s` : '--')}
                      </span>
                      {/* Virality Badge */}
                      <span className="absolute top-1.5 left-1.5 z-10">
                        {virality != null ? (
                          <Badge
                            variant={virality >= 85 ? 'success' : 'default'}
                            className="text-[10px] font-bold px-1.5 py-0 shadow-sm"
                          >
                            Virality: {virality}%
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                            Trending
                          </Badge>
                        )}
                      </span>
                    </div>

                    {/* Metadata Details */}
                    <div className="space-y-1">
                      <h4
                        className="font-semibold text-xs leading-snug line-clamp-2 text-foreground"
                        title={v.title}
                      >
                        {v.title}
                      </h4>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                        <span className="truncate max-w-[120px] font-medium text-foreground">
                          {v.channel_name}
                        </span>
                        {v.channel_subscribers_formatted && (
                          <span className="shrink-0 flex items-center gap-1 font-mono">
                            <Users className="w-3 h-3 text-muted-foreground" />
                            {v.channel_subscribers_formatted}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="w-3 h-3" />
                          {viewsFormatted} views
                        </span>
                        {v.clipping_suitability && (
                          <span className="text-[10px] text-blue-400 font-medium truncate max-w-[140px]">
                            {v.clipping_suitability}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 1-Click Action */}
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleSelect(v)}
                      className="w-full h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Select & Ingest
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
