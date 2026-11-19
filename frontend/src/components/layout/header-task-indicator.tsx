'use client';

import * as React from 'react';
import { useTaskStore, BackgroundTask } from '@/lib/store/task-store';
import { useUiStore } from '@/lib/store/ui-store';
import { RefreshCw, CheckCircle2, AlertCircle, Maximize2, X, Play, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function HeaderTaskIndicator() {
  const { tasks, minimizeTask, restoreTask, dismissTask } = useTaskStore();
  const { setActiveTab } = useUiStore();
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const allTasks = Object.values(tasks);
  // Show tasks that are minimized (running in background), or completed, or failed
  const backgroundRunningTasks = allTasks.filter((t) => t.status === 'running' && t.isMinimized);
  const completedTasks = allTasks.filter((t) => t.status === 'completed');
  const failedTasks = allTasks.filter((t) => t.status === 'failed');

  const visibleTasks = [...backgroundRunningTasks, ...completedTasks, ...failedTasks];

  // Auto-dismiss completed tasks after 15 seconds
  React.useEffect(() => {
    if (completedTasks.length > 0) {
      const timer = setTimeout(() => {
        completedTasks.forEach((t) => dismissTask(t.id));
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [completedTasks, dismissTask]);

  // Close popup menu on outside click
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (visibleTasks.length === 0) {
    return null;
  }

  // Current primary task to display in the header pill
  const activeTask = backgroundRunningTasks[0] || completedTasks[0] || failedTasks[0];
  if (!activeTask) return null;

  const isRunning = activeTask.status === 'running';
  const isCompleted = activeTask.status === 'completed';
  const isFailed = activeTask.status === 'failed';

  const handlePillClick = () => {
    if (isRunning) {
      restoreTask(activeTask.id);
    } else if (isCompleted) {
      setActiveTab('studio');
      dismissTask(activeTask.id);
    } else {
      setIsMenuOpen((prev) => !prev);
    }
  };

  return (
    <div className="relative inline-flex items-center animate-in fade-in slide-in-from-top-1.5 duration-200" ref={menuRef}>
      {/* Header Pill */}
      <button
        type="button"
        onClick={handlePillClick}
        title={
          isRunning
            ? `Click to restore task window (${activeTask.progress}%)`
            : isCompleted
            ? 'Click to preview rendered shorts in Studio'
            : 'View task details'
        }
        className={cn(
          'group relative flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-medium border shadow-xs transition-all duration-200 cursor-pointer overflow-hidden select-none',
          isRunning &&
            'bg-primary/10 border-primary/30 text-foreground hover:bg-primary/20 hover:border-primary/50 ring-1 ring-primary/20',
          isCompleted &&
            'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 ring-1 ring-emerald-500/20',
          isFailed &&
            'bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20'
        )}
      >
        {/* Subtle background progress bar filling the pill width */}
        {isRunning && (
          <div
            className="absolute left-0 bottom-0 top-0 bg-primary/15 transition-all duration-300 pointer-events-none"
            style={{ width: `${activeTask.progress}%` }}
          />
        )}

        {/* Status Icon */}
        {isRunning && (
          <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin shrink-0 relative z-10" />
        )}
        {isCompleted && (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 relative z-10" />
        )}
        {isFailed && (
          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 relative z-10" />
        )}

        {/* Pill Content */}
        <div className="flex items-center gap-1.5 relative z-10 min-w-0">
          <span className="font-semibold truncate max-w-[120px] sm:max-w-[160px] md:max-w-[210px]">
            {isRunning && (
              <>
                <span className="text-primary font-bold">
                  {backgroundRunningTasks.length === 1 ? '1 task running' : `${backgroundRunningTasks.length} tasks running`}
                </span>
                <span className="hidden sm:inline text-muted-foreground ml-1.5 font-normal">
                  · {activeTask.title}
                </span>
              </>
            )}
            {isCompleted && (
              <>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">1 task complete</span>
                <span className="hidden sm:inline text-muted-foreground ml-1.5 font-normal">
                  · Ready in Studio
                </span>
              </>
            )}
            {isFailed && (
              <>
                <span className="text-destructive font-bold">Task notice</span>
                <span className="hidden sm:inline text-muted-foreground ml-1.5 font-normal">
                  · {activeTask.title}
                </span>
              </>
            )}
          </span>

          {/* Live Progress Tag */}
          {isRunning && (
            <span className="px-1.5 py-0.2 rounded bg-primary text-primary-foreground font-bold text-[10px] shrink-0 font-mono">
              {activeTask.progress}%
            </span>
          )}

          {isCompleted && (
            <span className="hidden md:inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/20 px-1.5 py-0.2 rounded shrink-0">
              Open <ChevronRight className="w-2.5 h-2.5" />
            </span>
          )}
        </div>

        {/* Maximize / Dismiss button on hover */}
        {isRunning && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              restoreTask(activeTask.id);
            }}
            className="hidden sm:flex items-center justify-center p-0.5 rounded text-muted-foreground hover:text-foreground relative z-10"
            title="Restore modal window"
          >
            <Maximize2 className="w-3 h-3" />
          </div>
        )}

        {(isCompleted || isFailed) && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              dismissTask(activeTask.id);
            }}
            className="flex items-center justify-center p-0.5 rounded text-muted-foreground hover:text-foreground relative z-10"
            title="Dismiss notification"
          >
            <X className="w-3 h-3" />
          </div>
        )}
      </button>

      {/* Dropdown Menu / Detail Card (if multiple tasks or clicked) */}
      {isMenuOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border shadow-2xl rounded-xl p-3 z-50 space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-border/50">
            <span className="text-xs font-bold text-foreground">Background Tasks ({allTasks.length})</span>
            <button
              onClick={() => setIsMenuOpen(false)}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Close
            </button>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {allTasks.map((t) => (
              <div
                key={t.id}
                className="p-2.5 rounded-lg bg-muted/40 border border-border/60 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground truncate">{t.title}</span>
                  <span
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded uppercase font-bold',
                      t.status === 'running' && 'bg-primary/20 text-primary',
                      t.status === 'completed' && 'bg-emerald-500/20 text-emerald-500',
                      t.status === 'failed' && 'bg-destructive/20 text-destructive'
                    )}
                  >
                    {t.status === 'running' ? `${t.progress}%` : t.status}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">{t.statusText}</p>

                {t.status === 'running' && (
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all duration-300"
                      style={{ width: `${t.progress}%` }}
                    />
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  {t.status === 'running' && (
                    <button
                      onClick={() => {
                        restoreTask(t.id);
                        setIsMenuOpen(false);
                      }}
                      className="text-[11px] text-primary hover:underline font-medium"
                    >
                      Expand
                    </button>
                  )}
                  {t.status === 'completed' && (
                    <button
                      onClick={() => {
                        setActiveTab('studio');
                        dismissTask(t.id);
                        setIsMenuOpen(false);
                      }}
                      className="text-[11px] text-emerald-500 hover:underline font-medium"
                    >
                      Open in Studio
                    </button>
                  )}
                  <button
                    onClick={() => dismissTask(t.id)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
