'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Activity, Cpu, HardDrive } from 'lucide-react';

export function GovernorPill() {
  const { data: governor, isLoading } = useQuery({
    queryKey: ['system-governor'],
    queryFn: () => api.governor.getStatus(),
    refetchInterval: 5000,
  });

  const cpuCores = governor?.cpu_cores;
  const ramGb = governor?.rss_memory_mb != null ? (governor.rss_memory_mb / 1024).toFixed(1) : null;
  const activeRenders = governor?.active_render_jobs;

  return (
    <div className="flex items-center gap-2 px-3 py-1 text-xs font-mono rounded-full bg-muted/60 border border-border">
      <div className="flex items-center gap-1 text-muted-foreground" title="Active CPU Cores">
        <Cpu className="w-3.5 h-3.5" />
        <span>{isLoading || cpuCores == null ? '--' : `${cpuCores}c`}</span>
      </div>
      <div className="w-px h-3 bg-border" />
      <div className="flex items-center gap-1 text-muted-foreground" title="Process RSS Memory">
        <HardDrive className="w-3.5 h-3.5" />
        <span>{isLoading || ramGb == null ? '--' : `${ramGb}G`}</span>
      </div>
      <div className="w-px h-3 bg-border" />
      <div className="flex items-center gap-1" title="Active Render Jobs">
        <Activity
          className={`w-3.5 h-3.5 ${
            (activeRenders ?? 0) > 0 ? 'text-amber-500 animate-pulse' : 'text-emerald-500'
          }`}
        />
        <span className="font-semibold">{isLoading || activeRenders == null ? '--' : `${activeRenders} active`}</span>
      </div>
    </div>
  );
}
