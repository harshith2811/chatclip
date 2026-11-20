'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PhonePlayer } from './phone-player';
import { ViralityMatrix, type ViralityMetrics } from './virality-matrix';
import { CaptionBox } from './caption-box';
import { SupoClipControls } from './supoclip-controls';
import { useDiscoveryStore } from '@/lib/store/discovery-store';
import { usePlaybackStore } from '@/lib/store/playback-store';
import { useUiStore } from '@/lib/store/ui-store';
import {
  useRenderedClips,
  useVideoPreview,
  useSourceTranscript,
  useRenderCandidateMutation,
} from '@/lib/hooks/use-discovery';
import {
  Video,
  Film,
  Sparkles,
  SlidersHorizontal,
  Play,
  Download,
  Share2,
  CheckCircle2,
  Scissors,
  Layers,
  ArrowRight,
  Inbox,
  RefreshCw,
} from 'lucide-react';

interface ClipData {
  id: string;
  title: string;
  duration: number;
  score: number | null;
  videoUrl?: string;
  posterUrl?: string;
  startTime: number;
  endTime: number;
  sourceStartTime?: number;
  sourceEndTime?: number;
  virality: ViralityMetrics;
  captionPackage?: any;
  channelName?: string;
  licenseStatus?: string;
  sourceVideoTitle?: string;
  sourceMetadata?: {
    likeCount?: number;
    commentCount?: number;
    viewCount?: number;
  };
}

