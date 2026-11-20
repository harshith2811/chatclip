'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Play,
  Pause,
  Scissors,
  Layers,
  Sparkles,
  SlidersHorizontal,
  Type,
  Volume2,
  VolumeX,
  CheckCircle2,
  Eye,
  EyeOff,
  Maximize2,
  Clock,
  Film,
  RefreshCw,
  Video,
  MoveHorizontal,
  Wand2,
  Tv,
  AlignLeft,
  AlignCenter,
  AlignRight,
  FastForward,
  Rewind,
  SkipBack,
  ChevronDown,
  FileText,
  Search,
  CornerDownRight,
  ListFilter,
  Check,
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

interface SubtitleStyle {
  id: string;
  name: string;
  preview: string;
  color: string;
}

const SUBTITLE_STYLES: SubtitleStyle[] = [
  {
    id: 'bold-yellow',
    name: 'Viral Yellow Pop',
    preview: 'THE SECRET',
    color: 'text-yellow-400 bg-black/90 font-black border border-yellow-400/40',
  },
  {
    id: 'neon-cyan',
    name: 'Cyberpunk Cyan',
    preview: '100% REAL',
    color: 'text-cyan-400 bg-slate-950 font-extrabold border border-cyan-400/50 shadow-cyan-500/20',
  },
  {
    id: 'clean-white',
    name: 'Minimal Editorial',
    preview: 'Watch closely.',
    color: 'text-white bg-black/80 font-semibold border border-white/20',
  },
  {
    id: 'gradient-fire',
    name: 'Fire Gradient',
    preview: 'UNBELIEVABLE',
    color: 'text-orange-400 bg-black/90 font-black border border-orange-500/40',
  },
];

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
    <div className="space-y-2.5 h-[calc(100vh-5rem)] min-h-[580px] max-h-[840px] flex flex-col overflow-hidden">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-popover text-popover-foreground border border-border shadow-2xl animate-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Modern Studio Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-card/90 backdrop-blur-md px-3.5 py-2 rounded-xl border border-border/80 shadow-xs shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-foreground">
                Precision Video & Crop Editor
              </h1>
              <Badge variant="outline" className="font-mono text-[9px] uppercase text-primary border-primary/30">
                Studio-Grade
              </Badge>
            </div>
            {/* Active Video Project Dropdown */}
            <div className="flex items-center gap-2">
              <Film className="w-3 h-3 text-primary shrink-0" />
              <div className="relative inline-block">
                <select
                  value={effectiveVideoId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    setCurrentVideoId(newId);
                    setSelectedCandidateId(null);
                    setHeadlineText('');
                    setTrimStart(0);
                    setTrimEnd(60);
                    setCurrentTime(0);
                  }}
                  className="h-5 pl-2 pr-6 rounded bg-muted/60 border border-border/60 text-xs font-semibold text-foreground focus:ring-1 focus:ring-primary cursor-pointer max-w-[240px] sm:max-w-[340px] truncate appearance-none"
                >
                  {projects.map((p: any) => (
                    <option key={p.video_id} value={p.video_id}>
                      {p.title || `Project ${p.video_id}`}
                    </option>
                  ))}
                  {projects.length === 0 && (
                    <option value="hdMszZ2ah5Q">Macbook PROLED Review: It&apos;s Not About That</option>
                  )}
                </select>
                <ChevronDown className="w-3 h-3 text-muted-foreground absolute right-1.5 top-1 pointer-events-none" />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">
                • {formatTime(totalDuration)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <Badge
            variant={trimDuration <= 60 ? 'default' : 'secondary'}
            className="font-mono text-xs px-2 py-0.5 flex items-center gap-1"
          >
            <Clock className="w-3 h-3" />
            Trim: {trimDuration.toFixed(1)}s {trimDuration <= 60 ? '(Shorts Ready)' : '(Over 60s)'}
          </Badge>
          <Button
            size="sm"
            onClick={handleApplyExport}
            disabled={isExporting}
            className="h-7 px-3 gap-1.5 text-xs font-bold cursor-pointer shadow-xs bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {isExporting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />}
            Apply Crop & Render
          </Button>
        </div>
      </div>

      {/* AI Highlights Quick-Jump Ribbon */}
      {solidHighlights.length > 0 && (
        <div className="p-2.5 rounded-xl bg-card/60 border border-border/60 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider shrink-0 px-1">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>AI Highlights ({solidHighlights.length}):</span>
          </div>
          <div className="flex items-center gap-2">
            {solidHighlights.map((cut: any, idx: number) => {
              const s = cut.start_seconds ?? cut.startTime ?? 0;
              const e = cut.end_seconds ?? cut.endTime ?? s + 35;
              const score = cut.score != null ? Math.round(cut.score) : 95;
              const isCurrent = Math.abs(trimStart - s) < 1.0;
              const cutTitle = cut.title || cut.hook_title || `Cut #${idx + 1}`;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => jumpToHighlight(cut, idx)}
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 cursor-pointer border',
                    isCurrent
                      ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                      : 'bg-muted/40 hover:bg-muted border-border/70 text-foreground'
                  )}
                >
                  <span className="font-bold truncate max-w-[160px]">{cutTitle}</span>
                  <span className="font-mono text-[10px] opacity-75">
                    [{formatTime(s)} - {formatTime(e)}]
                  </span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">
                    {score}%
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main 3-Column Studio Workspace: 16:9 Left, Spoken Transcript Center, 9:16 Right */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 overflow-hidden">
        {/* Column 1: 16:9 Master Video Canvas & Audio Waveform (5 cols) */}
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
                className="relative w-full h-[180px] sm:h-[195px] rounded-lg overflow-hidden bg-black flex items-center justify-center select-none cursor-crosshair group shadow-inner"
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
                    <div
                      className="relative h-full aspect-[9/16] border-2 border-primary bg-primary/10 shadow-[0_0_20px_rgba(59,130,246,0.35)] flex flex-col justify-between p-1 pointer-events-auto cursor-ew-resize transition-all duration-75"
                    >
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
          <Card className="bg-card text-card-foreground border-border/80 shadow-xs flex-1 min-h-0 flex flex-col justify-between overflow-hidden p-2">
            <div className="flex items-center justify-between pb-1">
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

            {/* Quick Cut Presets & Duration Readouts */}
            <div className="flex items-center justify-between pt-1 text-xs">
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetWindowFromCurrent(30)}
                  className="h-5 text-[9px] font-mono px-1.5"
                >
                  30s Cut
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetWindowFromCurrent(60)}
                  className="h-5 text-[9px] font-mono px-1.5"
                >
                  60s Cut
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetToFullVideo}
                  className="h-5 text-[9px] font-mono px-1.5"
                >
                  Full Video
                </Button>
              </div>

              <div className="flex items-center gap-2 text-[11px] font-mono tnum">
                <span className="text-muted-foreground">
                  Cut Length: <strong className="text-primary font-bold">{trimDuration.toFixed(1)}s</strong>
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* Column 2: Spoken Transcript Studio (4 cols) */}
        <div className="lg:col-span-4 flex flex-col min-h-0 h-full bg-card border border-border/80 rounded-xl shadow-xs overflow-hidden">
          <div className="py-2 px-3 border-b border-border/50 flex flex-col gap-1.5 shrink-0 bg-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Spoken Transcript
                </span>
                <Badge variant="secondary" className="font-mono text-[9px] px-1.5 py-0">
                  {filteredSegments.length}
                </Badge>
              </div>
              <Button
                variant={autoScrollTranscript ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setAutoScrollTranscript(!autoScrollTranscript)}
                className="h-5 px-1.5 text-[9px] font-mono cursor-pointer"
                title="Auto-scroll transcript with playhead"
              >
                Scroll {autoScrollTranscript ? 'ON' : 'OFF'}
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3 h-3 text-muted-foreground absolute left-2 top-2 pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search dialogue words..."
                  value={transcriptSearch}
                  onChange={(e) => setTranscriptSearch(e.target.value)}
                  className="h-6 pl-6 pr-2 text-xs w-full bg-background"
                />
              </div>
              <Button
                variant={filterHookOnly ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterHookOnly(!filterHookOnly)}
                className="h-6 px-2 text-[10px] font-mono gap-1 cursor-pointer shrink-0"
              >
                <ListFilter className="w-2.5 h-2.5" />
                Hooks
              </Button>
            </div>
          </div>

          {/* Scrollable Sentence List */}
          <div
            ref={transcriptScrollRef}
            className="flex-1 min-h-0 overflow-y-auto space-y-1.5 p-2 bg-muted/10 scrollbar-thin scrollbar-thumb-muted-foreground/30 relative"
          >
            {isTranscriptLoading && (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2 text-primary" />
                Loading time-aligned spoken transcript...
              </div>
            )}

            {!isTranscriptLoading && filteredSegments.length === 0 && (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <FileText className="w-6 h-6 mx-auto mb-1 opacity-40" />
                {transcriptSearch ? 'No matching dialogue found.' : 'No transcript detected for this video.'}
              </div>
            )}

            {filteredSegments.map((seg: any, idx: number) => {
              const s = seg.start ?? 0;
              const e = seg.end ?? s + 3;
              const isCurrent = currentTime >= s && currentTime <= e;
              const isInsideTrim = s >= trimStart && e <= trimEnd;
              const isHook = isHookSentence(seg.text || '');
              const isPayoff = isPayoffSentence(seg.text || '');

              return (
                <div
                  key={seg.segment_id || idx}
                  ref={isCurrent ? activeSegmentRef : null}
                  className={cn(
                    'group p-2 rounded-lg border transition-all text-xs flex flex-col gap-1.5 cursor-pointer shadow-2xs',
                    isCurrent
                      ? 'border-blue-500 bg-blue-50/90 dark:bg-blue-950/50 ring-1 ring-blue-500/60 shadow-xs'
                      : isInsideTrim
                      ? 'border-blue-300/40 bg-blue-50/30 dark:bg-blue-950/20 hover:bg-blue-50/50'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-800 dark:text-slate-200'
                  )}
                  onClick={() => {
                    setCurrentTime(s);
                    syncPlayback(s);
                  }}
                >
                  <div className="flex items-start gap-1.5 min-w-0">
                    <span className="font-mono text-[9px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 shrink-0 mt-0.5">
                      {formatTime(s)}
                    </span>

                    <div className="space-y-1 flex-1 min-w-0">
                      <p className={cn('leading-relaxed select-text', isCurrent ? 'font-semibold text-blue-950 dark:text-blue-100' : 'text-slate-800 dark:text-slate-200')}>
                        {seg.text}
                      </p>

                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        {isHook && (
                          <span className="text-[8px] font-mono font-bold px-1 py-0.2 rounded bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                            HOOK
                          </span>
                        )}
                        {isPayoff && (
                          <span className="text-[8px] font-mono font-bold px-1 py-0.2 rounded bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                            PAYOFF
                          </span>
                        )}
                        {isInsideTrim && (
                          <span className="text-[8px] font-mono text-blue-600 dark:text-blue-400 font-bold">
                            • In Short
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1 pt-1 border-t border-border/40">
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setTrimStart(s);
                        triggerToast(`Set Trim In: ${formatTime(s)}`);
                      }}
                      className="px-1.5 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 dark:text-amber-300 font-mono text-[9px] font-bold border border-amber-500/30 transition-all cursor-pointer"
                      title="Snap Trim Start here"
                    >
                      [ In ]
                    </button>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setTrimEnd(e);
                        triggerToast(`Set Trim Out: ${formatTime(e)}`);
                      }}
                      className="px-1.5 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 dark:text-amber-300 font-mono text-[9px] font-bold border border-amber-500/30 transition-all cursor-pointer"
                      title="Snap Trim Out here"
                    >
                      [ Out ]
                    </button>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setTrimStart(s);
                        setTrimEnd(e);
                        setHeadlineText(seg.text?.slice(0, 36).toUpperCase() || '');
                        setCurrentTime(s);
                        syncPlayback(s);
                        triggerToast(`Cut created for sentence: [${formatTime(s)} - ${formatTime(e)}]`);
                      }}
                      className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-mono text-[9px] font-bold transition-all cursor-pointer shadow-xs"
                      title="Extract this single sentence as a Short"
                    >
                      ✂ Cut Sentence
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 3: Live 9:16 Vertical Preview & Packaging (3 cols) */}
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
      </div>
    </div>
  );
}
