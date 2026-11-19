'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUiStore } from '@/lib/store/ui-store';
import { useDiscoveryStore } from '@/lib/store/discovery-store';
import {
  FolderKanban,
  Search,
  Plus,
  Play,
  Film,
  Calendar,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight,
  Download,
  Trash2,
  MoreVertical,
  LayoutGrid,
  List,
  TrendingUp,
  HardDrive,
  RefreshCw,
  Inbox,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProjectRecordItem {
  project_id: string;
  video_id: string;
  title: string;
  canonical_url?: string;
  source_metadata?: {
    video_id?: string;
    title?: string;
    channel_title?: string;
    duration?: number;
    thumbnail_url?: string;
    view_count?: number;
    like_count?: number;
  };
  created_at: string;
  updated_at?: string;
  clips_count: number;
  status: string;
  clips?: Array<{
    clip_id: string;
    filename?: string;
    duration?: number;
    score?: number;
    playback_url?: string;
    poster_url?: string;
    download_url?: string;
    hook_title?: string;
    status?: string;
  }>;
}

export function ProjectsView() {
  const { setActiveTab } = useUiStore();
  const { setCurrentVideoId, setInputUrl } = useDiscoveryStore();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [filterStatus, setFilterStatus] = React.useState<'all' | 'ACTIVE' | 'COMPLETED'>('all');
  const [viewMode, setViewMode] = React.useState<'grid' | 'table'>('grid');

  // Fetch genuine projects from the backend API
  const {
    data: projects = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<ProjectRecordItem[]>({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
    staleTime: 1000 * 15,
  });

  // Calculate authentic aggregate metrics from genuine records
  const totalProjects = projects.length;
  const totalRenderedShorts = React.useMemo(() => {
    return projects.reduce((acc, p) => acc + (p.clips_count || p.clips?.length || 0), 0);
  }, [projects]);

  const avgVirality = React.useMemo(() => {
    let totalScore = 0;
    let scoredClipsCount = 0;
    for (const p of projects) {
      if (p.clips && p.clips.length > 0) {
        for (const c of p.clips) {
          if (c.score && c.score > 0) {
            totalScore += c.score;
            scoredClipsCount += 1;
          }
        }
      }
    }
    if (scoredClipsCount === 0) return null;
    return (totalScore / scoredClipsCount).toFixed(1);
  }, [projects]);

  const filteredProjects = React.useMemo(() => {
    return projects.filter((proj) => {
      const title = proj.title || proj.source_metadata?.title || proj.video_id || '';
      const channel = proj.source_metadata?.channel_title || '';
      const matchesSearch =
        title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        channel.toLowerCase().includes(searchQuery.toLowerCase());
      const statusUpper = (proj.status || 'ACTIVE').toUpperCase();
      const matchesStatus =
        filterStatus === 'all' ||
        (filterStatus === 'ACTIVE' && statusUpper === 'ACTIVE') ||
        (filterStatus === 'COMPLETED' && statusUpper === 'COMPLETED');
      return matchesSearch && matchesStatus;
    });
  }, [projects, searchQuery, filterStatus]);

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  const handleOpenStudio = (proj: ProjectRecordItem) => {
    if (proj.video_id) {
      setCurrentVideoId(proj.video_id);
      if (proj.canonical_url) {
        setInputUrl(proj.canonical_url);
      }
    }
    setActiveTab('studio');
  };

  return (
    <div className="space-y-6">
      {/* Projects Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Project Archives & Workspaces
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Manage your ingested YouTube videos, exported clips, and viral production campaigns.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="h-9 gap-1.5 text-xs cursor-pointer shadow-xs"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            onClick={() => setActiveTab('discovery')}
            className="h-9 gap-2 text-xs font-semibold cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            Ingest New Video
          </Button>
        </div>
      </div>

      {/* Metrics Row — Computed from Authentic Database Records */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-3.5 tactile-panel">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Total Projects
          </span>
          <div className="text-2xl font-black text-foreground mt-1 font-mono tnum">
            {isLoading ? '--' : totalProjects}
          </div>
          <span className="text-[10px] text-muted-foreground font-medium">
            {totalProjects > 0 ? 'Verified in SQLite DB' : 'No projects recorded'}
          </span>
        </Card>
        <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-3.5 tactile-panel">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Rendered Shorts
          </span>
          <div className="text-2xl font-black text-foreground mt-1 font-mono tnum">
            {isLoading ? '--' : totalRenderedShorts}
          </div>
          <span className="text-[10px] text-primary font-medium">
            {totalRenderedShorts > 0 ? 'Rendered MP4s on disk' : 'Awaiting render'}
          </span>
        </Card>
        <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-3.5 tactile-panel">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Avg Virality Score
          </span>
          <div className="text-2xl font-black text-foreground mt-1 font-mono tnum">
            {isLoading ? '--' : avgVirality ? `${avgVirality}` : '--'}
          </div>
          <span className="text-[10px] text-amber-500 font-medium">
            {avgVirality ? 'Across verified clips' : 'Score pending cuts'}
          </span>
        </Card>
        <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-3.5 tactile-panel">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Active Sidecars
          </span>
          <div className="text-2xl font-black text-foreground mt-1 font-mono tnum">
            {isLoading ? '--' : totalRenderedShorts}
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">
            JSON Metadata Sidecars
          </span>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="bg-card/70 backdrop-blur-xs border-border/80 p-3 tactile-panel">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects or channels..."
              className="pl-9 h-9 text-xs bg-background/80"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {(['all', 'ACTIVE', 'COMPLETED'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setFilterStatus(status)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors cursor-pointer',
                    filterStatus === status
                      ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {status === 'all' ? 'All' : status.toLowerCase()}
                </button>
              ))}
            </div>

            {/* View Mode Toggle */}
            <div className="hidden sm:flex items-center gap-1 p-0.5 rounded-lg bg-muted/50 border border-border/60">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={cn(
                  'p-1.5 rounded text-xs transition-colors cursor-pointer',
                  viewMode === 'grid' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                )}
                aria-label="Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={cn(
                  'p-1.5 rounded text-xs transition-colors cursor-pointer',
                  viewMode === 'table' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                )}
                aria-label="Table View"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* Projects Display: Loading, Empty, Grid, or Table */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center text-center space-y-3 bg-card/40 rounded-xl border border-dashed border-border/80">
          <RefreshCw className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Loading authentic project archives from backend...</p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-center space-y-3 bg-card/40 rounded-xl border border-dashed border-border/80 p-8">
          <Inbox className="w-10 h-10 text-muted-foreground opacity-40 mb-1" />
          <h3 className="font-semibold text-base text-foreground">
            {searchQuery ? 'No matching projects found' : 'No Project Archives Yet'}
          </h3>
          <p className="text-xs text-muted-foreground max-w-md">
            {searchQuery
              ? 'Try adjusting your search terms or status filters.'
              : 'Ingest a YouTube URL in Discovery to run highlight detection, render vertical shorts, and establish your first project archive.'}
          </p>
          {!searchQuery && (
            <Button
              onClick={() => setActiveTab('discovery')}
              className="mt-2 text-xs font-semibold gap-2"
            >
              <Plus className="w-3.5 h-3.5" />
              Ingest YouTube Video
            </Button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProjects.map((proj) => {
            const displayTitle = proj.title || proj.source_metadata?.title || `Project ${proj.video_id}`;
            const displayChannel = proj.source_metadata?.channel_title || 'YouTube Source';
            const durationFormatted = formatDuration(proj.source_metadata?.duration);
            const dateFormatted = formatDate(proj.created_at);
            const clipsCount = proj.clips_count || proj.clips?.length || 0;
            const topScore = proj.clips && proj.clips.length > 0
              ? Math.max(...proj.clips.map((c) => c.score || 0))
              : null;

            return (
              <Card
                key={proj.project_id}
                className="group bg-card/70 backdrop-blur-xs border-border/80 hover:border-primary/50 transition-all overflow-hidden flex flex-col justify-between tactile-panel"
              >
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={proj.status === 'COMPLETED' ? 'success' : 'outline'}
                          className="text-[10px] px-2 py-0.5"
                        >
                          {proj.status === 'COMPLETED' ? (
                            <CheckCircle2 className="w-3 h-3 mr-1 inline" />
                          ) : (
                            <Clock className="w-3 h-3 mr-1 inline" />
                          )}
                          {(proj.status || 'ACTIVE').toUpperCase()}
                        </Badge>
                        {dateFormatted && (
                          <span className="text-[11px] text-muted-foreground font-mono">{dateFormatted}</span>
                        )}
                      </div>
                      <h3 className="font-bold text-sm text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                        {displayTitle}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{displayChannel}</p>
                    </div>

                    {topScore ? (
                      <Badge variant="outline" className="font-mono text-xs font-semibold tnum text-primary shrink-0">
                        {Math.round(topScore)}% Peak Score
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/50 font-mono tnum">
                    <span>Duration: {durationFormatted}</span>
                    <span>{clipsCount} {clipsCount === 1 ? 'Cut' : 'Cuts'} Generated</span>
                  </div>
                </div>

                <div className="px-4 py-2.5 bg-muted/30 border-t border-border/50 flex items-center justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenStudio(proj)}
                    className="h-7 text-xs gap-1.5 px-2 text-primary hover:text-primary/80 cursor-pointer"
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Open in Studio</span>
                    <ArrowRight className="w-3 h-3" />
                  </Button>

                  {proj.clips && proj.clips[0]?.download_url && (
                    <a
                      href={proj.clips[0].download_url}
                      download
                      className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                      title="Download first clip MP4"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        /* Professional Dense Table View */
        <Card className="bg-card/70 backdrop-blur-xs border-border/80 overflow-hidden tactile-panel">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 border-b border-border/60 text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Project Title</th>
                  <th className="py-3 px-4">Channel</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Cuts</th>
                  <th className="py-3 px-4">Top Score</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono tnum">
                {filteredProjects.map((proj) => {
                  const displayTitle = proj.title || proj.source_metadata?.title || `Project ${proj.video_id}`;
                  const displayChannel = proj.source_metadata?.channel_title || 'YouTube Source';
                  const durationFormatted = formatDuration(proj.source_metadata?.duration);
                  const clipsCount = proj.clips_count || proj.clips?.length || 0;
                  const topScore = proj.clips && proj.clips.length > 0
                    ? Math.max(...proj.clips.map((c) => c.score || 0))
                    : null;

                  return (
                    <tr key={proj.project_id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-4 font-sans font-semibold text-foreground max-w-xs truncate">
                        {displayTitle}
                      </td>
                      <td className="py-3 px-4 font-sans text-muted-foreground">{displayChannel}</td>
                      <td className="py-3 px-4 text-muted-foreground">{durationFormatted}</td>
                      <td className="py-3 px-4 font-bold">{clipsCount}</td>
                      <td className="py-3 px-4 font-semibold text-primary">
                        {topScore ? `${Math.round(topScore)}%` : '--'}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={proj.status === 'COMPLETED' ? 'success' : 'outline'}
                          className="text-[10px] px-1.5 py-0 font-sans"
                        >
                          {(proj.status || 'ACTIVE').toLowerCase()}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenStudio(proj)}
                          className="h-6 px-2 text-xs font-sans text-primary cursor-pointer"
                        >
                          Open Studio →
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