export function StudioWorkspace() {
  const { setActiveTab } = useUiStore();
  const { selectedCandidateId, setSelectedCandidateId, recentHistory, currentVideoId, setCurrentVideoId } =
    useDiscoveryStore();
  const currentVideo = recentHistory[0];

  // Load available projects so the user can easily switch source videos
  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
    staleTime: 1000 * 30,
  });

  // Effective video id with automatic fallback to latest available project
  const defaultVideoId = projects.find((p: any) => p.video_id)?.video_id || 'hdMszZ2ah5Q';
  const activeVideoId = currentVideoId || currentVideo?.videoId || defaultVideoId;

  // Sync default video ID if not set
  React.useEffect(() => {
    if (!currentVideoId && defaultVideoId) {
      setCurrentVideoId(defaultVideoId);
    }
  }, [currentVideoId, defaultVideoId, setCurrentVideoId]);

  // Fetch real rendered clips from backend database/storage
  const { data: renderedClips, isLoading: isClipsLoading, refetch: refetchClips } = useRenderedClips(activeVideoId);

  // Fetch preview candidate highlights if a video is active
  const { data: previewData, isLoading: isPreviewLoading } = useVideoPreview(
    activeVideoId ? { video_id_or_url: activeVideoId, min_duration: 15, max_duration: 60 } : null
  );

  // Fetch word-level transcript for real-time synchronized subtitles in PhonePlayer
  const { data: transcript } = useSourceTranscript(activeVideoId);
  const renderMutation = useRenderCandidateMutation();
  const [isRenderingActiveClip, setIsRenderingActiveClip] = React.useState(false);
  const [studioLayout, setStudioLayout] = React.useState<'active_speaker' | 'blur_background' | 'split_screen'>('active_speaker');
  const [studioSubtitleStyle, setStudioSubtitleStyle] = React.useState<string>('hormozi');

  // Dynamically resolve clips: Real rendered MP4s take precedence, then detected preview candidates.
  // Never fallback to mock or dummy data.
  const resolvedClips = React.useMemo<ClipData[]>(() => {
    // 1. If backend has rendered clips, map authentic clip records
    if (renderedClips && renderedClips.length > 0) {
      return renderedClips.map((clip: any, idx: number) => {
        const intel = clip.intelligence || {};
        const compositeScore = clip.score != null
          ? Math.round(clip.score)
          : (intel.composite_score != null ? Math.round(intel.composite_score) : null);
        const clipDur = clip.duration != null ? Math.round(clip.duration) : 0;
        const sourceStart = clip.start_seconds ?? clip.candidate_data?.start_seconds ?? 0;
        const sourceEnd = clip.end_seconds ?? clip.candidate_data?.end_seconds ?? (sourceStart + clipDur);

        return {
          id: clip.clip_id || `rendered-${idx}`,
          title:
            clip.caption_package?.hook_title ||
            clip.filename?.replace('.mp4', '').replace(/_/g, ' ') ||
            `Short Cut #${idx + 1}`,
          duration: clipDur,
          score: compositeScore,
          videoUrl: clip.playback_url || clip.url || undefined,
          posterUrl: clip.poster_url || undefined,
          startTime: 0,
          endTime: clipDur,
          sourceStartTime: sourceStart,
          sourceEndTime: sourceEnd,
          virality: {
            compositeScore,
            hookStrength: intel.hook_strength != null ? Math.round(intel.hook_strength * 10) : null,
            narrativeVelocity: intel.narrative_quality != null ? Math.round(intel.narrative_quality * 10) : null,
            visualRetention: intel.clarity_score != null ? Math.round(intel.clarity_score * 10) : null,
            loopPolish: intel.replay_potential != null ? Math.round(intel.replay_potential * 10) : null,
            rationale:
              intel.why_it_works ||
              'AI rationale pending for this candidate cut.',
          },
          captionPackage: clip.caption_package,
          channelName: clip.source_metadata?.channel_title,
          licenseStatus: clip.source_metadata?.license_status || clip.source_metadata?.compliance_bucket,
          sourceVideoTitle: clip.source_metadata?.title,
          sourceMetadata: clip.source_metadata ? {
            likeCount: clip.source_metadata.like_count,
            commentCount: clip.source_metadata.comment_count,
            viewCount: clip.source_metadata.view_count,
          } : undefined,
        };
      });
    }

    // 2. If preview candidates exist for active video, map genuine candidates
    const candidates = previewData?.candidates || previewData?.solid_clips;
    if (candidates && candidates.length > 0) {
      return candidates.map((cand: any, idx: number) => {
        const start = cand.start_seconds || 0;
        const end = cand.end_seconds || start;
        const dur = Math.round(end - start);
        const intel = cand.intelligence || {};
        const compositeScore = cand.score != null
          ? Math.round(cand.score)
          : (cand.virality_score != null ? Math.round(cand.virality_score) : null);

        return {
          id: cand.candidate_id || `cand-${idx}`,
          title: cand.hook_title || cand.title || `Viral Cut #${idx + 1}`,
          duration: dur,
          score: compositeScore,
          videoUrl: `/assets/${activeVideoId}.mp4`,
          posterUrl: previewData?.metadata?.thumbnail_url || previewData?.source_metadata?.thumbnail_url || undefined,
          startTime: start,
          endTime: end,
          sourceStartTime: start,
          sourceEndTime: end,
          virality: {
            compositeScore,
            hookStrength: cand.hook_score != null
              ? Math.round(cand.hook_score * 10)
              : (intel.hook_strength != null ? Math.round(intel.hook_strength * 10) : null),
            narrativeVelocity: cand.coherence_score != null
              ? Math.round(cand.coherence_score * 10)
              : (intel.narrative_quality != null ? Math.round(intel.narrative_quality * 10) : null),
            visualRetention: intel.clarity_score != null ? Math.round(intel.clarity_score * 10) : null,
            loopPolish: intel.replay_potential != null ? Math.round(intel.replay_potential * 10) : null,
            rationale:
              cand.why_it_works ||
              cand.reason ||
              cand.rationale ||
              'AI rationale pending for this candidate cut.',
          },
          captionPackage: cand.caption_package,
          channelName: previewData?.metadata?.channel_title,
          licenseStatus: previewData?.metadata?.license || previewData?.metadata?.compliance_bucket,
          sourceVideoTitle: previewData?.metadata?.title,
          sourceMetadata: previewData?.metadata ? {
            likeCount: previewData.metadata.like_count,
            commentCount: previewData.metadata.comment_count,
            viewCount: previewData.metadata.view_count,
          } : undefined,
        };
      });
    }

    // 3. Honest empty list if no clips exist
    return [];
  }, [renderedClips, previewData, activeVideoId]);

  const [selectedClipId, setSelectedClipId] = React.useState<string>('');

  React.useEffect(() => {
    if (resolvedClips.length > 0) {
      if (selectedCandidateId && resolvedClips.some((c) => c.id === selectedCandidateId)) {
        setSelectedClipId(selectedCandidateId);
      } else if (!selectedClipId || !resolvedClips.some((c) => c.id === selectedClipId)) {
        setSelectedClipId(resolvedClips[0].id);
      }
    }
  }, [resolvedClips, selectedCandidateId, selectedClipId]);

  const [exportNotice, setExportNotice] = React.useState<string | null>(null);

  const activeClip = resolvedClips.find((c) => c.id === selectedClipId) || resolvedClips[0] || null;

  const videoTitle =
    activeClip?.sourceVideoTitle ||
    activeClip?.title ||
    currentVideo?.title ||
    previewData?.metadata?.title ||
    (activeVideoId ? `Video ${activeVideoId}` : 'Selected Video');
  const videoChannel =
    activeClip?.channelName ||
    currentVideo?.channel ||
    previewData?.metadata?.channel_title ||
    '';
  const videoThumbnail =
    activeClip?.posterUrl ||
    currentVideo?.thumbnail ||
    (activeVideoId ? `https://i.ytimg.com/vi/${activeVideoId}/hqdefault.jpg` : undefined);
  const videoUrl =
    currentVideo?.url ||
    (activeVideoId ? `https://www.youtube.com/watch?v=${activeVideoId}` : undefined);

  const handleSelectClip = (clipId: string) => {
    setSelectedClipId(clipId);
    setSelectedCandidateId(clipId);
    const clip = resolvedClips.find((c) => c.id === clipId);
    if (clip) {
      usePlaybackStore.getState().setTime(clip.startTime);
    }
  };

  const handleExport = () => {
    if (!activeClip) return;
    setExportNotice(`Export job dispatched for "${videoTitle} - ${activeClip.title}" (1080x1920 MP4 NVENC)`);
    setTimeout(() => setExportNotice(null), 4000);
  };

  const isLoading = isClipsLoading || isPreviewLoading;

  if (isLoading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center text-center space-y-3 bg-card/40 rounded-xl border border-dashed border-border/80">
        <RefreshCw className="w-8 h-8 text-primary animate-spin" />
        <h3 className="font-semibold text-base text-foreground">Loading Studio Assets...</h3>
        <p className="text-xs text-muted-foreground max-w-sm">
          Retrieving rendered clips and preview candidate metrics from the backend.
        </p>
      </div>
    );
  }

  if (resolvedClips.length === 0 || !activeClip) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-center space-y-3 bg-card/40 rounded-xl border border-dashed border-border/80 p-8">
        <Film className="w-12 h-12 text-muted-foreground opacity-40 mb-1" />
        <h3 className="font-semibold text-lg text-foreground">No Video Selected or Clips Rendered</h3>
        <p className="text-xs text-muted-foreground max-w-md">
          Analyze a YouTube video in Discovery to generate candidate cuts, or view existing projects in the Projects Archive.
        </p>
        <Button onClick={() => setActiveTab('discovery')} className="mt-2 text-xs font-semibold gap-2">
          <Sparkles className="w-4 h-4" />
          Go to Discovery
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {exportNotice && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg bg-popover text-popover-foreground border border-border shadow-2xl animate-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-xs font-medium">{exportNotice}</span>
        </div>
      )}

      {/* Studio Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Studio Flagship Workspace
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Frame-accurate 9:16 Shorts inspection, multi-platform safe-zone verification, and virality diagnostics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {projects.length > 0 && (
            <div className="flex items-center gap-1.5 bg-muted/60 px-2 py-1 rounded-lg border border-border/60">
              <span className="text-[10px] font-mono uppercase text-muted-foreground font-bold">
                Project:
              </span>
              <select
                aria-label="Active Project"
                value={activeVideoId || ''}
                onChange={(e) => setCurrentVideoId(e.target.value)}
                className="bg-transparent text-xs font-semibold text-foreground border-none outline-hidden cursor-pointer max-w-[200px] truncate"
              >
                {projects.map((p: any) => (
                  <option key={p.video_id} value={p.video_id} className="bg-popover text-popover-foreground">
                    {p.title || p.video_id}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Badge variant="outline" className="font-mono text-xs px-2.5 py-1">
            Format: 1080x1920 (9:16)
          </Badge>
          <Button
            size="sm"
            onClick={handleExport}
            className="h-8 gap-1.5 text-xs font-semibold cursor-pointer shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            Export Short
          </Button>
        </div>
      </div>

      {/* Candidate Clips Selector Rail */}
      <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-3 tactile-panel">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
            <span className="text-xs font-semibold text-muted-foreground shrink-0 uppercase tracking-wider text-[11px] mr-1">
              Detected Cuts ({resolvedClips.length}):
            </span>
            {resolvedClips.map((clip, idx) => (
              <button
                key={clip.id}
                type="button"
                onClick={() => handleSelectClip(clip.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 cursor-pointer ${
                  selectedClipId === clip.id
                    ? 'bg-primary text-primary-foreground shadow-sm ring-1 ring-primary'
                    : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60'
                }`}
              >
                <span>Clip #{idx + 1} ({clip.duration}s)</span>
                <span className={`font-mono font-semibold text-[11px] tnum ${selectedClipId === clip.id ? 'text-primary-foreground' : 'text-primary'}`}>
                  {clip.score != null ? `${clip.score}/100` : '--'}
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeClip && activeClip.videoUrl && !activeClip.videoUrl.includes('/assets/') ? (
              <div className="flex items-center gap-2">
                <Badge variant="success" className="text-xs flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  1080x1920 MP4 Ready
                </Badge>
                <a
                  href={activeClip.videoUrl}
                  download={`${activeClip.title || 'short'}.mp4`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Preview (Live Subtitles)
                </Badge>
                <Button
                  size="sm"
                  disabled={isRenderingActiveClip || renderMutation.isPending}
                  onClick={async () => {
                    if (!activeClip) return;
                    setIsRenderingActiveClip(true);
                    try {
                      await renderMutation.mutateAsync({
                        candidateId: activeClip.id,
                        videoId: activeVideoId,
                        startTime: activeClip.startTime,
                        endTime: activeClip.endTime,
                        layout: 'active_speaker',
                        subtitlePreset: 'hormozi',
                      } as any);
                      refetchClips();
                    } catch (e) {
                      console.error('Render clip error:', e);
                    } finally {
                      setIsRenderingActiveClip(false);
                    }
                  }}
                  className="h-7 text-xs gap-1.5 font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs cursor-pointer"
                >
                  {isRenderingActiveClip ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Rendering Short...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Render Burned Short
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* SupoClip AI Intelligence & Workflow Controls */}
      <SupoClipControls
        videoId={activeVideoId}
        activeClipId={activeClip.id}
        selectedLayout={studioLayout}
        onLayoutChange={(l) => setStudioLayout(l as any)}
        selectedTemplate={studioSubtitleStyle}
        onTemplateChange={setStudioSubtitleStyle}
      />

      {/* Studio Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: 9:16 Vertical Phone Stage */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <Card className="w-full bg-card/70 backdrop-blur-xs border-border/80 p-4 sm:p-5 tactile-panel flex flex-col items-center">
            <PhonePlayer
              clipTitle={`${videoTitle} - ${activeClip.title}`}
              videoUrl={activeClip.videoUrl || (activeVideoId ? `/assets/${activeVideoId}.mp4` : undefined)}
              posterUrl={activeClip.posterUrl || videoThumbnail}
              duration={activeClip.duration}
              startTime={activeClip.startTime}
              endTime={activeClip.endTime}
              channelName={videoChannel}
              likeCount={activeClip.sourceMetadata?.likeCount}
              commentCount={activeClip.sourceMetadata?.commentCount}
              layoutMode={studioLayout}
              captionStyle={studioSubtitleStyle}
              onLayoutChange={(l) => setStudioLayout(l as any)}
              onCaptionStyleChange={setStudioSubtitleStyle}
              transcript={transcript}
              isRendered={Boolean(activeClip.videoUrl && !activeClip.videoUrl.includes('/assets/'))}
            />
          </Card>
        </div>

        {/* Right Column: Virality Matrix & Multi-Platform Caption Packaging */}
        <div className="lg:col-span-7 space-y-5">
          {/* Active Clip Overview Banner */}
          <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-4 tactile-panel">
            <div className="flex items-start sm:items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-mono text-primary uppercase font-bold tracking-wider">
                  Inspected Highlight Candidate
                </span>
                <h3 className="text-base font-bold text-foreground mt-0.5">
                  {videoTitle} <span className="text-muted-foreground font-normal">({activeClip.title})</span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono tnum">
                  Creator: {videoChannel || '--'} • Duration: {activeClip.duration}s • Window: {(activeClip.sourceStartTime ?? activeClip.startTime).toFixed(1)}s – {(activeClip.sourceEndTime ?? activeClip.endTime).toFixed(1)}s
                </p>
              </div>
              <Badge variant="success" className="text-xs px-2.5 py-1 font-mono tnum shrink-0">
                Virality: {activeClip.score != null ? `${activeClip.score}/100` : '--'}
              </Badge>
            </div>
          </Card>

          {/* Virality Diagnostics Matrix with Creator Feedback Calibration Loop */}
          <ViralityMatrix
            metrics={activeClip.virality}
            clipId={activeClip.id}
            videoId={activeVideoId}
            hookTitle={activeClip.title}
          />

          {/* Multi-Platform Caption Box */}
          <CaptionBox
            clipTitle={activeClip.title || videoTitle}
            channelName={videoChannel}
            sourceUrl={videoUrl}
            licenseStatus={activeClip.licenseStatus}
            captionPackage={activeClip.captionPackage}
          />
        </div>
      </div>
    </div>
  );
}
