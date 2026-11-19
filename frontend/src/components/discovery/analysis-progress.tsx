'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Download,
  TrendingUp,
  FileAudio,
  Sparkles,
  Scissors,
  CheckCircle2,
  RefreshCw,
  Clock,
  Terminal,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AnalysisProgressProps {
  videoId: string | null;
  videoTitle?: string;
  className?: string;
}

interface StepDefinition {
  id: string;
  stepNum: number;
  label: string;
  title: string;
  description: string;
  detail: string;
  icon: React.ElementType;
  durationThreshold: number; // seconds after which step is marked complete
}

const ANALYSIS_STEPS: StepDefinition[] = [
  {
    id: 'download',
    stepNum: 1,
    label: 'DOWNLOADING',
    title: 'Stream Ingestion & Metadata Resolution',
    description: 'Resolving YouTube stream endpoints, downloading audio stream, and checking rights manifest.',
    detail: 'Connecting to YouTube Ingestion Gateway • 128kbps AAC • Checking CC-BY licensing provenance',
    icon: Download,
    durationThreshold: 3.0,
  },
  {
    id: 'heatmap',
    stepNum: 2,
    label: 'RETENTION HEATMAP',
    title: 'Extracting Audience Engagement Curve',
    description: 'Querying public 100-point topological replay intensity to isolate peak attention spikes.',
    detail: 'Calculating first derivative of replay curve • Normalizing retention velocity across timeline',
    icon: TrendingUp,
    durationThreshold: 6.5,
  },
  {
    id: 'transcription',
    stepNum: 3,
    label: 'TRANSCRIPTION',
    title: 'Audio Demuxing & Speech Token Alignment',
    description: 'Transcribing speech track, computing word timestamps, and measuring speaker pacing (WPM).',
    detail: 'Aligning sentence boundaries • Detecting acoustic dead-air pauses • Pacing calibration',
    icon: FileAudio,
    durationThreshold: 11.0,
  },
  {
    id: 'virality',
    stepNum: 4,
    label: 'AI VIRALITY SCORING',
    title: 'Neural Hook Analysis & Composite Scoring',
    description: 'Evaluating 4D virality index: hook strength, narrative velocity, visual clarity, and loop polish.',
    detail: 'Scoring pattern interrupt (first 3s) • Formulating AI hook titles • Ranking highlight candidates',
    icon: Sparkles,
    durationThreshold: 16.0,
  },
  {
    id: 'framing',
    stepNum: 5,
    label: 'HIGHLIGHT FRAMING',
    title: 'Isolating 9:16 Windows & Smart Framing',
    description: 'Formulating optimal 15–60s cut windows and computing YuNet face-tracking crop coordinates.',
    detail: 'Synthesizing SolidShorts packaging • Prepping candidate preview cards for Studio Workspace',
    icon: Scissors,
    durationThreshold: 22.0,
  },
];

