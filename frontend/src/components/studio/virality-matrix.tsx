'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Zap, Flame, Repeat, Info, Award, Star, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { discoveryApi } from '@/lib/api/discovery';

export interface ViralityMetrics {
  compositeScore: number | null;
  hookStrength: number | null;
  narrativeVelocity: number | null;
  visualRetention: number | null;
  loopPolish: number | null;
  rationale: string;
}

interface ViralityMatrixProps {
  metrics?: ViralityMetrics;
  clipId?: string;
  videoId?: string;
  hookTitle?: string;
  className?: string;
}

export function ViralityMatrix({
  metrics,
  clipId,
  videoId,
  hookTitle,
  className,
}: ViralityMatrixProps) {
  const [userRating, setUserRating] = React.useState<number | null>(null);
  const [feedbackSent, setFeedbackSent] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleRate = async (star: number) => {
    setUserRating(star);
    setIsSubmitting(true);
    try {
      if (clipId) {
        await discoveryApi.submitFeedback({
          clip_id: clipId,
          rating: star,
          video_id: videoId,
          hook_title: hookTitle,
          score: metrics?.compositeScore || 80,
        });
        setFeedbackSent(true);
        setTimeout(() => setFeedbackSent(false), 3000);
      }
    } catch (e) {
      console.error('Feedback submit failed', e);
    } finally {
      setIsSubmitting(false);
    }
  };
  if (!metrics) {
    return (
      <Card className={cn('bg-card/70 backdrop-blur-xs border-border/80 tactile-panel p-6 text-center', className)}>
        <Sparkles className="w-8 h-8 text-muted-foreground opacity-40 mx-auto mb-2" />
        <h4 className="text-sm font-semibold text-foreground">No Virality Metrics Available</h4>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          Virality intelligence scores are computed automatically when an AI candidate cut is selected or rendered.
        </p>
      </Card>
    );
  }

  const getTierBadge = (score: number | null) => {
    if (score == null) return { label: 'Pending Evaluation', color: 'bg-muted text-muted-foreground border-border' };
    if (score >= 90) return { label: 'Tier S+ (Viral Outlier)', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' };
    if (score >= 80) return { label: 'Tier A (High Yield)', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30' };
    return { label: 'Tier B (Standard)', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' };
  };

  const tier = getTierBadge(metrics.compositeScore);

  const metricItems = [
    {
      title: 'Hook Strength',
      score: metrics.hookStrength,
      icon: Flame,
      desc: metrics.hookStrength != null ? 'First 3 seconds pattern interrupt' : 'Score pending detection',
      color: 'bg-rose-500',
    },
    {
      title: 'Narrative Velocity',
      score: metrics.narrativeVelocity,
      icon: Zap,
      desc: metrics.narrativeVelocity != null ? 'Pacing & spoken word density' : 'Score pending transcription',
      color: 'bg-amber-500',
    },
    {
      title: 'Visual Retention',
      score: metrics.visualRetention,
      icon: Sparkles,
      desc: metrics.visualRetention != null ? 'Active face tracking & motion' : 'Score pending visual analysis',
      color: 'bg-blue-500',
    },
    {
      title: 'Loop Polish',
      score: metrics.loopPolish,
      icon: Repeat,
      desc: metrics.loopPolish != null ? 'Replay incentive & audio blend' : 'Score pending boundary check',
      color: 'bg-emerald-500',
    },
  ];

  return (
    <Card className={cn('bg-card/70 backdrop-blur-xs border-border/80 tactile-panel', className)}>
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-bold text-foreground">
              Virality Diagnostics Matrix
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn('font-mono text-xs px-2.5 py-0.5 border', tier.color)}>
              <Award className="w-3 h-3 mr-1" />
              {tier.label}
            </Badge>
            <span className="font-mono font-bold text-sm tnum text-primary">
              {metrics.compositeScore != null ? `${metrics.compositeScore}/100` : '--'}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* 2x2 Metric Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {metricItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="p-3 rounded-lg border border-border/60 bg-muted/20 flex flex-col justify-between space-y-2 hover:border-border transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                    <span className="font-medium truncate">{item.title}</span>
                  </div>
                  <span className="font-mono font-bold text-xs text-foreground tnum">
                    {item.score != null ? `${item.score}%` : '--'}
                  </span>
                </div>

                {/* Calibrated Metric Progress Bar */}
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500', item.color)}
                    style={{ width: item.score != null ? `${item.score}%` : '0%' }}
                  />
                </div>

                <p className="text-[11px] text-muted-foreground">{item.desc}</p>
              </div>
            );
          })}
        </div>

        {/* AI Rationale Callout */}
        <div className="p-3 rounded-lg border border-blue-500/25 bg-blue-500/10 dark:bg-blue-500/5 text-xs text-foreground flex gap-2.5 items-start">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-blue-700 dark:text-blue-300 block text-[11px] uppercase tracking-wider">
              AI Editorial Rationale
            </span>
            <p className="text-xs text-muted-foreground leading-relaxed">{metrics.rationale}</p>
          </div>
        </div>

        {/* Creator Evaluation & Dynamic Feedback Loop */}
        <div className="p-3 rounded-lg border border-border/60 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="space-y-0.5">
            <span className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
              Creator Virality Review
            </span>
            <p className="text-[10px] text-muted-foreground">
              Rate this cut to automatically calibrate future candidate scoring weights.
            </p>
          </div>

          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                disabled={isSubmitting}
                onClick={() => handleRate(star)}
                className={cn(
                  'w-7 h-7 rounded flex items-center justify-center transition-all cursor-pointer border',
                  userRating != null && star <= userRating
                    ? 'bg-amber-500/20 text-amber-500 border-amber-500/40 font-bold'
                    : 'bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted hover:text-foreground'
                )}
                title={`Rate ${star} Star${star > 1 ? 's' : ''}`}
              >
                <Star
                  className={cn(
                    'w-3.5 h-3.5',
                    userRating != null && star <= userRating && 'fill-current'
                  )}
                />
              </button>
            ))}
            {feedbackSent && (
              <Badge variant="success" className="text-[9px] px-1.5 py-0.5 ml-1.5 font-mono">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Calibrated
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
