'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Share2,
  Calendar,
  CheckCircle2,
  Clock,
  Send,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Plus,
  AlertTriangle,
  RotateCcw,
  Info,
  Youtube,
  Globe,
  Inbox,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface PublishReceipt {
  receipt_id: string;
  clip_id: string;
  idempotency_key?: string;
  status: string;
  timestamp: string;
  target_mode: string;
  dry_run?: boolean;
  title?: string;
  source_id?: string;
  duration_seconds?: number;
  video_url?: string;
  error?: string;
  payload?: any;
}

interface ChannelsResponse {
  dedicated_youtube?: {
    connected: boolean;
    channel_id?: string;
    channel_title?: string;
    channel_handle?: string;
    subscriber_count?: string;
    env_mode?: string;
  };
  omnipost_gateway?: {
    status?: string;
    code?: number;
    body?: string;
  };
  channels?: any[];
  ready?: boolean;
}

export function PublishingView() {
  const queryClient = useQueryClient();
  const [retryingReceiptId, setRetryingReceiptId] = React.useState<string | null>(null);
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);

  // Fetch genuine connected channels from backend
  const {
    data: channelsData,
    isLoading: isChannelsLoading,
    refetch: refetchChannels,
  } = useQuery<ChannelsResponse>({
    queryKey: ['publish-channels'],
    queryFn: () => api.publishing.getChannels() as unknown as Promise<ChannelsResponse>,
    staleTime: 1000 * 30,
  });

  // Fetch genuine publication history from backend
  const {
    data: history = [],
    isLoading: isHistoryLoading,
    refetch: refetchHistory,
  } = useQuery<PublishReceipt[]>({
    queryKey: ['publish-history'],
    queryFn: () => api.publishing.getHistory() as unknown as Promise<PublishReceipt[]>,
    staleTime: 1000 * 15,
  });

  const handleRefresh = () => {
    refetchChannels();
    refetchHistory();
  };

  const handleRetry = async (receiptId: string) => {
    setRetryingReceiptId(receiptId);
    try {
      const res = await api.publishing.retry(receiptId);
      setToastMessage(`Retry submitted for receipt ${receiptId} (Status: ${res.status || 'OK'})`);
      queryClient.invalidateQueries({ queryKey: ['publish-history'] });
    } catch (err: any) {
      setToastMessage(`Retry failed: ${err.message || 'Server error'}`);
    } finally {
      setRetryingReceiptId(null);
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const yt = channelsData?.dedicated_youtube;
  const isYtConnected = !!yt?.connected;
  const omniGateway = channelsData?.omnipost_gateway;
  const isOmniOnline = omniGateway?.status === 'healthy' || omniGateway?.code === 200;

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg bg-popover text-popover-foreground border border-border shadow-2xl animate-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-xs font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Multi-Platform Social Distribution
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Publishing gateway connected to Dedicated YouTube Data API v3 and multi-platform social distribution.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isChannelsLoading || isHistoryLoading}
            className="h-8 gap-1.5 text-xs cursor-pointer shadow-xs"
          >
            <RefreshCw
              className={cn('w-3.5 h-3.5', (isChannelsLoading || isHistoryLoading) && 'animate-spin')}
            />
            Refresh Receipts
          </Button>
          <Badge
            variant="outline"
            className={cn(
              'px-2.5 py-1 text-xs border',
              isYtConnected || isOmniOnline
                ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/10'
                : 'border-amber-500/30 text-amber-500 bg-amber-500/10'
            )}
          >
            <Info className="w-3.5 h-3.5 mr-1" />
            {isYtConnected ? 'YouTube Dedicated Online' : 'Dedicated Gateway Standby'}
          </Badge>
        </div>
      </div>

      {/* Connected Channels Shelf — Derived from /api/v1/publish/channels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {/* Dedicated YouTube Channel */}
        <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-3.5 tactile-panel">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold flex items-center justify-center shrink-0">
                <Youtube className="w-4 h-4" />
              </span>
              <div>
                <h4 className="text-xs font-bold text-foreground">YouTube Dedicated Channel</h4>
                <p className="text-[11px] text-muted-foreground truncate font-mono">
                  {yt?.channel_title && yt.channel_title !== 'None'
                    ? yt.channel_title
                    : yt?.channel_id || 'Not Configured'}
                </p>
              </div>
            </div>
            <Badge
              variant={isYtConnected ? 'success' : 'outline'}
              className="text-[9px] px-1.5 py-0 font-medium"
            >
              {isYtConnected ? 'Connected' : 'Offline'}
            </Badge>
          </div>
          <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground flex justify-between font-mono tnum">
            <span>Subscribers:</span>
            <span className="font-semibold text-foreground">
              {isYtConnected && yt?.subscriber_count != null ? Number(yt.subscriber_count).toLocaleString() : '--'}
            </span>
          </div>
        </Card>

        {/* OmniPost Multi-Platform Gateway */}
        <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-3.5 tactile-panel">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0">
                <Globe className="w-4 h-4" />
              </span>
              <div>
                <h4 className="text-xs font-bold text-foreground">Social Multi-Gateway</h4>
                <p className="text-[11px] text-muted-foreground truncate font-mono">
                  Port :3000 Microservice
                </p>
              </div>
            </div>
            <Badge
              variant={isOmniOnline ? 'success' : 'outline'}
              className="text-[9px] px-1.5 py-0 font-medium"
            >
              {isOmniOnline ? 'Active' : 'Standby / Auth Req'}
            </Badge>
          </div>
          <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground flex justify-between font-mono tnum">
            <span>Targets:</span>
            <span className="font-semibold text-foreground">TikTok, Reels, X, Shorts</span>
          </div>
        </Card>

        {/* Local Folder / Watched Assets Storage */}
        <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-3.5 tactile-panel">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-bold flex items-center justify-center shrink-0">
                <Share2 className="w-4 h-4" />
              </span>
              <div>
                <h4 className="text-xs font-bold text-foreground">Local Media Pipeline</h4>
                <p className="text-[11px] text-muted-foreground truncate font-mono">
                  data/rendered_clips/
                </p>
              </div>
            </div>
            <Badge variant="success" className="text-[9px] px-1.5 py-0 font-medium">
              Ready
            </Badge>
          </div>
          <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground flex justify-between font-mono tnum">
            <span>Exports:</span>
            <span className="font-semibold text-foreground">{history.length} Receipts Logged</span>
          </div>
        </Card>
      </div>

      {/* Main Publication Receipts Queue — From /api/v1/publish/history */}
      <Card className="bg-card/70 backdrop-blur-xs border-border/80 tactile-panel">
        <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            Publication Ledger & Verified Receipts
          </CardTitle>
          <Badge variant="outline" className="text-xs font-mono tnum">
            {history.length} Receipts in Ledger
          </Badge>
        </CardHeader>

        <CardContent className="p-4 space-y-3">
          {isHistoryLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-2">
              <RefreshCw className="w-6 h-6 text-primary animate-spin" />
              <p className="text-xs text-muted-foreground">Loading publication receipts from ledger...</p>
            </div>
          ) : history.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-2">
              <Inbox className="w-8 h-8 text-muted-foreground opacity-40 mb-1" />
              <p className="text-sm font-semibold text-foreground">No Publication Receipts Logged</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Select an exported short in Studio and dispatch a publication request to record genuine receipts in the SQLite ledger.
              </p>
            </div>
          ) : (
            history.map((receipt) => {
              const isDelivered = receipt.status === 'DELIVERED';
              const isSimulated = receipt.status === 'DRY_RUN_SIMULATED' || receipt.dry_run;
              const isFailed = receipt.status === 'FAILED' || !!receipt.error;

              return (
                <div
                  key={receipt.receipt_id}
                  className="p-3.5 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          isDelivered
                            ? 'success'
                            : isSimulated
                            ? 'outline'
                            : isFailed
                            ? 'destructive'
                            : 'secondary'
                        }
                        className="text-[10px] uppercase font-mono px-2 py-0"
                      >
                        {receipt.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono tnum flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(receipt.timestamp)}
                      </span>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        [{receipt.target_mode}]
                      </span>
                    </div>

                    <h4 className="text-sm font-semibold text-foreground line-clamp-1">
                      {receipt.title || receipt.clip_id}
                    </h4>

                    {receipt.error && (
                      <p className="text-xs text-rose-500 font-mono flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        {receipt.error}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground font-mono">
                      <span>Receipt: <strong className="text-foreground font-medium">{receipt.receipt_id}</strong></span>
                      {receipt.source_id && (
                        <span>• Source: {receipt.source_id}</span>
                      )}
                      {receipt.duration_seconds != null && receipt.duration_seconds > 0 && (
                        <span>• {Math.round(receipt.duration_seconds)}s</span>
                      )}
                      <span>• Clip: {receipt.clip_id}</span>
                      {receipt.video_url && (
                        <>
                          <span>•</span>
                          <a
                            href={receipt.video_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-0.5"
                          >
                            View Media <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isFailed ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRetry(receipt.receipt_id)}
                        disabled={retryingReceiptId === receipt.receipt_id}
                        className="h-8 text-xs gap-1.5 text-rose-500 hover:text-rose-400 border-rose-500/30 cursor-pointer"
                      >
                        <RotateCcw
                          className={cn(
                            'w-3.5 h-3.5',
                            retryingReceiptId === receipt.receipt_id && 'animate-spin'
                          )}
                        />
                        Retry
                      </Button>
                    ) : (
                      <Badge variant="outline" className="text-xs font-mono py-1 px-2.5">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-500" />
                        Verified Receipt
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
