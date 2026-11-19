'use client';

import * as React from 'react';
import type { CandidateHighlight, HighlightCandidate } from '@/types';
import { CandidateCard } from './candidate-card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Zap, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CandidateGridProps {
  candidates: (CandidateHighlight | HighlightCandidate)[];
  selectedCandidateId?: string | null;
  onOpenInEditor: (candidate: CandidateHighlight | HighlightCandidate) => void;
  onRenderHighlight: (candidate: CandidateHighlight | HighlightCandidate) => void;
  onRegenerateCaptions: (candidate: CandidateHighlight | HighlightCandidate) => void;
  regeneratingId?: string | null;
  renderingId?: string | null;
  className?: string;
}

export function CandidateGrid({
  candidates = [],
  selectedCandidateId,
  onOpenInEditor,
  onRenderHighlight,
  onRegenerateCaptions,
  regeneratingId,
  renderingId,
  className,
}: CandidateGridProps) {
  if (candidates.length === 0) {
    return (
      <div className="py-12 text-center rounded-xl border border-dashed border-border/80 p-8 bg-card/40">
        <Layers className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-50" />
        <h3 className="font-semibold text-foreground text-sm">No Highlight Candidates Detected</h3>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
          Provide a video with speech or high engagement spikes to generate automated viral highlights.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-500">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-base text-foreground tracking-tight">
              SolidShorts™ Highlight Candidates
            </h3>
            <p className="text-xs text-muted-foreground">
              Ranked by combined hook score, narrative structure, and retention spike alignment.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-xs font-mono">
            {candidates.length} Highlights Generated
          </Badge>
          <Badge variant="yield" className="text-xs">
            <Zap className="w-3 h-3 mr-1 text-emerald-400" />
            SolidShorts Verified
          </Badge>
        </div>
      </div>

      {/* Responsive Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {candidates.map((candidate, idx) => {
          const candId = 'candidate_id' in candidate ? candidate.candidate_id : `cand-${idx}`;
          const isSelected = selectedCandidateId === candId;

          return (
            <CandidateCard
              key={candId}
              candidate={candidate}
              index={idx}
              isSelected={isSelected}
              onOpenInEditor={onOpenInEditor}
              onRenderHighlight={onRenderHighlight}
              onRegenerateCaptions={onRegenerateCaptions}
              isRegenerating={regeneratingId === candId}
              isRendering={renderingId === candId}
            />
          );
        })}
      </div>
    </div>
  );
}
