'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Flame, CheckCircle2, AlertCircle, X, History, Sparkles, TrendingUp } from 'lucide-react';
import { useDiscoveryStore } from '@/lib/store/discovery-store';
import { cn } from '@/lib/utils';

export function parseYouTubeInput(input: string): {
  isValid: boolean;
  videoId: string | null;
  canonicalUrl: string | null;
} {
  if (!input) return { isValid: false, videoId: null, canonicalUrl: null };
  const trimmed = input.trim();

  // 1. Bare 11-char ID
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return {
      isValid: true,
      videoId: trimmed,
      canonicalUrl: `https://www.youtube.com/watch?v=${trimmed}`,
    };
  }

  // 2. Standard watch URL
  const watchMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/i
  );
  if (watchMatch?.[1]) {
    return {
      isValid: true,
      videoId: watchMatch[1],
      canonicalUrl: `https://www.youtube.com/watch?v=${watchMatch[1]}`,
    };
  }

  // 3. Short URL (youtu.be)
  const shortMatch = trimmed.match(
    /(?:https?:\/\/)?youtu\.be\/([A-Za-z0-9_-]{11})/i
  );
  if (shortMatch?.[1]) {
    return {
      isValid: true,
      videoId: shortMatch[1],
      canonicalUrl: `https://www.youtube.com/watch?v=${shortMatch[1]}`,
    };
  }

  // 4. Embed / Shorts / Live URL
  const embedMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/i
  );
  if (embedMatch?.[1]) {
    return {
      isValid: true,
      videoId: embedMatch[1],
      canonicalUrl: `https://www.youtube.com/watch?v=${embedMatch[1]}`,
    };
  }

  return { isValid: false, videoId: null, canonicalUrl: null };
}

export interface UrlIngestionBarProps {
  onAnalyze: (videoId: string, rawUrl: string) => void;
  isLoading?: boolean;
}

export function UrlIngestionBar({ onAnalyze, isLoading = false }: UrlIngestionBarProps) {
  const {
    inputUrl,
    setInputUrl,
    recentHistory,
    removeRecentHistory,
    clearHistory,
    setIsTrendingModalOpen,
  } = useDiscoveryStore();

  const [localInput, setLocalInput] = React.useState(inputUrl);

  // Sync if store inputUrl changes externally (e.g. from trending modal)
  React.useEffect(() => {
    if (inputUrl) {
      setLocalInput(inputUrl);
    }
  }, [inputUrl]);

  const parsed = React.useMemo(() => parseYouTubeInput(localInput), [localInput]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.isValid || !parsed.videoId) return;
    setInputUrl(localInput);
    onAnalyze(parsed.videoId, parsed.canonicalUrl || localInput);
  };

  const handleChipClick = (videoId: string, url: string) => {
    setLocalInput(url);
    setInputUrl(url);
    onAnalyze(videoId, url);
  };

  return (
    <div className="w-full space-y-3">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Input
            value={localInput}
            onChange={(e) => setLocalInput(e.target.value)}
            placeholder="Paste YouTube watch URL, shorts link, embed URL, or 11-char ID..."
            className={cn(
              'pr-10 h-12 text-sm bg-card/70 backdrop-blur-xs border-border/80 focus-visible:ring-2 focus-visible:ring-primary tactile-panel shadow-xs',
              localInput && parsed.isValid && 'border-emerald-500/60 focus-visible:ring-emerald-500',
              localInput && !parsed.isValid && 'border-amber-500/60 focus-visible:ring-amber-500'
            )}
            aria-label="YouTube video URL or 11-character video ID"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
            {localInput ? (
              parsed.isValid ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-label="Valid YouTube URL" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-500" aria-label="Invalid YouTube format" />
              )
            ) : (
              <Search className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            disabled={!parsed.isValid || isLoading}
            className="h-12 px-5 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold cursor-pointer shadow-xs shrink-0 flex-1 sm:flex-initial"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isLoading ? 'Analyzing...' : 'Analyze Video'}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => setIsTrendingModalOpen(true)}
            className="h-12 px-4 gap-2 border-border/80 bg-card/40 hover:bg-card text-foreground cursor-pointer shrink-0"
            aria-label="Open Top 10M Trending Viral Discovery"
          >
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="hidden sm:inline font-medium">Top 10M Viral</span>
          </Button>
        </div>
      </form>

      {/* Helpful Guidance & YouTube Search Action if Non-URL Search Text */}
      {localInput && !parsed.isValid && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>Enter a YouTube link or 11-character video ID (e.g. <code className="font-mono font-semibold">youtube.com/watch?v=...</code>).</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(localInput)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-semibold flex items-center gap-1"
            >
              Search YouTube for &quot;{localInput}&quot; ↗
            </a>
            <button
              type="button"
              onClick={() => setIsTrendingModalOpen(true)}
              className="text-muted-foreground hover:text-foreground font-medium cursor-pointer"
            >
              or Pick from Top 10M Hits
            </button>
          </div>
        </div>
      )}

      {/* Recent Ingestion History Chips */}
      {recentHistory.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground mr-1 select-none">
            <History className="w-3.5 h-3.5" />
            <span>Recent:</span>
          </div>
          {recentHistory.map((item) => (
            <div
              key={item.videoId}
              className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-muted/60 hover:bg-muted border border-border/60 transition-colors cursor-pointer select-none"
              onClick={() => handleChipClick(item.videoId, item.url)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleChipClick(item.videoId, item.url);
              }}
            >
              <span className="font-mono text-muted-foreground text-[11px]">{item.videoId}</span>
              {item.title && (
                <span className="max-w-[130px] truncate text-foreground font-medium">
                  {item.title}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeRecentHistory(item.videoId);
                }}
                className="opacity-40 group-hover:opacity-100 hover:text-destructive p-0.5 rounded-full cursor-pointer"
                title="Remove from history"
                aria-label={`Remove ${item.videoId} from history`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={clearHistory}
            className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1 cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
