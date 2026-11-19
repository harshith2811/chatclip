'use client';

import * as React from 'react';
import type { CandidateHighlight, HighlightCandidate } from '@/types';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Copy, Check, Film, RefreshCw, Sparkles, Clock, Target, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CandidateCardProps {
  candidate: CandidateHighlight | HighlightCandidate;
  index: number;
  isSelected?: boolean;
  onOpenInEditor: (candidate: CandidateHighlight | HighlightCandidate) => void;
  onRenderHighlight: (candidate: CandidateHighlight | HighlightCandidate) => void;
  onRegenerateCaptions: (candidate: CandidateHighlight | HighlightCandidate) => void;
  isRegenerating?: boolean;
  isRendering?: boolean;
}

export function CandidateCard({
  candidate,
  index,
  isSelected = false,
  onOpenInEditor,
  onRenderHighlight,
  onRegenerateCaptions,
  isRegenerating = false,
  isRendering = false,
}: CandidateCardProps) {
  // Card-isolated tab state (zero parent re-renders)
  const [activePlatform, setActivePlatform] = React.useState<'shorts' | 'reels' | 'tiktok' | 'transcript'>('shorts');
  const [copied, setCopied] = React.useState(false);

  const rawScore = candidate.score ?? ('virality_score' in candidate ? candidate.virality_score : null);
  const score = rawScore != null ? Math.round(rawScore) : null;
  const intel = 'intelligence' in candidate ? candidate.intelligence : undefined;
  const pkg = 'caption_package' in candidate ? candidate.caption_package : undefined;

  const startSec = candidate.start_seconds;
  const endSec = candidate.end_seconds;
  const durationSec = candidate.duration_seconds || Math.round(endSec - startSec);
  const startTime =
    'start_time' in candidate && candidate.start_time
      ? candidate.start_time
      : `${Math.floor(startSec / 60)}:${Math.floor(startSec % 60).toString().padStart(2, '0')}`;
  const endTime =
    'end_time' in candidate && candidate.end_time
      ? candidate.end_time
      : `${Math.floor(endSec / 60)}:${Math.floor(endSec % 60).toString().padStart(2, '0')}`;
  const hookTitle = candidate.hook_title || ('title' in candidate && candidate.title) || `Candidate Cut #${index + 1}`;
  const whyItWorks =
    ('why_it_works' in candidate && candidate.why_it_works) ||
    intel?.why_it_works ||
    candidate.suggested_description ||
    null;

  // Platform caption resolver
  const captionText = React.useMemo(() => {
    if (!pkg) {
      if ('suggested_description' in candidate && candidate.suggested_description) {
        return candidate.suggested_description;
      }
      return 'Transcript analysis in progress.';
    }

    if (activePlatform === 'shorts') {
      return pkg.platform_variants?.youtube_shorts || pkg.full_copy_caption || pkg.core_summary;
    }
    if (activePlatform === 'reels') {
      return pkg.platform_variants?.instagram_reels || pkg.full_copy_caption || pkg.core_summary;
    }
    if (activePlatform === 'tiktok') {
      return pkg.platform_variants?.tiktok || pkg.full_copy_caption || pkg.core_summary;
    }
    return ('transcript_text' in candidate && candidate.transcript_text) || pkg.core_summary || pkg.full_copy_caption || 'No transcript available.';
  }, [pkg, candidate, activePlatform]);

  const handleCopy = () => {
    navigator.clipboard.writeText(captionText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card
      className={cn(
        'flex flex-col justify-between bg-card/75 backdrop-blur-xs border-border/80 transition-all duration-200 shadow-xs hover:border-primary/50 tactile-panel',
        isSelected && 'ring-2 ring-primary border-primary/60 bg-card/90 shadow-md'
      )}
    >
      <CardHeader className="p-4 sm:p-5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="font-mono text-xs px-2 py-0.5 tnum">
            Highlight #{index + 1}
          </Badge>
          <div className="flex items-center gap-1.5">
            {score != null ? (
              <Badge
                variant={score >= 85 ? 'success' : score >= 70 ? 'default' : 'warning'}
                className="text-xs px-2.5 py-0.5 font-bold font-mono tnum"
              >
                Hook: {score}%
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs px-2.5 py-0.5 font-mono">
                Candidate Cut
              </Badge>
            )}
            <span className="font-mono text-xs text-muted-foreground flex items-center gap-1 tnum">
              <Clock className="w-3 h-3" />
              {startTime} - {endTime} ({durationSec}s)
            </span>
          </div>
        </div>

        <CardTitle className="text-base font-bold mt-2 leading-snug line-clamp-2 text-foreground">
          {hookTitle}
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 sm:px-5 space-y-3 flex-1">
        {/* Why it works explainability */}
        {whyItWorks && (
          <div className="p-2.5 rounded-md bg-muted/40 border border-border/50 text-xs text-muted-foreground leading-relaxed">
            <div className="flex items-center gap-1 font-semibold text-foreground mb-1">
              <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>Why it works:</span>
            </div>
            <p className="line-clamp-3">{whyItWorks}</p>
          </div>
        )}

        {/* Intelligence Quality Metrics */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded bg-muted/20 border border-border/30 flex items-center justify-between">
            <span className="text-muted-foreground">Narrative Quality:</span>
            <span className="font-mono font-semibold text-foreground">
              {intel?.narrative_quality !== undefined && intel?.narrative_quality !== null
                ? `${intel.narrative_quality}/10`
                : '--'}
            </span>
          </div>
          <div className="p-2 rounded bg-muted/20 border border-border/30 flex items-center justify-between">
            <span className="text-muted-foreground">Viral Potential:</span>
            <span className="font-mono font-semibold text-foreground">
              {intel?.estimated_engagement_potential !== undefined && intel?.estimated_engagement_potential !== null
                ? `${intel.estimated_engagement_potential}/10`
                : '--'}
            </span>
          </div>
        </div>

        {/* Card-Isolated Platform Caption Preview Tabs */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between">
            <div className="flex gap-1 border-b border-border/60 pb-1">
              {(['shorts', 'reels', 'tiktok', 'transcript'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActivePlatform(tab)}
                  className={cn(
                    'px-2 py-0.5 text-xs rounded-sm font-medium transition-colors capitalize cursor-pointer select-none',
                    activePlatform === tab
                      ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-6 px-2 text-xs gap-1 cursor-pointer"
              aria-label="Copy caption to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span className="text-emerald-500 font-medium">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </Button>
          </div>

          <div className="p-2.5 rounded bg-muted/30 border border-border/40 font-mono text-xs max-h-24 overflow-y-auto leading-relaxed select-text whitespace-pre-wrap">
            {captionText}
          </div>
        </div>
      </CardContent>

      <CardFooter className="p-4 sm:p-5 pt-3 border-t border-border/40 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenInEditor(candidate)}
          className="text-xs gap-1.5 flex-1 cursor-pointer border-border/80"
        >
          <Film className="w-3.5 h-3.5 text-blue-500" />
          <span>Open in Editor</span>
        </Button>

        <Button
          type="button"
          size="sm"
          disabled={isRendering}
          onClick={() => onRenderHighlight(candidate)}
          className="text-xs gap-1.5 flex-1 bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{isRendering ? 'Queuing...' : 'Render Clip'}</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRegenerateCaptions(candidate)}
          disabled={isRegenerating}
          className="text-xs px-2 cursor-pointer"
          title="Regenerate Captions"
          aria-label="Regenerate AI Captions"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isRegenerating && 'animate-spin text-primary')} />
        </Button>
      </CardFooter>
    </Card>
  );
}