export function AnalysisProgress({ videoId, videoTitle, className }: AnalysisProgressProps) {
  const [elapsed, setElapsed] = React.useState<number>(0);

  React.useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsed((Date.now() - startTime) / 1000);
    }, 100);

    return () => clearInterval(timer);
  }, []);

  // Determine current active step (0-indexed)
  const currentStepIndex = React.useMemo(() => {
    for (let i = 0; i < ANALYSIS_STEPS.length; i++) {
      if (elapsed < ANALYSIS_STEPS[i].durationThreshold) {
        return i;
      }
    }
    return ANALYSIS_STEPS.length - 1; // Stay on last step until query completes
  }, [elapsed]);

  const activeStep = ANALYSIS_STEPS[currentStepIndex];

  // Calculated overall progress percentage
  const progressPct = React.useMemo(() => {
    const maxTime = 24.0;
    const raw = Math.min(95, Math.round((elapsed / maxTime) * 100));
    return Math.max(8, raw);
  }, [elapsed]);

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1);
    return `${m > 0 ? `${m}m ` : ''}${s}s`;
  };

  return (
    <Card className={cn('p-6 bg-card/80 backdrop-blur-md border-border/80 shadow-md space-y-6 tactile-panel', className)}>
      {/* Top Banner: Stage Status & Live Timer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-primary border-primary/30 font-mono text-[11px] px-2 py-0.5 animate-pulse">
              STEP {activeStep.stepNum} OF {ANALYSIS_STEPS.length}: {activeStep.label}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">
              Target ID: <strong className="text-foreground">{videoId || '--'}</strong>
            </span>
          </div>
          <h3 className="text-lg font-bold text-foreground">
            {activeStep.title}
          </h3>
          <p className="text-xs text-muted-foreground max-w-xl">
            {activeStep.description}
          </p>
        </div>

        <div className="flex sm:flex-col items-center sm:items-end justify-between shrink-0 gap-1 sm:gap-0 font-mono">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5 text-primary" />
            <span>Elapsed:</span>
            <span className="font-bold text-foreground tnum">{formatElapsed(elapsed)}</span>
          </div>
          <span className="text-xs text-emerald-500 font-semibold flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            Zero-Loss Pipeline
          </span>
        </div>
      </div>

      {/* Progress Bar with Percentage */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="text-muted-foreground font-medium flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3 text-primary animate-spin" />
            {activeStep.detail}
          </span>
          <span className="font-bold text-foreground tnum">{progressPct}%</span>
        </div>
        <div className="w-full bg-muted/60 rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-primary h-full rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Step Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {ANALYSIS_STEPS.map((step, idx) => {
          const isComplete = currentStepIndex > idx;
          const isCurrent = currentStepIndex === idx;
          const isPending = currentStepIndex < idx;
          const Icon = step.icon;

          return (
            <div
              key={step.id}
              className={cn(
                'p-3 rounded-lg border text-left transition-all duration-300 flex flex-col justify-between space-y-2',
                isCurrent && 'border-primary/80 bg-primary/5 shadow-xs ring-1 ring-primary/30',
                isComplete && 'border-emerald-500/30 bg-emerald-500/5',
                isPending && 'border-border/40 bg-muted/20 opacity-60'
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'text-[10px] font-mono font-bold tracking-wider uppercase',
                    isCurrent && 'text-primary',
                    isComplete && 'text-emerald-500',
                    isPending && 'text-muted-foreground'
                  )}
                >
                  Step {step.stepNum}
                </span>

                {isComplete ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : isCurrent ? (
                  <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-border" />
                )}
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon
                    className={cn(
                      'w-3.5 h-3.5',
                      isCurrent && 'text-primary',
                      isComplete && 'text-emerald-500',
                      isPending && 'text-muted-foreground'
                    )}
                  />
                  <h4 className="text-xs font-semibold text-foreground truncate">
                    {step.label}
                  </h4>
                </div>
                <p className="text-[11px] text-muted-foreground leading-tight line-clamp-2">
                  {step.title}
                </p>
              </div>

              <div className="pt-1 border-t border-border/30 text-[10px] font-mono">
                {isComplete && <span className="text-emerald-500 font-semibold">Done</span>}
                {isCurrent && <span className="text-primary font-bold animate-pulse">Processing...</span>}
                {isPending && <span className="text-muted-foreground">Queued</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Activity Terminal Strip */}
      <div className="bg-black/80 rounded-lg p-3 text-xs font-mono text-muted-foreground flex items-center gap-2 border border-border/40 select-none overflow-hidden">
        <Terminal className="w-4 h-4 text-emerald-400 shrink-0" />
        <span className="text-emerald-400 font-bold shrink-0">EXEC:</span>
        <span className="text-zinc-200 truncate animate-fade-in key={activeStep.id}">
          [{formatElapsed(elapsed)}] {activeStep.detail}
        </span>
      </div>
    </Card>
  );
}
