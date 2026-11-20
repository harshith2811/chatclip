import React from 'react';
import { FileText, Search, ListFilter, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface TranscriptStudioProps {
  filteredSegments: any[];
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  autoScrollTranscript: boolean;
  setAutoScrollTranscript: (val: boolean) => void;
  transcriptSearch: string;
  setTranscriptSearch: (val: string) => void;
  filterHookOnly: boolean;
  setFilterHookOnly: React.Dispatch<React.SetStateAction<boolean>>;
  isTranscriptLoading: boolean;
  transcriptScrollRef: React.RefObject<HTMLDivElement | null>;
  activeSegmentRef: React.RefObject<HTMLDivElement | null>;
  isHookSentence: (text: string) => boolean;
  isPayoffSentence: (text: string) => boolean;
  setCurrentTime: (time: number) => void;
  syncPlayback: (targetTime: number) => void;
  setTrimStart: (start: number) => void;
  setTrimEnd: (end: number) => void;
  setHeadlineText: (text: string) => void;
  triggerToast: (msg: string) => void;
  formatTime: (seconds: number) => string;
}

export const TranscriptStudio: React.FC<TranscriptStudioProps> = ({
  filteredSegments,
  currentTime,
  trimStart,
  trimEnd,
  autoScrollTranscript,
  setAutoScrollTranscript,
  transcriptSearch,
  setTranscriptSearch,
  filterHookOnly,
  setFilterHookOnly,
  isTranscriptLoading,
  transcriptScrollRef,
  activeSegmentRef,
  isHookSentence,
  isPayoffSentence,
  setCurrentTime,
  syncPlayback,
  setTrimStart,
  setTrimEnd,
  setHeadlineText,
  triggerToast,
  formatTime,
}) => {
  return (
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
            onClick={() => setFilterHookOnly((prev) => !prev)}
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
  );
};
