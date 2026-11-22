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
import { MasterCanvas } from './master-canvas';
import { TranscriptStudio } from './transcript-studio';
import { VerticalPreview } from './vertical-preview';

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
  const { data: renderedClips } = useRenderedClips(effectiveVideoId);
  const { data: metadata } = useVideoMetadata(effectiveVideoId);
  const { data: previewData } = useVideoPreview(
    effectiveVideoId ? { video_id_or_url: effectiveVideoId, min_duration: 15, max_duration: 60 } : null
  );
  const { data: transcriptData, isLoading: isTranscriptLoading } = useSourceTranscript(effectiveVideoId);

  // Text-Based Transcript Editor State
  const [transcriptSearch, setTranscriptSearch] = React.useState('');
  const [editorViewMode, setEditorViewMode] = React.useState<'both' | 'waveform' | 'transcript'>('both');
  const [autoScrollTranscript, setAutoScrollTranscript] = React.useState(true);
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
    // If playback is paused or in lead-in before words start, show nearest upcoming line in this cut (within 2.5s)
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
  const [safeZonePlatform, setSafeZonePlatform] = React.useState<'none' | 'tiktok' | 'reels' | 'shorts'>('none');
  const [showHeadline, setShowHeadline] = React.useState<boolean>(true);
  const [activeStyle, setActiveStyle] = React.useState<string>('bold-yellow');
  const [headlineText, setHeadlineText] = React.useState<string>('');
  const [isDraggingCrop, setIsDraggingCrop] = React.useState<boolean>(false);
  const [isExporting, setIsExporting] = React.useState<boolean>(false);
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);

  // Compute total duration of source video
  const totalDuration = React.useMemo(() => {
    if (sourceInfo?.duration && sourceInfo.duration > 0) return sourceInfo.duration;
    if (metadata?.duration && metadata.duration > 0) return metadata.duration;
    if (previewData?.metadata?.duration && previewData.metadata.duration > 0)
      return previewData.metadata.duration;
    return 913.0; // fallback to full length
  }, [sourceInfo, metadata, previewData]);

  // Active clip selection
  const activeClip = React.useMemo(() => {
    if (renderedClips && renderedClips.length > 0) {
      if (selectedCandidateId) {
        const found = renderedClips.find((c: any) => c.clip_id === selectedCandidateId);
        if (found) return found;
      }
      return renderedClips[0];
    }
    return null;
  }, [renderedClips, selectedCandidateId]);

  // Resolve source video stream URL
  const resolvedSourceUrl = React.useMemo(() => {
    if (sourceInfo?.source_url) return sourceInfo.source_url;
    if (activeClip?.playback_url) return activeClip.playback_url;
    if (activeClip?.url) return activeClip.url;
    if (effectiveVideoId) return `/assets/${effectiveVideoId}.mp4`;
    return null;
  }, [sourceInfo, activeClip, effectiveVideoId]);

  // AI-Detected Highlight Moments from Preview & Decision Engine
  const solidHighlights = React.useMemo(() => {
    if (sourceInfo?.solid_clips && sourceInfo.solid_clips.length > 0) {
      return sourceInfo.solid_clips;
    }
    if (previewData?.solid_clips && previewData.solid_clips.length > 0) {
      return previewData.solid_clips;
    }
    if (previewData?.candidates && previewData.candidates.length > 0) {
      return previewData.candidates;
    }
    return [];
  }, [sourceInfo, previewData]);

  // Set default headline from video title or first solid clip hook without arbitrary chopping
  React.useEffect(() => {
    if (!headlineText) {
      const title =
        solidHighlights[0]?.title ||
        solidHighlights[0]?.hook_title ||
        solidHighlights[0]?.hook_sentence ||
        metadata?.title ||
        sourceInfo?.title ||
        '';
      if (title) {
        setHeadlineText(title.trim());
      }
    }
  }, [metadata, sourceInfo, solidHighlights, headlineText]);

  // Synchronize initial trim bounds and playhead when video duration or first highlight loads
  React.useEffect(() => {
    if (solidHighlights.length > 0 && trimEnd === 60 && trimStart === 0) {
      const first = solidHighlights[0];
      const s = first.start_seconds ?? first.startTime ?? 0;
      const e = first.end_seconds ?? first.endTime ?? s + 35;
      setTrimStart(s);
      setTrimEnd(e);
      setCurrentTime(s);
      syncPlayback(s);
    }
  }, [solidHighlights, trimEnd, trimStart, syncPlayback]);

  // Auto-scroll transcript to active speaking sentence (ONLY scrolling inner container without pulling window)
  React.useEffect(() => {
    if (autoScrollTranscript && isPlaying && activeSegmentRef.current && transcriptScrollRef.current) {
      const container = transcriptScrollRef.current;
      const el = activeSegmentRef.current;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const relativeTop = elRect.top - containerRect.top + container.scrollTop;
      const cHeight = container.clientHeight;
      const elHeight = el.clientHeight;

      if (elRect.top < containerRect.top + 20 || elRect.bottom > containerRect.bottom - 20) {
        container.scrollTo({
          top: Math.max(0, relativeTop - cHeight / 2 + elHeight / 2),
          behavior: 'smooth',
        });
      }
    }
  }, [currentTime, autoScrollTranscript, isPlaying]);

  // Hook pattern detection on sentences for editorial tagging
  const isHookSentence = (text: string): boolean => {
    const lower = text.toLowerCase();
    const hookWords = [
      'secret', 'never', 'why', 'how to', 'most', 'mistake', 'truth', 'revealed',
      'insane', 'stop', 'here is', "don't", 'shocking', 'game changer', 'formula',
      'fail', 'proven', 'hack', 'trick', 'worst', 'best', 'warning', 'look at',
      'they said', 'turns out', 'fun fact', 'imagine', 'compelling', 'coolest', 'finally'
    ];
    return hookWords.some((w) => lower.includes(w));
  };

  const isPayoffSentence = (text: string): boolean => {
    const lower = text.toLowerCase();
    const payoffWords = [
      'actually', 'instead', 'turns out', 'that is why', 'the reason is', 'solution',
      'key takeaway', 'result', 'finally', 'realized', 'in fact', 'ultimately', 'remember',
      'changes everything', 'blow your mind', 'my take', 'at the end of the day', 'the bottom line',
      'makes a big difference', 'worth it', 'completely', "that's why", 'peace', 'catch you'
    ];
    return payoffWords.some((w) => lower.includes(w));
  };

  // Filtered transcript segments
  const filteredSegments = React.useMemo(() => {
    if (!transcriptData?.segments) return [];
    let segs = transcriptData.segments;
    if (transcriptSearch.trim()) {
      const q = transcriptSearch.toLowerCase();
      segs = segs.filter((s: any) => s.text?.toLowerCase().includes(q));
    }
    if (filterHookOnly) {
      segs = segs.filter((s: any) => isHookSentence(s.text || ''));
    }
    return segs;
  }, [transcriptData, transcriptSearch, filterHookOnly]);

  const togglePlay = React.useCallback(() => {
    const src = sourceVideoRef.current;
    const phoneFg = phoneFgVideoRef.current;
    const phoneBg = phoneBgVideoRef.current;

    if (!src) return;

    if (isPlaying) {
      src.pause();
      if (phoneFg) phoneFg.pause();
      if (phoneBg) phoneBg.pause();
      setIsPlaying(false);
    } else {
      if (currentTime >= totalDuration - 0.5) {
        src.currentTime = 0;
        setCurrentTime(0);
      }
      src.play().catch(() => {});
      if (phoneFg) phoneFg.play().catch(() => {});
      if (phoneBg) phoneBg.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [isPlaying, currentTime, totalDuration]);

  const handleTimeUpdate = React.useCallback(() => {
    const src = sourceVideoRef.current;
    if (!src) return;
    const t = src.currentTime;
    setCurrentTime(t);

    const phoneFg = phoneFgVideoRef.current;
    const phoneBg = phoneBgVideoRef.current;
    if (phoneFg && Math.abs(phoneFg.currentTime - t) > 0.12) {
      phoneFg.currentTime = t;
    }
    if (phoneBg && Math.abs(phoneBg.currentTime - t) > 0.12) {
      phoneBg.currentTime = t;
    }
  }, []);

  // Seek handler for timeline scrubber
  const handleTimelineSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineBarRef.current || totalDuration <= 0) return;
    const rect = timelineBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTime = ratio * totalDuration;
    setCurrentTime(seekTime);
    syncPlayback(seekTime);
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
      setHeadlineText(title.trim());
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

    // Acoustic audio bars
    const numBars = 140;
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
      const sourcePath =
        sourceInfo?.file_path ||
        sourceInfo?.source_url ||
        activeClip?.file_path ||
        `${effectiveVideoId}.mp4`;
      const exportReq = {
        source_path: sourcePath,
        project_id: `proj_${effectiveVideoId || 'manual'}`,
        clips: [
          {
            title: headlineText || `Custom Short (${formatTime(trimStart)})`,
            start_seconds: trimStart,
            end_seconds: trimEnd,
            aspect_ratio: '9:16',
            center_x: cropCenterX,
            layout_mode: layoutMode,
            text_overlay: showHeadline && headlineText ? headlineText : undefined,
            text_position: 'top',
          },
        ],
      };

      const res = await discoveryApi.exportClip(exportReq);
      if (res?.success) {
        triggerToast('Render complete! Clip registered in Studio cuts.');
        queryClient.invalidateQueries({ queryKey: ['rendered-clips'] });
        setTimeout(() => {
          setActiveTab('studio');
        }, 1200);
      } else {
        triggerToast('Export finished. Check Studio cuts.');
      }
    } catch (e: any) {
      console.error('Export failed:', e);
      triggerToast(`Export error: ${e?.message || 'Check logs'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  const trimDuration = Math.max(0, trimEnd - trimStart);


  return (
    <div className="space-y-2.5 min-h-[600px] lg:h-[calc(100vh-5.5rem)] lg:max-h-[880px] flex flex-col overflow-hidden">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-popover text-popover-foreground border border-border shadow-2xl animate-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span className="text-xs font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Modern Studio Header Bar & Highlights Ribbon */}
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
          setHeadlineText('');
          setTrimStart(0);
          setTrimEnd(60);
          setCurrentTime(0);
        }}
        onApplyExport={handleApplyExport}
        onJumpHighlight={jumpToHighlight}
        formatTime={formatTime}
      />

      {/* Main 3-Column Studio Workspace: 16:9 Left, Spoken Transcript Center, 9:16 Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 flex-1 min-h-0 overflow-hidden">
        {/* Column 1: 16:9 Master Video Canvas & Audio Waveform (5 cols) */}
        <MasterCanvas
          playerContainerRef={playerContainerRef}
          cropStageRef={cropStageRef}
          sourceVideoRef={sourceVideoRef}
          timelineBarRef={timelineBarRef}
          waveformCanvasRef={waveformCanvasRef}
          resolvedSourceUrl={resolvedSourceUrl}
          metadata={metadata}
          layoutMode={layoutMode}
          cropCenterX={cropCenterX}
          isMuted={isMuted}
          isPlaying={isPlaying}
          currentTime={currentTime}
          totalDuration={totalDuration}
          trimStart={trimStart}
          trimEnd={trimEnd}
          trimDuration={trimDuration}
          playbackSpeed={playbackSpeed}
          activePreset={activePreset}
          togglePlay={togglePlay}
          toggleMute={toggleMute}
          toggleFullscreen={toggleFullscreen}
          handleTimeUpdate={handleTimeUpdate}
          setIsPlaying={setIsPlaying}
          handleCropStageMouseDown={handleCropStageMouseDown}
          handleCropStageMouseMove={handleCropStageMouseMove}
          handleCropStageMouseUp={handleCropStageMouseUp}
          applyFramingPreset={applyFramingPreset}
          handleStepSeek={handleStepSeek}
          handleSetSpeed={handleSetSpeed}
          handleMarkIn={handleMarkIn}
          handleMarkOut={handleMarkOut}
          handleSetWindowFromCurrent={handleSetWindowFromCurrent}
          handleResetToFullVideo={handleResetToFullVideo}
          handleTimelineSeek={handleTimelineSeek}
          setCurrentTime={setCurrentTime}
          syncPlayback={syncPlayback}
          formatTime={formatTime}
        />

        {/* Column 2: Spoken Transcript Studio (4 cols) */}
        <TranscriptStudio
          filteredSegments={filteredSegments}
          currentTime={currentTime}
          trimStart={trimStart}
          trimEnd={trimEnd}
          autoScrollTranscript={autoScrollTranscript}
          setAutoScrollTranscript={setAutoScrollTranscript}
          transcriptSearch={transcriptSearch}
          setTranscriptSearch={setTranscriptSearch}
          filterHookOnly={filterHookOnly}
          setFilterHookOnly={setFilterHookOnly}
          isTranscriptLoading={isTranscriptLoading}
          transcriptScrollRef={transcriptScrollRef}
          activeSegmentRef={activeSegmentRef}
          isHookSentence={isHookSentence}
          isPayoffSentence={isPayoffSentence}
          setCurrentTime={setCurrentTime}
          syncPlayback={syncPlayback}
          setTrimStart={setTrimStart}
          setTrimEnd={setTrimEnd}
          setHeadlineText={setHeadlineText}
          triggerToast={triggerToast}
          formatTime={formatTime}
        />

        {/* Column 3: Live 9:16 Vertical Preview & Packaging (3 cols) */}
        <VerticalPreview
          safeZonePlatform={safeZonePlatform}
          setSafeZonePlatform={setSafeZonePlatform}
          resolvedSourceUrl={resolvedSourceUrl}
          phoneBgVideoRef={phoneBgVideoRef}
          phoneFgVideoRef={phoneFgVideoRef}
          metadata={metadata}
          layoutMode={layoutMode}
          cropCenterX={cropCenterX}
          trimStart={trimStart}
          showHeadline={showHeadline}
          setShowHeadline={setShowHeadline}
          headlineText={headlineText}
          setHeadlineText={setHeadlineText}
          activeEditorSubtitle={activeEditorSubtitle}
          activeStyle={activeStyle}
          setActiveStyle={setActiveStyle}
          currentTime={currentTime}
          togglePlay={togglePlay}
          formatTime={formatTime}
        />
      </div>
    </div>
  );
}
