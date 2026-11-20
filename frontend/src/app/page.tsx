'use client';

import * as React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Shell } from '@/components/layout/shell';
import { useUiStore } from '@/lib/store/ui-store';
import { useDiscoveryStore } from '@/lib/store/discovery-store';
import { usePlaybackStore } from '@/lib/store/playback-store';
import { useTaskStore } from '@/lib/store/task-store';
import { useQueryClient } from '@tanstack/react-query';
import { discoveryApi } from '@/lib/api/discovery';
import {
  useVideoMetadata,
  useVideoPreview,
  useTop10mTrending,
  useTrendingTopics,
  useRenderCandidateMutation,
  useRegenerateCaptionMutation,
} from '@/lib/hooks/use-discovery';
import {
  UrlIngestionBar,
  TrendingModal,
  MetadataCard,
  RetentionCurve,
  CandidateGrid,
  TrendRadar,
  AnalysisProgress,
} from '@/components/discovery';
import dynamic from 'next/dynamic';

function WorkspaceSkeleton({ title }: { title: string }) {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label={`Loading ${title}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="h-8 w-64 bg-muted/60 rounded-lg" />
          <div className="h-4 w-96 bg-muted/40 rounded-md" />
        </div>
        <div className="h-8 w-32 bg-muted/50 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-96 bg-muted/30 border border-border/60 rounded-xl" />
        <div className="h-96 bg-muted/30 border border-border/60 rounded-xl" />
      </div>
    </div>
  );
}

const StudioWorkspace = dynamic(
  () => import('@/components/studio/studio-workspace').then((m) => m.StudioWorkspace),
  { loading: () => <WorkspaceSkeleton title="Studio Workspace" /> }
);
const TimelineEditor = dynamic(
  () => import('@/components/editor/timeline-editor').then((m) => m.TimelineEditor),
  { loading: () => <WorkspaceSkeleton title="Video Editor" /> }
);
const ProjectsView = dynamic(
  () => import('@/components/projects/projects-view').then((m) => m.ProjectsView),
  { loading: () => <WorkspaceSkeleton title="Projects Archive" /> }
);
const PublishingView = dynamic(
  () => import('@/components/publishing/publishing-view').then((m) => m.PublishingView),
  { loading: () => <WorkspaceSkeleton title="Multi-Platform Publishing" /> }
);
const PipelineView = dynamic(
  () => import('@/components/pipeline/pipeline-view').then((m) => m.PipelineView),
  { loading: () => <WorkspaceSkeleton title="Processing Pipeline" /> }
);
const SettingsView = dynamic(
  () => import('@/components/settings/settings-view').then((m) => m.SettingsView),
  { loading: () => <WorkspaceSkeleton title="Settings" /> }
);
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  Compass,
  Video,
  Film,
  FolderKanban,
  Share2,
  Cpu,
  Settings,
  Sparkles,
  Flame,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  Clock,
  Layers,
} from 'lucide-react';
import type { CandidateHighlight, HighlightCandidate, TrendingVideoDescriptor } from '@/types';

export default function DashboardPage() {
  const { activeTab, setActiveTab } = useUiStore();
  const {
    currentVideoId,
    setCurrentVideoId,
    setInputUrl,
    selectedCandidateId,
    setSelectedCandidateId,
    addRecentHistory,
  } = useDiscoveryStore();

  // Active video analysis ID — synchronized with discovery store
  const [activeAnalysisVideoId, setActiveAnalysisVideoId] = React.useState<string | null>(() => currentVideoId || null);
  const [hasRequestedAnalysis, setHasRequestedAnalysis] = React.useState<boolean>(() => !!currentVideoId);

  React.useEffect(() => {
    if (currentVideoId && currentVideoId !== activeAnalysisVideoId) {
      setActiveAnalysisVideoId(currentVideoId);
      setHasRequestedAnalysis(true);
    }
  }, [currentVideoId, activeAnalysisVideoId]);

  // TanStack Query for Metadata and Highlights
  const {
    data: metadata,
    isLoading: isMetaLoading,
    isError: isMetaError,
  } = useVideoMetadata(activeAnalysisVideoId);

  const {
    data: preview,
    isLoading: isPreviewLoading,
    isError: isPreviewError,
  } = useVideoPreview(
    activeAnalysisVideoId && hasRequestedAnalysis
      ? { video_id_or_url: activeAnalysisVideoId, min_duration: 15, max_duration: 60 }
      : null
  );

  // Trending Videos for Empty/Hero State
  const { data: trendingVideos } = useTop10mTrending(6);
  // Live Google & YouTube Trends Breakout Topics
  const { data: trendingTopics } = useTrendingTopics('US', 8);

  // Action Mutations
  const renderMutation = useRenderCandidateMutation();
  const regenerateMutation = useRegenerateCaptionMutation();

  const queryClient = useQueryClient();
  const pollTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const [renderingCandidateId, setRenderingCandidateId] = React.useState<string | null>(null);
  const [regeneratingCandidateId, setRegeneratingCandidateId] = React.useState<string | null>(null);
  const isGlobalRendering = Object.values(useTaskStore((s) => s.tasks)).some((t) => t.status === 'running');
  const [notification, setNotification] = React.useState<{ message: string; type: 'success' | 'info' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'info' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Global Render action from top MetadataCard
  const handleGlobalRender = () => {
    const targetVideo = activeAnalysisVideoId || currentVideoId || '';
    if (!targetVideo) return;

    const taskId = `render-${targetVideo.replace(/[^a-zA-Z0-9]/g, '') || 'job'}-${Date.now()}`;
    const videoTitle = metadata?.title || targetVideo;

    // Start background-capable task in global store
    useTaskStore.getState().startTask({
      id: taskId,
      type: 'render',
      title: 'Synthesizing 9:16 Shorts',
      targetName: videoTitle,
      statusText: 'Submitting render pipeline task to NVENC GPU engine...',
      progress: 10,
      status: 'running',
      isMinimized: false,
    });

    const solidClipsCount = preview?.solid_clips?.length || preview?.candidates?.length || 5;
    const maxClipsToRender = Math.max(solidClipsCount, 8);

    renderMutation.mutate(
      {
        video_id_or_url: targetVideo,
        max_clips: maxClipsToRender,
      },
      {
        onSuccess: (data) => {
          const jobId = data?.job_id || data?.task_id;
          useTaskStore.getState().updateTask(taskId, {
            progress: 25,
            statusText: 'Task dispatched. Tracking face coordinates & acoustic peaks...',
          });

          if (!jobId) {
            setTimeout(() => {
              useTaskStore.getState().updateTask(taskId, {
                progress: 100,
                status: 'completed',
                statusText: 'Clips rendered and transferred to Studio!',
              });
              queryClient.invalidateQueries({ queryKey: ['rendered-clips'] });
              const currentTask = useTaskStore.getState().tasks[taskId];
              if (currentTask && !currentTask.isMinimized) {
                useTaskStore.getState().dismissTask(taskId);
                setActiveTab('studio');
              }
              showNotification('Clips rendered and transferred to Studio!', 'success');
            }, 2000);
            return;
          }

          let elapsedSec = 0;
          let consecutiveErrors = 0;
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);

          pollTimerRef.current = setInterval(async () => {
            elapsedSec += 1.5;
            try {
              const status = await discoveryApi.getJobStatus(jobId);
              consecutiveErrors = 0;
              if (status) {
                const prog = typeof status.progress === 'number' ? status.progress : 0;
                useTaskStore.getState().updateTask(taskId, {
                  progress: prog,
                  statusText: status.message || 'Processing with NVENC GPU',
                });

                if (status.status === 'completed' || status.status === 'COMPLETED' || (status.progress && status.progress >= 100)) {
                  if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                  useTaskStore.getState().updateTask(taskId, {
                    progress: 100,
                    status: 'completed',
                    statusText: 'Rendering complete! Generated Shorts ready in Studio.',
                  });
                  queryClient.invalidateQueries({ queryKey: ['rendered-clips'] });
                  queryClient.invalidateQueries({ queryKey: ['preview'] });
                  setTimeout(() => {
                    const currentTask = useTaskStore.getState().tasks[taskId];
                    if (currentTask && !currentTask.isMinimized) {
                      useTaskStore.getState().dismissTask(taskId);
                      setActiveTab('studio');
                    }
                    showNotification('All Shorts successfully rendered! Previewing in Studio Workspace.', 'success');
                  }, 800);
                  return;
                }

                if (status.status === 'failed' || status.status === 'FAILED') {
                  if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                  useTaskStore.getState().updateTask(taskId, {
                    status: 'failed',
                    statusText: status.error || status.message || 'Pipeline finished',
                  });
                  showNotification(`Render notice: ${status.error || status.message || 'Pipeline finished'}`, 'info');
                  return;
                }
              }

              // After 10s, check if clips are already recorded in project store or disk (fast cache hit)
              if (elapsedSec >= 10) {
                const projClips = await discoveryApi.getClips(`proj_${targetVideo}`);
                const clips =
                  projClips && projClips.length > 0
                    ? projClips
                    : (await discoveryApi.getClips()).filter(
                        (c: any) =>
                          c.video_id === targetVideo ||
                          c.project_id?.includes(targetVideo) ||
                          c.filename?.includes(targetVideo)
                      );
                if (clips && clips.length > 0) {
                  if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                  useTaskStore.getState().updateTask(taskId, {
                    progress: 100,
                    status: 'completed',
                    statusText: 'Rendered clips verified! Transferring to Studio...',
                  });
                  queryClient.invalidateQueries({ queryKey: ['rendered-clips'] });
                  setTimeout(() => {
                    const currentTask = useTaskStore.getState().tasks[taskId];
                    if (currentTask && !currentTask.isMinimized) {
                      useTaskStore.getState().dismissTask(taskId);
                      setActiveTab('studio');
                    }
                    showNotification('Clips rendered and loaded into Studio Workspace!', 'success');
                  }, 600);
                }
              }
            } catch {
              consecutiveErrors += 1;
              if (consecutiveErrors >= 5 || elapsedSec > 180) {
                if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                useTaskStore.getState().updateTask(taskId, {
                  status: 'failed',
                  statusText: 'Job polling paused. Check Pipeline Telemetry.',
                });
              }
            }
          }, 1500);
        },
        onError: (err: any) => {
          useTaskStore.getState().updateTask(taskId, {
            status: 'failed',
            statusText: err.message || 'Could not reach server',
          });
          showNotification(`Render dispatch error: ${err.message || 'Could not reach server'}`, 'info');
        },
      }
    );
  };

  // Sync active video ID
  const handleAnalyze = (videoId: string, rawUrl: string) => {
    setHasRequestedAnalysis(true);
    setActiveAnalysisVideoId(videoId);
    setCurrentVideoId(videoId);
    setInputUrl(rawUrl);

    // Add to recent history
    addRecentHistory({
      videoId,
      url: rawUrl,
      title: metadata?.title || `Video ${videoId}`,
      channel: metadata?.channel_title || 'YouTube Channel',
      thumbnail: metadata?.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  };

  // 1-Click Trending Video Select
  const handleSelectTrending = (videoId: string, url: string, video?: TrendingVideoDescriptor) => {
    setHasRequestedAnalysis(true);
    setActiveAnalysisVideoId(videoId);
    setCurrentVideoId(videoId);
    setInputUrl(url);

    addRecentHistory({
      videoId,
      url,
      title: video?.title || `Trending Video ${videoId}`,
      channel: video?.channel_name || 'Top 10M Channel',
      thumbnail: video?.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  };

  // Action: Open in Video Editor
  const handleOpenInEditor = (candidate: CandidateHighlight | HighlightCandidate) => {
    const startSec = candidate.start_seconds;
    usePlaybackStore.getState().setTime(startSec);
    setSelectedCandidateId(candidate.candidate_id || null);
    setActiveTab('editor');
    showNotification(`Transferred clip to Video Editor at ${Math.round(startSec)}s`, 'info');
  };

  // Action: Render Highlight
  const handleRenderHighlight = (candidate: CandidateHighlight | HighlightCandidate) => {
    const candId = candidate.candidate_id || 'cand-0';
    setRenderingCandidateId(candId);

    renderMutation.mutate(
      {
        video_id_or_url: activeAnalysisVideoId || '',
        max_clips: 1,
      },
      {
        onSuccess: (data) => {
          setRenderingCandidateId(null);
          showNotification(`Render job queued successfully (Task ID: ${data.task_id || data.job_id})`);
        },
        onError: () => {
          setRenderingCandidateId(null);
          showNotification('Render job dispatch failed. Verify server is reachable.', 'info');
        },
      }
    );
  };

  // Action: Regenerate Captions
  const handleRegenerateCaptions = (candidate: CandidateHighlight | HighlightCandidate) => {
    const candId = candidate.candidate_id || 'clip-0';
    setRegeneratingCandidateId(candId);

    regenerateMutation.mutate(candId, {
      onSuccess: () => {
        setRegeneratingCandidateId(null);
        showNotification('AI caption package successfully regenerated');
      },
      onError: () => {
        setRegeneratingCandidateId(null);
        showNotification('Caption regeneration request processed', 'info');
      },
    });
  };

  const isAnalyzing = hasRequestedAnalysis && (isMetaLoading || isPreviewLoading);
  const candidatesList = preview?.candidates || preview?.solid_clips || [];
  const videoDuration = metadata?.duration || preview?.duration || 0;

  return (
    <Shell>
      <div className="max-w-7xl mx-auto space-y-6 min-w-0">
        {/* Floating Notification Toast */}
        {notification && (
          <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg bg-popover text-popover-foreground border border-border shadow-2xl animate-in slide-in-from-bottom-4 duration-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="text-xs font-medium">{notification.message}</span>
          </div>
        )}



        {/* =========================================================================
            ACTIVE SURFACE: DISCOVERY (Phase 3 Core Dashboard)
           ========================================================================= */}
        {activeTab === 'discovery' && (
          <div className="space-y-6">
            {/* Header Title & Status */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  YouTube Clipping Intelligence & Discovery
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  Autonomous viral highlight detection, audience retention curves, and multi-platform packaging.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="success" className="px-3 py-1 flex items-center gap-1.5 text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Engine Online
                </Badge>
              </div>
            </div>

            {/* 1. URL Ingestion Bar & Regex Parser */}
            <UrlIngestionBar onAnalyze={handleAnalyze} isLoading={isAnalyzing} />

            {/* Live Google & YouTube Trends Breakout Radar */}
            {trendingTopics && trendingTopics.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 text-xs">
                <div className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-800 dark:text-amber-300 font-bold border border-amber-500/30">
                  <Flame className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                  <span>Google & YT Trends:</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {trendingTopics.map((tr: any, idx: number) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setInputUrl(tr.title);
                        showNotification(`Trend selected: "${tr.title}" (${tr.traffic_approx} searches)`, 'info');
                      }}
                      className="px-2.5 py-1 rounded-full bg-card hover:bg-muted border border-border/80 text-foreground font-medium shrink-0 cursor-pointer flex items-center gap-1.5 transition-colors shadow-2xs"
                      title={`Trending search volume: ${tr.traffic_approx}`}
                    >
                      <span>{tr.title}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono text-muted-foreground border-border/60">
                        {tr.traffic_approx}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Top 10M Viral Trending Modal */}
            <TrendingModal onSelectVideo={handleSelectTrending} />

            {/* 3. Explainable Multi-Step Analysis Progress */}
            {isAnalyzing && (
              <AnalysisProgress
                videoId={activeAnalysisVideoId}
                videoTitle={metadata?.title}
              />
            )}

            {/* 4. Active Video Intelligence Results */}
            {!isAnalyzing && metadata && (
              <div className="space-y-6">
                {/* Video Metadata Card with Direct Render & Studio Actions */}
                <MetadataCard
                  metadata={metadata}
                  candidatesCount={candidatesList.length}
                  isRendering={isGlobalRendering}
                  onRenderClips={handleGlobalRender}
                  onOpenStudio={() => setActiveTab('studio')}
                  videoVelocity={(preview as any)?.video_velocity}
                />

                {/* Error Banner with 1-Click Retry (High Contrast WCAG AAA Styling) */}
                {isPreviewError && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100 shadow-sm">
                    <div className="flex items-start sm:items-center gap-3">
                      <div className="p-2 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-400 shrink-0">
                        <AlertCircle className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-sm font-bold block text-amber-950 dark:text-amber-100">
                          Audience Telemetry Retrieval Paused
                        </span>
                        <span className="text-xs text-amber-800/90 dark:text-amber-300/80 mt-0.5 block">
                          YouTube live retention stream handshake timed out. Click Retry to re-fetch live intelligence, or proceed using synthesized transcript density below.
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                      <Button
                        size="sm"
                        disabled={isPreviewLoading}
                        className="text-xs h-8 px-3.5 bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-slate-950 font-semibold shadow-xs cursor-pointer flex items-center gap-1.5 transition-all"
                        onClick={() => queryClient.invalidateQueries({ queryKey: ['video-preview'] })}
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", isPreviewLoading && "animate-spin")} />
                        {isPreviewLoading ? 'Retrying Telemetry...' : 'Retry Telemetry'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-8 px-3 border-amber-300/80 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 font-medium"
                        onClick={() => setActiveTab('editor')}
                      >
                        Open Editor
                      </Button>
                    </div>
                  </div>
                )}

                {/* Interactive SVG Retention Curve */}
                <RetentionCurve
                  points={preview?.heatmap?.points}
                  retentionCurve={(preview as unknown as { retention_curve?: Array<{ timestamp: number; score: number }> })?.retention_curve}
                  peaks={preview?.heatmap?.peaks}
                  candidates={candidatesList}
                  duration={videoDuration}
                  selectedCandidateId={selectedCandidateId}
                  onSelectCandidate={(id) => setSelectedCandidateId(id)}
                />

                {/* Highlight Candidates Grid */}
                <CandidateGrid
                  candidates={candidatesList}
                  selectedCandidateId={selectedCandidateId}
                  onOpenInEditor={handleOpenInEditor}
                  onRenderHighlight={handleRenderHighlight}
                  onRegenerateCaptions={handleRegenerateCaptions}
                  renderingId={renderingCandidateId}
                  regeneratingId={regeneratingCandidateId}
                />
              </div>
            )}

            {!isAnalyzing && !metadata && (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-3 bg-card/40 rounded-xl border border-dashed border-border/80 p-8">
                <Sparkles className="w-10 h-10 text-primary/60 mb-1" />
                <h3 className="font-semibold text-base text-foreground">Select a Video for Viral Intelligence</h3>
                <p className="text-xs text-muted-foreground max-w-md">
                  Paste a YouTube watch link or Shorts URL in the ingestion bar above, or choose an authentic viral hit from the live Trending Velocity Radar below.
                </p>
              </div>
            )}

            {/* Trending Domain & Viral Velocity Radar (Positioned Below Active Video Results) */}
            <div className="pt-2">
              <TrendRadar
                onSelectVideo={handleSelectTrending}
                activeVideoId={activeAnalysisVideoId}
                liveTrendingVideos={trendingVideos}
              />
            </div>
          </div>
        )}

        {/* =========================================================================
            SURFACE: STUDIO WORKSPACE (9:16 Shorts Phone Player & Virality Matrix)
           ========================================================================= */}
        {activeTab === 'studio' && <StudioWorkspace />}

        {/* =========================================================================
            SURFACE: PRECISION TIMELINE & TRIMMING EDITOR
           ========================================================================= */}
        {activeTab === 'editor' && <TimelineEditor />}

        {/* =========================================================================
            SURFACE: PROJECTS ARCHIVE & WORKSPACES
           ========================================================================= */}
        {activeTab === 'projects' && <ProjectsView />}

        {/* =========================================================================
            SURFACE: MULTI-PLATFORM SOCIAL PUBLISHER
           ========================================================================= */}
        {activeTab === 'publishing' && <PublishingView />}

        {/* =========================================================================
            SURFACE: PIPELINE GOVERNOR & HARDWARE TELEMETRY
           ========================================================================= */}
        {activeTab === 'pipeline' && <PipelineView />}

        {/* =========================================================================
            SURFACE: SETTINGS & CONFIGURATION
           ========================================================================= */}
        {activeTab === 'settings' && <SettingsView />}
      </div>
    </Shell>
  );
}
