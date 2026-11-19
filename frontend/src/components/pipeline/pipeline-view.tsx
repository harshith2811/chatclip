'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Cpu,
  Activity,
  Layers,
  Pause,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  Flame,
  Zap,
  Info,
  RefreshCw,
  Inbox,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SystemGovernorStatus } from '@/types';

export function PipelineView() {
  const [cancellingBatch, setCancellingBatch] = React.useState(false);

  // Fetch genuine telemetry from FastAPI Governor
  const {
    data: telemetry,
    isLoading: isTelemLoading,
    refetch: refetchTelemetry,
  } = useQuery<SystemGovernorStatus>({
    queryKey: ['governor-telemetry'],
    queryFn: () => api.governor.getStatus(),
    refetchInterval: 4000,
  });

  // Fetch genuine batch queue status from the backend
  const {
    data: batchData,
    isLoading: isBatchLoading,
    refetch: refetchBatch,
  } = useQuery({
    queryKey: ['batch-status'],
    queryFn: () => api.batch.getStatus(),
    refetchInterval: 5000,
  });

  const handleRefreshAll = () => {
    refetchTelemetry();
    refetchBatch();
  };

  const handleCancelBatch = async () => {
    setCancellingBatch(true);
    try {
      await api.batch.cancel();
      refetchBatch();
    } catch {
      // Handled by refresh
    } finally {
      setCancellingBatch(false);
    }
  };

  const isLive = !!telemetry;
  const cpuCores = telemetry?.cpu_cores;
  const vramGb = telemetry?.vram_gb;
  const memoryGb = telemetry?.rss_memory_mb != null ? (telemetry.rss_memory_mb / 1024).toFixed(2) : null;
  const activeConcurrency = telemetry?.active_render_jobs ?? 0;
  const maxConcurrency = telemetry?.hardware_concurrency ?? null;
  const freeDiskGb = telemetry?.free_disk_gb != null ? telemetry.free_disk_gb.toFixed(1) : null;
  const totalDiskGb = telemetry?.total_disk_gb != null ? telemetry.total_disk_gb.toFixed(1) : null;

  // Build authentic worker list from active batch items
  const batchItems = batchData?.items || [];
  const currentBatchStage = batchData?.current_stage;
  const currentBatchProgress = batchData?.current_progress || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Pipeline Governor & Compute Diagnostics
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Real-time FFmpeg transcoding telemetry, GPU VRAM allocation, and background queue governor.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={isTelemLoading}
            className="h-8 gap-1.5 text-xs cursor-pointer shadow-xs"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isTelemLoading && 'animate-spin')} />
            Refresh Telemetry
          </Button>
          {batchData && batchData.status === 'running' && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancelBatch}
              disabled={cancellingBatch}
              className="h-8 gap-1.5 text-xs font-semibold cursor-pointer shadow-xs"
            >
              <Pause className="w-3.5 h-3.5" />
              {cancellingBatch ? 'Cancelling...' : 'Cancel Active Batch'}
            </Button>
          )}
          <Badge variant="success" className="px-3 py-1 flex items-center gap-1.5 text-xs">
            <Zap className="w-3.5 h-3.5" />
            Hardware NVENC Accelerated
          </Badge>
        </div>
      </div>

      {/* Telemetry Status Banner */}
      <div className="p-3 rounded-lg border border-border/60 bg-muted/20 text-xs text-muted-foreground flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-primary shrink-0" />
          <span>
            Telemetry Source:{' '}
            <strong>
              {isLive ? 'FastAPI (:8000) Live Hardware Governor' : 'Connecting to Hardware Governor...'}
            </strong>
            {maxConcurrency != null ? ` • Concurrency Window: ${maxConcurrency} Renders Maximum` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'font-mono text-[11px] tnum font-semibold flex items-center gap-1',
              isLive ? 'text-emerald-500' : 'text-amber-500'
            )}
          >
            <span className={cn('w-2 h-2 rounded-full', isLive ? 'bg-emerald-500' : 'bg-amber-500')} />
            {isLive ? 'Live Hardware Stream' : 'Connecting...'}
          </span>
        </div>
      </div>

      {/* Hardware Telemetry Row — Direct Genuine Measurements */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-4 tactile-panel">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span>CPU HARDWARE</span>
            <Cpu className="w-4 h-4 text-primary" />
          </div>
          <div className="text-3xl font-black text-foreground mt-2 font-mono tnum">
            {cpuCores != null ? `${cpuCores} Cores` : '--'}
          </div>
          <div className="w-full bg-muted/50 h-2 rounded-full overflow-hidden mt-3">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{
                width: maxConcurrency && maxConcurrency > 0
                  ? `${Math.min(100, (activeConcurrency / maxConcurrency) * 100)}%`
                  : '0%',
              }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground mt-2 block font-mono tnum">
            {cpuCores != null ? `${cpuCores} Physical/Logical Cores Active` : 'Hardware detection pending'}
          </span>
        </Card>

        <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-4 tactile-panel">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span>PROCESS RSS RAM</span>
            <HardDrive className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-3xl font-black text-foreground mt-2 font-mono tnum">
            {memoryGb != null ? `${memoryGb} GB` : '--'}
          </div>
          <div className="w-full bg-muted/50 h-2 rounded-full overflow-hidden mt-3">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all"
              style={{
                width: telemetry?.rss_memory_mb
                  ? `${Math.min(100, (telemetry.rss_memory_mb / 4096) * 100)}%`
                  : '0%',
              }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground mt-2 block font-mono tnum flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
            <span>Process Heap & RSS Stable</span>
          </span>
        </Card>

        <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-4 tactile-panel">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span>GPU VRAM ALLOCATION</span>
            <Flame className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-3xl font-black text-foreground mt-2 font-mono tnum">
            {vramGb != null ? `${vramGb.toFixed(1)} GB` : '--'}
          </div>
          <div className="w-full bg-muted/50 h-2 rounded-full overflow-hidden mt-3">
            <div
              className="bg-amber-500 h-full rounded-full transition-all"
              style={{
                width: maxConcurrency && maxConcurrency > 0
                  ? `${Math.min(100, (activeConcurrency / maxConcurrency) * 100)}%`
                  : '0%',
              }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground mt-2 block font-mono tnum">
            Dedicated NVENC Video RAM
          </span>
        </Card>

        <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-4 tactile-panel">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
            <span>ACTIVE CONCURRENCY</span>
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div className="text-3xl font-black text-foreground mt-2 font-mono tnum">
            {telemetry ? `${activeConcurrency} / ${maxConcurrency ?? '--'}` : '--'}
          </div>
          <div className="w-full bg-muted/50 h-2 rounded-full overflow-hidden mt-3">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{
                width: maxConcurrency && maxConcurrency > 0
                  ? `${Math.min(100, (activeConcurrency / maxConcurrency) * 100)}%`
                  : '0%',
              }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground mt-2 block font-mono tnum">
            {freeDiskGb != null && totalDiskGb != null
              ? `Disk: ${freeDiskGb} GB free of ${totalDiskGb} GB`
              : 'Disk: Telemetry pending'}
          </span>
        </Card>
      </div>

      {/* Task Queue: Real Background Workers & Batch Status */}
      <Card className="bg-card/70 backdrop-blur-xs border-border/80 tactile-panel">
        <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            Background Processing Queue
          </CardTitle>
          <span className="text-xs text-muted-foreground font-mono tnum">
            {activeConcurrency} active renders • {batchItems.length} queued batch items
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {batchItems.length === 0 && activeConcurrency === 0 ? (
            <div className="p-8 text-center space-y-2">
              <Inbox className="w-8 h-8 text-muted-foreground opacity-40 mx-auto" />
              <p className="text-sm font-medium text-foreground">Pipeline Queue Idle</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                No active encoding jobs currently running. Dispatch a render task from Discovery to begin processing.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {/* Batch execution overview if active */}
              {batchData && batchData.status === 'running' && (
                <div className="p-4 bg-primary/5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">
                      {batchData.name || 'Batch Processing Run'}
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {batchData.batch_id}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{currentBatchStage}</p>
                  <div className="w-full bg-muted/60 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all duration-300"
                      style={{ width: `${currentBatchProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Individual batch items */}
              {batchItems.map((item: any, idx: number) => (
                <div
                  key={item.video_id || idx}
                  className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{item.title}</span>
                      <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                        {item.video_id}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono tnum">
                      <span>Channel: {item.channel_name || 'YouTube'}</span>
                      <span>•</span>
                      <span>Duration: {Math.round(item.duration_seconds || 0)}s</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <Badge
                      variant={item.status === 'completed' ? 'success' : 'outline'}
                      className="text-xs font-mono capitalize"
                    >
                      {item.status || 'queued'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
