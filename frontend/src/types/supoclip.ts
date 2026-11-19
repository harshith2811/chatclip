/**
 * TypeScript contract interfaces for SupoClip Ecosystem integration.
 */

export interface SupoClipStatus {
  status: string;
  engine: string;
  version: string;
  yunet_detector_ready: boolean;
  fonts_available: number;
  fonts: string[];
  templates_count: number;
  templates: string[];
  workflows: string[];
  editor_presets: string[];
}

export interface SupoClipWorkflow {
  id: 'highlights' | 'series' | 'topic' | 'recap' | 'trailer';
  name: string;
  description: string;
  supports_topic: boolean;
  supports_series: boolean;
}

export interface SupoClipTemplate {
  id: string;
  name: string;
  description: string;
  animation: string;
  font_family: string;
  font_size: number;
  font_color: string;
  highlight_color: string;
  word_box?: boolean;
  uppercase?: boolean;
  glow?: boolean;
  emoji?: boolean;
}

export interface SupoClipViralityScore {
  hook_score: number;
  engagement_score: number;
  value_score: number;
  shareability_score: number;
  virality_score: number;
  hook_title: string;
  explanation: string;
}

export interface SupoClipScoreRequest {
  text: string;
  duration?: number;
  pacing_wpm?: number;
  audio_energy?: number;
}

export interface SupoClipScoreResponse {
  success: boolean;
  score: SupoClipViralityScore;
}

export interface SupoClipSegmentPlan {
  part_number: number;
  title: string;
  hook_title: string;
  start_time: number;
  end_time: number;
  duration: number;
  workflow_role: string;
  reasoning: string;
}

export interface SupoClipPlan {
  workflow: string;
  total_parts: number;
  overview: string;
  options: {
    topic?: string;
    part_count?: number;
    instructions?: string;
    target_duration_seconds?: number;
  };
  segments: SupoClipSegmentPlan[];
}

export interface SupoClipPlanRequest {
  workflow: string;
  duration: number;
  transcript_segments?: Array<{ text: string; start: number; end: number }>;
  options?: {
    topic?: string;
    part_count?: number;
    instructions?: string;
  };
}

export interface SupoClipPlanResponse {
  success: boolean;
  plan: SupoClipPlan;
}

export interface SupoClipRenderRequest {
  source_path?: string;
  clip_id?: string;
  output_filename?: string;
  start_time: number;
  end_time: number;
  template_name?: string;
  words?: Array<{ word: string; start: number; end: number }>;
  hook_title?: string;
  layout?: 'talking_head' | 'split_screen' | 'interview';
  ken_burns_zoom?: boolean;
}

export interface SupoClipRenderResponse {
  success: boolean;
  rendered_file: string;
  file_path: string;
  start_time: number;
  end_time: number;
  template: string;
  layout: string;
  hook_title?: string;
}

export interface SupoClipPlatformPreset {
  platform: string;
  aspect_ratio: string;
  width: number;
  height: number;
  fps: number;
  video_bitrate: string;
  audio_bitrate: string;
  max_duration_seconds: number;
}

export interface SupoClipPresetsResponse {
  success: boolean;
  presets: Record<string, SupoClipPlatformPreset>;
}
