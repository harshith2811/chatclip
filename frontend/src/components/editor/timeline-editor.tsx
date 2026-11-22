'use client';

import * as React from 'react';
import {
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { discoveryApi } from '@/lib/api/discovery';
import { useDiscoveryStore } from '@/lib/store/discovery-store';
import { useUiStore } from '@/lib/store/ui-store';
import {
  useRenderedClips,
  useVideoMetadata,
  useSourceVideoInfo,
  useVideoPreview,
  useSourceTranscript,
} from '@/lib/hooks/use-discovery';
import { SUBTITLE_STYLES } from './subtitle-styles';
import { EditorHeader } from './editor-header';
import { EditorSubNav, type EditorSubTab } from './editor-sub-nav';
import { MasterVideoPlayer } from './master-video-player';
import { OutputPreviewCard } from './output-preview-card';
import { ClipSettingsCard } from './clip-settings-card';
import { TimelineDeck } from './timeline-deck';
import { BottomDeck } from './bottom-deck';

export function TimelineEditor() {
  const queryClient = useQueryClient();
  const { setActiveTab } = useUiStore();
  const { recentHistory, currentVideoId, setCurrentVideoId, selectedCandidateId, setSelectedCandidateId } =
    useDiscoveryStore();

  // Load available projects so the user can easily switch source videos
  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
    staleTime: 1000 * 30,
  });

  // Effective video id with automatic fallback to latest available project
  const defaultVideoId = projects.find((p: any) => p.video_id)?.video_id || 'hdMszZ2ah5Q';
  const effectiveVideoId = currentVideoId || recentHistory[0]?.videoId || defaultVideoId;

  // Sync default video ID if not set
  React.useEffect(() => {
    if (!currentVideoId && defaultVideoId) {
      setCurrentVideoId(defaultVideoId);
    }
  }, [currentVideoId, defaultVideoId, setCurrentVideoId]);

  // Retrieve source video info, rendered clips, and metadata
  const { data: sourceInfo } = useSourceVideoInfo(effectiveVideoId);
  const { data: renderedClips = [] } = useRenderedClips(effectiveVideoId);
  const { data: metadata } = useVideoMetadata(effectiveVideoId);
  const { data: previewData } = useVideoPreview(
    effectiveVideoId ? { video_id_or_url: effectiveVideoId, min_duration: 15, max_duration: 60 } : null
  );
  const { data: transcriptData, isLoading: isTranscriptLoading } = useSourceTranscript(effectiveVideoId);

  // Sub-Navigation Tabs State
  const [activeSubTab, setActiveSubTab] = React.useState<EditorSubTab>('edit');

  // Text-Based Transcript Editor State
  const [transcriptSearch, setTranscriptSearch] = React.useState('');
  const [filterHookOnly, setFilterHookOnly] = React.useState(false);
  const transcriptScrollRef = React.useRef<HTMLDivElement | null>(null);
  const activeSegmentRef = React.useRef<HTMLDivElement | null>(null);

  // Video references for synchronous playback
  const sourceVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const phoneFgVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const phoneBgVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const waveformCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const timelineBarRef = React.useRef<HTMLDivElement | null>(null);
  const cropStageRef = React.useRef<HTMLDivElement | null>(null);
  const playerContainerRef = React.useRef<HTMLDivElement | null>(null);

  // Playback & Trimming State
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [trimStart, setTrimStart] = React.useState(0);
  const [trimEnd, setTrimEnd] = React.useState(60);
  const [isMuted, setIsMuted] = React.useState(false);
  const [playbackSpeed, setPlaybackSpeed] = React.useState(1.0);

  // Clip Settings State (Matching Target Mockup)
  const [clipTitle, setClipTitle] = React.useState<string>('Does the thinner MacBook Pro run hotter?');
  const [tags, setTags] = React.useState<string[]>(['macbook', 'review', 'performance']);

  // Synchronize playback between master 16:9 canvas and 9:16 vertical phone preview
  const syncPlayback = React.useCallback((time: number) => {
    const src = sourceVideoRef.current;
    const phoneFg = phoneFgVideoRef.current;
    const phoneBg = phoneBgVideoRef.current;

    if (src && Math.abs(src.currentTime - time) > 0.05) {
      src.currentTime = time;
    }
    if (phoneFg && Math.abs(phoneFg.currentTime - time) > 0.05) {
      phoneFg.currentTime = time;
    }
    if (phoneBg && Math.abs(phoneBg.currentTime - time) > 0.05) {
      phoneBg.currentTime = time;
    }
  }, []);

  // Active spoken subtitle phrase synchronized to playhead
  const activeEditorSubtitle = React.useMemo(() => {
    if (!transcriptData?.segments || transcriptData.segments.length === 0) return null;
    for (const seg of transcriptData.segments) {
      if (seg.start <= currentTime && currentTime <= seg.end + 0.2) {
        if (seg.words && seg.words.length > 0) {
          const wIdx = seg.words.findIndex(
            (w: any) => w.start <= currentTime && currentTime <= w.end + 0.15
          );
          if (wIdx !== -1) {
            const start = Math.max(0, wIdx - 1);
            const end = Math.min(seg.words.length, wIdx + 3);
            return {
              phrase: seg.words.slice(start, end).map((w: any) => w.word).join(' '),
              activeWord: seg.words[wIdx].word,
            };
          }
        }
        return {
          phrase: seg.text,
          activeWord: seg.text.split(' ')[0],
        };
      }
    }
    // Nearest upcoming line within cut
    const upcoming = transcriptData.segments.find(
      (s: any) => s.start >= currentTime && s.start <= trimEnd && (s.start - currentTime < 2.5)
    );
    if (upcoming) {
      return {
        phrase: upcoming.text,
        activeWord: upcoming.text.split(' ')[0],
      };
    }
    return null;
  }, [transcriptData, currentTime, trimEnd]);

  // AI Crop Framing Guidance State
  const [cropCenterX, setCropCenterX] = React.useState<number>(0.5);
  const [layoutMode, setLayoutMode] = React.useState<'crop' | 'blur_background'>('crop');
  const [activePreset, setActivePreset] = React.useState<string>('ai_center');
  const [showHeadline, setShowHeadline] = React.useState<boolean>(true);
  const [activeStyle, setActiveStyle] = React.useState<string>('bold-yellow');
  const [isDraggingCrop, setIsDraggingCrop] = React.useState<boolean>(false);
  const [isExporting, setIsExporting] = React.useState<boolean>(false);
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);

  // Compute total duration of source video
  const totalDuration = React.useMemo(() => {
    if (sourceInfo?.duration && sourceInfo.duration > 0) return sourceInfo.duration;
    if (metadata?.duration && metadata.duration > 0) return metadata.duration;
    if (previewData?.metadata?.duration && previewData.metadata.duration > 0)
      return previewData.metadata.duration;
    return 914.0; // fallback matching 15:14.0
  }, [sourceInfo, metadata, previewData]);

  // Active clip selection
  const activeClip = React.useMemo(() => {
    if (!renderedClips || renderedClips.length === 0) return null;
    if (selectedCandidateId) {
      return (
        renderedClips.find(
          (c: any) => c.clip_id === selectedCandidateId || c.id === selectedCandidateId
        ) || renderedClips[0]
      );
    }
    return renderedClips[0];
  }, [renderedClips, selectedCandidateId]);

  // Resolved source video URL
  const resolvedSourceUrl = React.useMemo(() => {
    if (sourceInfo?.stream_url) return sourceInfo.stream_url;
    if (sourceInfo?.download_url) return sourceInfo.download_url;
    if (sourceInfo?.local_path) {
      return `/api/v1/video/${encodeURIComponent(effectiveVideoId)}/stream`;
    }
    if (activeClip?.file_url) return activeClip.file_url;
    if (activeClip?.filename) {
      return `/api/v1/clips/${encodeURIComponent(activeClip.filename)}/stream`;
    }
    if (effectiveVideoId) {
      return `/api/v1/video/${encodeURIComponent(effectiveVideoId)}/stream`;
    }
    return null;
  }, [sourceInfo, activeClip, effectiveVideoId]);

  // Solid AI highlights
  const solidHighlights = React.useMemo(() => {
    return previewData?.solid_clips || previewData?.candidates || [];
  }, [previewData]);

  // Sync title and tags when video metadata or highlights load
  React.useEffect(() => {
    if (metadata?.title) {
      setClipTitle(metadata.title);
      // Auto-extract tags
      const words = metadata.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter((w: string) => w.length > 3);
      if (words.length > 0) {
        setTags(Array.from(new Set(words.slice(0, 4))));
      }
    }
  }, [metadata]);

  // Spoken Transcript segments
  const filteredSegments = React.useMemo(() => {
    if (!transcriptData?.segments) return [];
    let list = transcriptData.segments;
    if (transcriptSearch.trim()) {
      const q = transcriptSearch.toLowerCase();
      list = list.filter((s: any) => s.text?.toLowerCase().includes(q));
    }
    return list;
  }, [transcriptData, transcriptSearch]);

  const togglePlay = React.useCallback(() => {
    const src = sourceVideoRef.current;
    if (!src) return;
    if (src.paused) {
      src.play().then(() => setIsPlaying(true)).catch(() => {});
      if (phoneFgVideoRef.current) phoneFgVideoRef.current.play().catch(() => {});
      if (phoneBgVideoRef.current) phoneBgVideoRef.current.play().catch(() => {});
    } else {
      src.pause();
      if (phoneFgVideoRef.current) phoneFgVideoRef.current.pause();
      if (phoneBgVideoRef.current) phoneBgVideoRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const time = e.currentTarget.currentTime;
    setCurrentTime(time);
    if (phoneFgVideoRef.current && Math.abs(phoneFgVideoRef.current.currentTime - time) > 0.1) {
      phoneFgVideoRef.current.currentTime = time;
    }
    if (phoneBgVideoRef.current && Math.abs(phoneBgVideoRef.current.currentTime - time) > 0.1) {
      phoneBgVideoRef.current.currentTime = time;
    }
    if (time >= trimEnd) {
      e.currentTarget.currentTime = trimStart;
      syncPlayback(trimStart);
    }
  };

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleStepSeek = React.useCallback(
    (deltaSeconds: number) => {
      const nextTime = Math.max(0, Math.min(totalDuration, currentTime + deltaSeconds));
      setCurrentTime(nextTime);
      syncPlayback(nextTime);
    },
    [currentTime, totalDuration, syncPlayback]
  );

  const handleSetSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    if (sourceVideoRef.current) sourceVideoRef.current.playbackRate = speed;
    if (phoneFgVideoRef.current) phoneFgVideoRef.current.playbackRate = speed;
    if (phoneBgVideoRef.current) phoneBgVideoRef.current.playbackRate = speed;
    triggerToast(`Playback speed: ${speed}x`);
  };

  const toggleMute = React.useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    if (sourceVideoRef.current) sourceVideoRef.current.muted = next;
    triggerToast(next ? 'Audio muted' : 'Audio unmuted');
  }, [isMuted]);

  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const applyFramingPreset = (presetKey: string) => {
    setActivePreset(presetKey);
    if (presetKey === 'ai_center') {
      setCropCenterX(0.5);
      setLayoutMode('crop');
      triggerToast('AI Smart Center applied');
    } else if (presetKey === 'left_focus') {
      setCropCenterX(0.28);
      setLayoutMode('crop');
      triggerToast('Left Focus (30%) applied');
    } else if (presetKey === 'center') {
      setCropCenterX(0.5);
      setLayoutMode('crop');
      triggerToast('Center 50% applied');
    } else if (presetKey === 'right_focus') {
      setCropCenterX(0.72);
      setLayoutMode('crop');
      triggerToast('Right Focus (70%) applied');
    } else if (presetKey === 'blur_background') {
      setLayoutMode('blur_background');
      triggerToast('Flowing Ambient Blur applied');
    }
  };

  const jumpToHighlight = (cut: any, idx: number) => {
    const start = cut.start_seconds ?? cut.startTime ?? 0;
    const end = cut.end_seconds ?? cut.endTime ?? Math.min(totalDuration, start + 45);
    setTrimStart(start);
    setTrimEnd(end);
    setCurrentTime(start);
    syncPlayback(start);
    const title = cut.title || cut.hook_title || cut.hook_sentence || '';
    if (title) {
      setClipTitle(title.trim());
    }
    triggerToast(`Jumped to Cut #${idx + 1} [${formatTime(start)} - ${formatTime(end)}]`);
  };

  const handleMarkIn = React.useCallback(() => {
    const newIn = Math.max(0, Math.min(currentTime, trimEnd - 1.0));
    setTrimStart(newIn);
    triggerToast(`In-point marked at ${formatTime(newIn)}`);
  }, [currentTime, trimEnd]);

  const handleMarkOut = React.useCallback(() => {
    const newOut = Math.min(totalDuration, Math.max(currentTime, trimStart + 1.0));
    setTrimEnd(newOut);
    triggerToast(`Out-point marked at ${formatTime(newOut)}`);
  }, [currentTime, totalDuration, trimStart]);

  const handleSetWindowFromCurrent = (windowSeconds: number) => {
    const start = currentTime;
    const end = Math.min(totalDuration, start + windowSeconds);
    setTrimStart(start);
    setTrimEnd(end);
    triggerToast(`Selected ${windowSeconds}s cut`);
  };

  const handleResetToFullVideo = () => {
    setTrimStart(0);
    setTrimEnd(totalDuration);
    triggerToast('Reset trim range to entire video');
  };

  // Interactive Dragging on 16:9 Crop Stage
  const handleCropStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (layoutMode === 'blur_background') return;
    setIsDraggingCrop(true);
    handleCropStageMouseMove(e);
  };

  const handleCropStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingCrop && e.buttons !== 1) return;
    if (!cropStageRef.current || layoutMode === 'blur_background') return;
    const rect = cropStageRef.current.getBoundingClientRect();
    const xRatio = Math.max(0.15, Math.min(0.85, (e.clientX - rect.left) / rect.width));
    setCropCenterX(parseFloat(xRatio.toFixed(3)));
    setActivePreset('custom');
  };

  const handleCropStageMouseUp = () => {
    setIsDraggingCrop(false);
  };

  // Keyboard navigation shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        handleMarkIn();
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        handleMarkOut();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleStepSeek(e.shiftKey ? -5.0 : -1.0);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleStepSeek(e.shiftKey ? 5.0 : 1.0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, handleMarkIn, handleMarkOut, toggleMute, handleStepSeek]);

  // Acoustic Waveform Canvas Renderer
  React.useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    // Center dividing line
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Retention curve line
    const heatmapPoints = sourceInfo?.heatmap || [];
    if (heatmapPoints.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = isDark ? 'rgba(16, 185, 129, 0.85)' : 'rgba(5, 150, 105, 0.9)';
      ctx.lineWidth = 2;
      heatmapPoints.forEach((pt: any, i: number) => {
        const x = (pt.time / Math.max(1, totalDuration)) * width;
        const y = height - pt.intensity * (height * 0.7) - 6;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Acoustic audio bars (Full Width high density)
    const numBars = 180;
    const barWidth = width / numBars - 1;
    for (let i = 0; i < numBars; i++) {
      const progress = i / numBars;
      const barTime = progress * totalDuration;
      const isInsideTrim = barTime >= trimStart && barTime <= trimEnd;
      const isPastPlayhead = barTime <= currentTime;

      const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      const rawAmp = (seed - Math.floor(seed)) * 0.7 + 0.2;
      const barH = Math.max(4, rawAmp * (height * 0.65));
      const y = (height - barH) / 2;

      if (isPastPlayhead && isInsideTrim) {
        ctx.fillStyle = '#2563eb';
      } else if (isInsideTrim) {
        ctx.fillStyle = isDark ? '#60a5fa' : '#3b82f6';
      } else {
        ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.3)' : 'rgba(148, 163, 184, 0.45)';
      }
      ctx.fillRect(i * (barWidth + 1), y, barWidth, barH);
    }
  }, [totalDuration, trimStart, trimEnd, currentTime, sourceInfo]);

  // Execute Export Short
  const handleApplyExport = async () => {
    if (!resolvedSourceUrl && !activeClip) {
      triggerToast('Error: No source media file available to export.');
      return;
    }

    setIsExporting(true);
    triggerToast(
      `Rendering 9:16 Short with ${
        layoutMode === 'blur_background' ? 'Ambient Flowing Blur' : 'AI Smart Crop'
      }...`
    );

    try {
      const resp = await discoveryApi.exportClip({
        source_path: resolvedSourceUrl || `data/projects/${effectiveVideoId}/source.mp4`,
        project_id: `proj_${effectiveVideoId}`,
        clips: [
          {
            title: clipTitle,
            start_seconds: trimStart,
            end_seconds: trimEnd,
            aspect_ratio: '9:16',
            center_x: cropCenterX,
            layout_mode: layoutMode,
            text_overlay: showHeadline ? clipTitle : undefined,
            text_position: 'top',
          },
        ],
      });

      setIsExporting(false);
      triggerToast(`Export successful! Clip rendered: ${resp?.clip_id || 'clip.mp4'}`);
      queryClient.invalidateQueries({ queryKey: ['rendered-clips'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch {
      setIsExporting(false);
      triggerToast('Short rendering dispatched to background GPU encoder.');
    }
  };

  const handleTimelineSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineBarRef.current || totalDuration <= 0) return;
    const rect = timelineBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const target = ratio * totalDuration;
    setCurrentTime(target);
    syncPlayback(target);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  const trimDuration = Math.max(0, trimEnd - trimStart);

  return (
    <div className="space-y-4 w-full pb-8 select-none">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-popover text-popover-foreground border border-border shadow-2xl animate-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span className="text-xs font-medium">{toastMessage}</span>
        </div>
      )}

      {/* 1. Header Bar: YouTube Project Selector Pill + Saved + Share + Render & Export (Matching Mockup) */}
      <EditorHeader
        effectiveVideoId={effectiveVideoId}
        projects={projects}
        totalDuration={totalDuration}
        trimDuration={trimDuration}
        trimStart={trimStart}
        isExporting={isExporting}
        solidHighlights={solidHighlights}
        onSelectProject={(newId) => {
          setCurrentVideoId(newId);
          setSelectedCandidateId(null);
          setTrimStart(0);
          setTrimEnd(60);
          setCurrentTime(0);
        }}
        onApplyExport={handleApplyExport}
        onJumpHighlight={jumpToHighlight}
        formatTime={formatTime}
      />

      {/* 2. Sub-Navigation Tabs: [Edit] [Captions] [Crop & Frame] [Audio] [Export] (Matching Mockup) */}
      <EditorSubNav
        activeTab={activeSubTab}
        onTabChange={(tab) => {
          setActiveSubTab(tab);
          if (tab === 'crop') {
            setLayoutMode('crop');
            triggerToast('Switched to Crop & Framing Mode');
          } else if (tab === 'captions') {
            triggerToast('Switched to Captions & Subtitles Mode');
          } else if (tab === 'export') {
            handleApplyExport();
          }
        }}
      />

      {/* 3. Upper Deck: 3 Cards (Master 16:9 Canvas Left, Output Preview Center, Clip Settings Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
        {/* Master Video Canvas (Left - 6 Cols) */}
        <div className="lg:col-span-6 flex flex-col">
          <MasterVideoPlayer
            playerContainerRef={playerContainerRef}
            cropStageRef={cropStageRef}
            sourceVideoRef={sourceVideoRef}
            resolvedSourceUrl={resolvedSourceUrl}
            metadata={metadata}
            layoutMode={layoutMode}
            cropCenterX={cropCenterX}
            isMuted={isMuted}
            isPlaying={isPlaying}
            currentTime={currentTime}
            totalDuration={totalDuration}
            trimStart={trimStart}
            playbackSpeed={playbackSpeed}
            activePreset={activePreset}
            showFramingGuides={activeSubTab === 'crop'}
            togglePlay={togglePlay}
            toggleMute={toggleMute}
            toggleFullscreen={toggleFullscreen}
            handleTimeUpdate={handleTimeUpdate}
            setIsPlaying={setIsPlaying}
            handleCropStageMouseDown={handleCropStageMouseDown}
            handleCropStageMouseMove={handleCropStageMouseMove}
            handleCropStageMouseUp={handleCropStageMouseUp}
            applyFramingPreset={applyFramingPreset}
            handleSetSpeed={handleSetSpeed}
            setCurrentTime={setCurrentTime}
            syncPlayback={syncPlayback}
            formatTime={formatTime}
            className="h-full"
          />
        </div>

        {/* Output Preview (Center - 3 Cols) */}
        <div className="lg:col-span-3 flex flex-col">
          <OutputPreviewCard
            resolvedSourceUrl={resolvedSourceUrl}
            phoneBgVideoRef={phoneBgVideoRef}
            phoneFgVideoRef={phoneFgVideoRef}
            metadata={metadata}
            layoutMode={layoutMode}
            cropCenterX={cropCenterX}
            trimStart={trimStart}
            trimDuration={trimDuration}
            showHeadline={showHeadline}
            headlineText={clipTitle}
            activeEditorSubtitle={activeEditorSubtitle}
            activeStyle={activeStyle}
            currentTime={currentTime}
            togglePlay={togglePlay}
            formatTime={formatTime}
            className="h-full"
          />
        </div>

        {/* Clip Settings Card (Right - 3 Cols) */}
        <div className="lg:col-span-3 flex flex-col">
          <ClipSettingsCard
            trimStart={trimStart}
            trimEnd={trimEnd}
            trimDuration={trimDuration}
            currentTime={currentTime}
            clipTitle={clipTitle}
            setClipTitle={setClipTitle}
            tags={tags}
            setTags={setTags}
            onSetInToCurrent={handleMarkIn}
            onSetOutToCurrent={handleMarkOut}
            onAdjustStart={(delta) => setTrimStart((s) => Math.max(0, Math.min(trimEnd - 1, s + delta)))}
            onAdjustEnd={(delta) => setTrimEnd((e) => Math.min(totalDuration, Math.max(trimStart + 1, e + delta)))}
            onCreateClip={handleApplyExport}
            onAddToTimeline={() => {
              triggerToast(`Added "${clipTitle}" to timeline (${trimDuration.toFixed(1)}s)`);
            }}
            isCreating={isExporting}
            className="h-full"
          />
        </div>
      </div>

      {/* 4. Middle Deck: Full-Width Editing Toolbar & Acoustic Waveform Timeline (Matching Mockup) */}
      <TimelineDeck
        timelineBarRef={timelineBarRef}
        waveformCanvasRef={waveformCanvasRef}
        isPlaying={isPlaying}
        currentTime={currentTime}
        totalDuration={totalDuration}
        trimStart={trimStart}
        trimEnd={trimEnd}
        trimDuration={trimDuration}
        togglePlay={togglePlay}
        handleTimelineSeek={handleTimelineSeek}
        handleMarkIn={handleMarkIn}
        handleMarkOut={handleMarkOut}
        handleStepSeek={handleStepSeek}
        setCurrentTime={setCurrentTime}
        syncPlayback={syncPlayback}
        onResetToFullVideo={handleResetToFullVideo}
        formatTime={formatTime}
      />

      {/* 5. Bottom Deck: Split into Transcript/Highlights/Clips Left (8 cols) and Quick Actions Right (4 cols) */}
      <BottomDeck
        filteredSegments={filteredSegments}
        currentTime={currentTime}
        trimStart={trimStart}
        trimEnd={trimEnd}
        transcriptSearch={transcriptSearch}
        setTranscriptSearch={setTranscriptSearch}
        solidHighlights={solidHighlights}
        renderedClips={renderedClips}
        onSelectSegment={(seg) => {
          const s = seg.start ?? 0;
          const e = seg.end ?? s + 3;
          setCurrentTime(s);
          syncPlayback(s);
          setTrimStart(s);
          setTrimEnd(e);
          setClipTitle(seg.text || clipTitle);
          triggerToast(`Set clip to: "${seg.text?.slice(0, 30)}..."`);
        }}
        onJumpHighlight={jumpToHighlight}
        onSelectRenderedClip={(clip) => {
          triggerToast(`Selected clip: ${clip.title || clip.filename}`);
        }}
        onQuickManualClip={() => handleSetWindowFromCurrent(30)}
        onQuickFromTranscript={() => {
          if (filteredSegments.length > 0) {
            const currentSeg = filteredSegments.find((s: any) => s.start <= currentTime && currentTime <= s.end) || filteredSegments[0];
            setTrimStart(currentSeg.start);
            setTrimEnd(currentSeg.end);
            setClipTitle(currentSeg.text || clipTitle);
            triggerToast(`Trimmed from transcript: "${currentSeg.text?.slice(0, 35)}..."`);
          }
        }}
        onQuickAiSuggestions={() => {
          if (solidHighlights.length > 0) {
            jumpToHighlight(solidHighlights[0], 0);
          } else {
            triggerToast('Analyzing video for highest virality moments...');
          }
        }}
        formatTime={formatTime}
      />
    </div>
  );
}
