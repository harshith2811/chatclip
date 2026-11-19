'use client';

import * as React from 'react';
import { useTaskStore } from '@/lib/store/task-store';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function GlobalTaskModal() {
  const { tasks, activeModalTaskId, minimizeTask, dismissTask } = useTaskStore();

  if (!activeModalTaskId) return null;

  const activeTask = tasks[activeModalTaskId];
  if (!activeTask || activeTask.isMinimized) return null;

  const isRunning = activeTask.status === 'running';
  const isCompleted = activeTask.status === 'completed';
  const isFailed = activeTask.status === 'failed';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={activeTask.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200 select-none"
    >
      <div className="bg-card border border-border shadow-2xl rounded-2xl p-6 max-w-md w-full space-y-4 animate-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            {isRunning && <RefreshCw className="w-5 h-5 text-primary animate-spin" />}
            {isCompleted && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
            {isFailed && <AlertCircle className="w-5 h-5 text-destructive" />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-foreground truncate">{activeTask.title}</h3>
            <p className="text-xs text-muted-foreground font-mono truncate">{activeTask.statusText}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${activeTask.progress}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] font-mono text-muted-foreground">
            <span>NVENC Smart-Crop Engine</span>
            <span className="font-bold text-foreground">{activeTask.progress}%</span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground">Encoding 9:16 Shorts with NVENC GPU</span>
          {isRunning ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => minimizeTask(activeTask.id)}
              className="h-7 text-xs text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1.5"
            >
              Run in Background
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => dismissTask(activeTask.id)}
              className="h-7 text-xs cursor-pointer"
            >
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
