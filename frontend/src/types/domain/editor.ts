import type {
  LayoutMode,
  SubtitlePreset,
} from './common';
import type {
  ClipSidecarRecord,
} from './pipeline';

// ==============================================================================
// 6. Manual Video Editor Contracts
// ==============================================================================

export interface EditorFrameRequest {
  file_path: string;
  timestamp?: number;
}

export interface EditorFrameResponse {
  status: string;
  frame_url?: string;
  timestamp: number;
}

export interface EditorClipSpec {
  title?: string;
  start_seconds: number;
  end_seconds: number;
  aspect_ratio?: string;
  center_x?: number;
  center_y?: number;
  text_overlay?: string | null;
  text_position?: 'top' | 'middle' | 'bottom' | string;
  description?: string | null;
}

export interface EditorExportClipSpec {
  title?: string;
  start_seconds: number;
  end_seconds: number;
  aspect_ratio?: string;
  center_x?: number;
  center_y?: number;
  text_overlay?: string;
  text_position?: 'top' | 'middle' | 'bottom';
  description?: string;
}

export interface EditorExportRequest {
  source_path: string;
  project_id: string;
  clips: EditorClipSpec[] | EditorExportClipSpec[];
}

export interface EditorExportResponse {
  status?: string;
  success?: boolean;
  project_id: string;
  exported_count?: number;
  exported_clips?: Array<{
    clip_id: string;
    output_path: string;
    url: string;
  }>;
  clips?: ClipSidecarRecord[] | Record<string, unknown>[];
}

export interface EditorWaveformRequest {
  file_path: string;
  points?: number;
}

export interface EditorWaveformResponse {
  peaks: number[];
  duration: number;
  points?: number[];
}

export interface WaveformData {
  points: number[];
  duration: number;
}

export interface SavePosterRequest {
  video_path: string;
  timestamp: number;
  clip_id?: string | null;
}

export interface SavePosterResponse {
  status: string;
  poster_path: string;
  poster_url: string;
  timestamp: number;
}

