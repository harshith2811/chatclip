'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/lib/api/client';
import type {
  SupoClipWorkflow,
  SupoClipTemplate,
  SupoClipPlan,
  SupoClipStatus,
} from '@/types';
import {
  Sparkles,
  Layers,
  Film,
  Download,
  Scissors,
  CheckCircle2,
  Clock,
  Tv,
  Type,
  FileArchive,
  RefreshCw,
  Flame,
} from 'lucide-react';

interface SupoClipControlsProps {
  videoId?: string | null;
  activeClipId?: string | null;
  onPlanGenerated?: (plan: SupoClipPlan) => void;
  selectedLayout?: string;
  onLayoutChange?: (layout: string) => void;
  selectedTemplate?: string;
  onTemplateChange?: (template: string) => void;
  className?: string;
}

export function SupoClipControls({
  videoId,
  activeClipId,
  onPlanGenerated,
  selectedLayout: controlledLayout,
  onLayoutChange,
  selectedTemplate: controlledTemplate,
  onTemplateChange,
  className = '',
}: SupoClipControlsProps) {
  const [status, setStatus] = React.useState<SupoClipStatus | null>(null);
  const [workflows, setWorkflows] = React.useState<SupoClipWorkflow[]>([]);
  const [templates, setTemplates] = React.useState<SupoClipTemplate[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = React.useState<string>('highlights');
  const [internalTemplate, setInternalTemplate] = React.useState<string>('hormozi');
  const [internalLayout, setInternalLayout] = React.useState<string>('active_speaker');
  const [topicInput, setTopicInput] = React.useState<string>('');
  const [seriesParts, setSeriesParts] = React.useState<number>(3);
  const [instructions, setInstructions] = React.useState<string>('');
  const [activePlan, setActivePlan] = React.useState<SupoClipPlan | null>(null);
  const [isPlanning, setIsPlanning] = React.useState<boolean>(false);
  const [isRendering, setIsRendering] = React.useState<boolean>(false);
  const [lastRenderedFile, setLastRenderedFile] = React.useState<string | null>(null);

  const selectedTemplate = controlledTemplate !== undefined ? controlledTemplate : internalTemplate;
  const selectedLayout = controlledLayout !== undefined ? controlledLayout : internalLayout;

  const handleLayoutSelect = (layoutId: string) => {
    setInternalLayout(layoutId);
    if (onLayoutChange) onLayoutChange(layoutId);
  };

  const handleTemplateSelect = (templateId: string) => {
    setInternalTemplate(templateId);
    if (onTemplateChange) onTemplateChange(templateId);
  };

  React.useEffect(() => {
    let mounted = true;
    Promise.all([
      apiClient.supoclip.getStatus().catch(() => null),
      apiClient.supoclip.getWorkflows().catch(() => null),
      apiClient.supoclip.getTemplates().catch(() => null),
    ]).then(([statusData, wfData, tmplData]) => {
      if (!mounted) return;
      if (statusData) setStatus(statusData);
      if (wfData?.workflows) setWorkflows(wfData.workflows);
      if (tmplData?.templates) setTemplates(tmplData.templates);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleGeneratePlan = async () => {
    setIsPlanning(true);
    try {
      const res = await apiClient.supoclip.plan({
        workflow: selectedWorkflow,
        duration: 180,
        options: {
          topic: topicInput,
          part_count: seriesParts,
          instructions: instructions,
        },
      });
      if (res.success && res.plan) {
        setActivePlan(res.plan);
        if (onPlanGenerated) onPlanGenerated(res.plan);
      }
    } catch (e) {
      console.error('Plan generation failed:', e);
    } finally {
      setIsPlanning(false);
    }
  };

  const handleExportZip = () => {
    const url = apiClient.supoclip.getExportZipUrl(
      videoId ? `proj_${videoId}` : undefined,
      activeClipId ? [activeClipId] : undefined
    );
    window.open(url, '_blank');
  };

  return (
    <Card className={`border-border/60 bg-card/60 backdrop-blur-md ${className}`}>
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                SupoClip AI Engine
                {status?.status === 'ready' && (
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 text-[10px] px-1.5 py-0 font-mono">
                    ONLINE
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                OpusClip alternative: 4-metric virality, animated ASS templates, and workflow planning
              </CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportZip}
            className="h-8 text-xs gap-1.5 border-border/60 hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <FileArchive className="w-3.5 h-3.5" />
            Download ZIP
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-4">
        {/* 1. Workflow Selection */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Tv className="w-3.5 h-3.5" />
            Workflow Objective
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(workflows.length > 0 ? workflows : [
              { id: 'highlights', name: 'Highlights', description: 'Viral standalone clips' },
              { id: 'series', name: 'Series', description: 'Part 1, 2, ... N sequence' },
              { id: 'topic', name: 'Topic', description: 'Deep-dive on topic' },
              { id: 'recap', name: 'Recap', description: 'Full executive breakdown' },
              { id: 'trailer', name: 'Trailer', description: 'Suspense teaser cut' },
            ]).map((wf) => {
              const isSelected = selectedWorkflow === wf.id;
              return (
                <button
                  key={wf.id}
                  type="button"
                  onClick={() => setSelectedWorkflow(wf.id)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                      : 'border-border/50 bg-background/50 hover:bg-accent/40'
                  }`}
                >
                  <p className="text-xs font-medium text-foreground">{wf.name}</p>
                  <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                    {wf.description}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Conditional Workflow Inputs */}
          {selectedWorkflow === 'topic' && (
            <div className="pt-2">
              <Input
                placeholder="Enter specific topic (e.g. Artificial Intelligence, Real Estate, Monetization)..."
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                className="h-8 text-xs bg-background/60"
              />
            </div>
          )}

          {selectedWorkflow === 'series' && (
            <div className="flex items-center gap-3 pt-2 text-xs">
              <span className="text-muted-foreground">Target Episodes:</span>
              {[2, 3, 4, 5].map((num) => (
                <Button
                  key={num}
                  type="button"
                  variant={seriesParts === num ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSeriesParts(num)}
                  className="h-7 w-7 p-0 text-xs"
                >
                  {num}
                </Button>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Input
              placeholder="Custom AI instructions (e.g. Focus on high-energy questions, keep cliffhangers)..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="h-8 text-xs bg-background/60 flex-1"
            />
            <Button
              size="sm"
              onClick={handleGeneratePlan}
              disabled={isPlanning}
              className="h-8 text-xs gap-1.5 shrink-0"
            >
              {isPlanning ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Planning...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Plan Workflow
                </>
              )}
            </Button>
          </div>
        </div>

        {/* 2. Visual Framing Layout */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5" />
            9:16 Video Composition Layout
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              {
                id: 'active_speaker',
                name: 'Active Speaker',
                tag: 'AI Smart Crop',
                description: 'Face-tracking 9:16 crop box dynamically centered on speaker',
              },
              {
                id: 'blur_background',
                name: 'Ambient Flowing Blur',
                tag: 'Full 16:9 Canvas',
                description: 'Original video sharp in center with synchronous 9:16 blurred background',
              },
              {
                id: 'split_screen',
                name: 'Split Screen Stack',
                tag: 'Dual Presenter',
                description: 'Top & bottom stacked vertical halves for podcast interviews',
              },
            ].map((l) => {
              const isSelected = selectedLayout === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => handleLayoutSelect(l.id)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                      : 'border-border/50 bg-background/50 hover:bg-accent/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-foreground">{l.name}</p>
                    <Badge variant={isSelected ? 'default' : 'outline'} className="text-[9px] px-1.5 py-0 font-mono">
                      {l.tag}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">
                    {l.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Caption Templates */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5" />
            Animated Caption Style
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(templates.length > 0 ? templates : [
              { id: 'hormozi', name: 'Hormozi', font_family: 'THEBOLD', highlight_color: '#00FF66' },
              { id: 'mrbeast', name: 'MrBeast', font_family: 'THEBOLD', highlight_color: '#FF2D2D' },
              { id: 'tiktok', name: 'TikTok', font_family: 'TikTokSans', highlight_color: '#FE2C55' },
              { id: 'neon', name: 'Neon Glow', font_family: 'THEBOLD', highlight_color: '#FF00FF' },
              { id: 'default', name: 'Default Pop', font_family: 'THEBOLD', highlight_color: '#FFE000' },
              { id: 'podcast', name: 'Podcast', font_family: 'TikTokSans', highlight_color: '#FFB800' },
              { id: 'minimal', name: 'Minimal', font_family: 'TikTokSans', highlight_color: '#FFFFFF' },
            ]).map((t: any) => {
              const isSelected = selectedTemplate === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleTemplateSelect(t.id)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                      : 'border-border/50 bg-background/50 hover:bg-accent/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-foreground">{t.name}</p>
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: t.highlight_color }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Font: {t.font_family}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Generated Plan Display */}
        {activePlan && (
          <div className="p-3 rounded-xl bg-accent/30 border border-border/50 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold flex items-center gap-1.5 text-primary">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                Workflow Plan Ready ({activePlan.total_parts} segments)
              </span>
              <span className="text-[11px] text-muted-foreground uppercase">
                {activePlan.workflow}
              </span>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {activePlan.segments.map((seg, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between text-xs p-2 rounded-lg bg-background/60 border border-border/40"
                >
                  <div className="space-y-0.5">
                    <p className="font-medium text-foreground">{seg.title}</p>
                    <p className="text-[10px] font-mono text-primary flex items-center gap-1">
                      <Flame className="w-3 h-3 text-amber-500" />
                      HOOK: {seg.hook_title}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                    {seg.start_time}s - {seg.end_time}s ({seg.duration}s)
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
