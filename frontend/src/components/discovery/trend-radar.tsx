'use client';

import * as React from 'react';
import Image from 'next/image';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Gamepad2,
  Cpu,
  Trophy,
  Atom,
  TrendingUp,
  Eye,
  CheckCircle2,
  ArrowRight,
  Hash,
  Sparkles,
  RefreshCw,
  Flame,
  Inbox,
} from 'lucide-react';
import type { TrendingVideoDescriptor } from '@/types';
import { useTop10mTrending } from '@/lib/hooks/use-discovery';

interface TrendRadarProps {
  onSelectVideo: (videoId: string, url: string, descriptor?: TrendingVideoDescriptor) => void;
  activeVideoId?: string | null;
  liveTrendingVideos?: TrendingVideoDescriptor[];
}

export function TrendRadar({ onSelectVideo, activeVideoId, liveTrendingVideos }: TrendRadarProps) {
  const [filterDomain, setFilterDomain] = React.useState<string>('all');

  // Fetch real trending videos from FastAPI backend
  const { data: fetchedTrending, isLoading } = useTop10mTrending(15);
  const trendingList = React.useMemo(() => {
    if (liveTrendingVideos && liveTrendingVideos.length > 0) {
      return liveTrendingVideos;
    }
    return fetchedTrending || [];
  }, [liveTrendingVideos, fetchedTrending]);

  const filteredVideos = React.useMemo(() => {
    if (filterDomain === 'virality') {
      return trendingList.filter((v) => (v.virality_score ?? 0) >= 80);
    }
    if (filterDomain === 'high_views') {
      return trendingList.filter((v) => (v.view_count ?? 0) >= 10_000_000);
    }
    if (filterDomain === 'tech_science') {
      return trendingList.filter((v) => v.category_id === '28' || v.category_id === '27');
    }
    return trendingList;
  }, [trendingList, filterDomain]);

  const formatNumber = (num?: number): string => {
    if (num == null) return '--';
    if (num === 0) return '0';
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const domainTabs = [
    { id: 'all', name: 'All Trending', badge: `${trendingList.length}` },
    { id: 'virality', name: 'Top Virality (≥80)', badge: 'High Yield' },
    { id: 'high_views', name: '10M+ Mega-Hits', badge: 'High Reach' },
    { id: 'tech_science', name: 'Tech & Science', badge: 'Category 28' },
  ];

  return (
    <Card className="border-border/70 bg-card/60 backdrop-blur-xs overflow-hidden shadow-xs">
      {/* Header with Title & Telemetry info */}
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                <TrendingUp className="w-4 h-4" />
              </span>
              <CardTitle className="text-base sm:text-lg font-bold text-foreground tracking-tight">
                Trending Velocity Radar
              </CardTitle>
              <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/30 text-emerald-500 bg-emerald-500/10">
                Live YouTube API Feeds
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Intelligent niche detection: verified trending videos from Top 10M channels ranked by virality velocity.
            </p>
          </div>

          <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs font-mono text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md border border-border/40">
            <span>Verified Source:</span>
            <span className="text-foreground font-semibold">YouTube Data API v3</span>
          </div>
        </div>

        {/* Domain Navigation Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pt-3 pb-1 no-scrollbar">
          {domainTabs.map((domain) => {
            const isSelected = filterDomain === domain.id;
            return (
              <button
                key={domain.id}
                onClick={() => setFilterDomain(domain.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 border cursor-pointer ${
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary shadow-xs font-semibold'
                    : 'bg-card/40 text-muted-foreground border-border/60 hover:bg-card hover:text-foreground'
                }`}
              >
                <span>{domain.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {domain.badge}
                </span>
              </button>
            );
          })}
        </div>
      </CardHeader>

      {/* Videos List */}
      <CardContent className="p-4 sm:p-5 space-y-4">
        {isLoading && trendingList.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-muted/20 p-3.5 flex gap-3.5">
                <div className="aspect-video w-32 sm:w-36 rounded-lg bg-muted/50 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-28 bg-muted/60 rounded" />
                  <div className="h-4 w-full bg-muted/50 rounded" />
                  <div className="h-3 w-1/2 bg-muted/40 rounded" />
                  <div className="h-6 w-24 bg-muted/30 rounded mt-2" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredVideos.length === 0 ? (
          <div className="py-10 flex flex-col items-center justify-center text-center space-y-2">
            <Inbox className="w-8 h-8 text-muted-foreground opacity-40 mb-1" />
            <p className="text-sm font-semibold text-foreground">No Trending Videos in this Category</p>
            <p className="text-xs text-muted-foreground">Select another filter tab above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredVideos.map((vid, idx) => {
              const isActive = activeVideoId === vid.video_id;
              const rank = idx + 1;
              return (
                <div
                  key={vid.video_id}
                  className={`group relative rounded-xl border transition-all p-3.5 flex flex-col justify-between gap-3 ${
                    isActive
                      ? 'bg-primary/5 border-primary ring-1 ring-primary/40'
                      : 'bg-card/40 border-border/60 hover:border-primary/40 hover:bg-card/80 hover:shadow-xs'
                  }`}
                >
                  <div className="flex gap-3.5">
                    {/* Thumbnail */}
                    <div className="relative aspect-video w-32 sm:w-36 rounded-lg overflow-hidden bg-muted shrink-0 border border-border/40">
                      {vid.thumbnail_url ? (
                        <Image
                          src={vid.thumbnail_url}
                          alt={vid.title}
                          fill
                          sizes="(max-width: 768px) 140px, 160px"
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          unoptimized
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted text-[10px] text-muted-foreground">
                          No Thumbnail
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-80" />
                      {vid.duration_formatted && (
                        <span className="absolute bottom-1.5 right-1.5 text-[10px] font-mono bg-black/90 text-white px-1.5 py-0.5 rounded font-semibold z-10">
                          {vid.duration_formatted}
                        </span>
                      )}
                      <span className="absolute top-1.5 left-1.5 text-[9px] font-mono font-bold bg-background/90 text-foreground px-1.5 py-0.5 rounded border border-border/40 shadow-xs z-10">
                        #{rank}
                      </span>
                    </div>

                    {/* Metadata & Hooks */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {vid.channel_name}
                        </span>
                        <CheckCircle2 className="w-3 h-3 text-blue-500 shrink-0" />
                        {vid.channel_subscribers_formatted && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {vid.channel_subscribers_formatted}
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs sm:text-sm font-bold text-foreground line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                        {vid.title}
                      </h4>

                      <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground font-mono">
                        <span className="flex items-center gap-1 text-foreground font-medium">
                          <Eye className="w-3 h-3 text-primary" />
                          {formatNumber(vid.view_count)}
                        </span>
                        <span>•</span>
                        <span className="text-emerald-500 font-semibold">
                          Score: {vid.virality_score != null ? Math.round(vid.virality_score) : '--'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Clipping Suitability Pill */}
                  {vid.clipping_suitability && (
                    <div className="bg-muted/40 rounded-lg p-2 text-[11px] text-muted-foreground border border-border/30 flex items-start gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                      <p className="line-clamp-2 leading-relaxed">
                        <span className="font-semibold text-foreground">Recommendation: </span>
                        {vid.clipping_suitability}
                      </p>
                    </div>
                  )}

                  {/* Action Bar */}
                  <div className="flex items-center justify-between pt-1">
                    <Badge variant="outline" className="text-[10px] font-mono border-border/70 text-muted-foreground">
                      {vid.license_status ? `License: ${vid.license_status}` : 'License: --'}
                    </Badge>

                    <Button
                      size="sm"
                      variant={isActive ? 'default' : 'outline'}
                      onClick={() =>
                        onSelectVideo(
                          vid.video_id,
                          vid.url || `https://www.youtube.com/watch?v=${vid.video_id}`,
                          vid
                        )
                      }
                      className="h-7 px-3 text-xs gap-1.5 font-semibold group/btn cursor-pointer"
                    >
                      <span>{isActive ? 'Active Target' : 'Analyze & Clip'}</span>
                      <ArrowRight className="w-3 h-3 transition-transform group-hover/btn:translate-x-0.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Viral Topic Quick-Chips from Real Trending Data */}
        {trendingList.length > 0 && (
          <div className="pt-2 border-t border-border/40 flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1 shrink-0">
              <Hash className="w-3 h-3 text-primary" /> Trending Targets:
            </span>
            {trendingList.slice(0, 8).map((vid) => (
              <button
                key={vid.video_id}
                onClick={() =>
                  onSelectVideo(
                    vid.video_id,
                    vid.url || `https://www.youtube.com/watch?v=${vid.video_id}`,
                    vid
                  )
                }
                className="px-2.5 py-0.5 rounded-md text-[11px] font-mono bg-muted/60 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors border border-border/40 shrink-0 cursor-pointer max-w-[180px] truncate"
              >
                {vid.channel_name}: {vid.video_id}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
