import type {
  JobStatus,
  JobStage,
  LayoutMode,
  SubtitlePreset,
  RightsStatus,
  PublishTarget,
  BatchStatus,
  BatchItemStatus,
} from './common';
import type {
  CandidateHighlight,
  HighlightCandidate,
  ScoreBreakdown,
} from './discovery';
import type {
  PublishReceipt,
} from './publishing';

// ==============================================================================
// 5. Render, Job Queue & Pipeline Contracts
// ==============================================================================

export interface RenderRequest {
  video_id_or_url: string;
  max_clips?: number;
  selected_candidate_ids?: string[] | null;
  fill_to_target?: boolean;
  layout?: LayoutMode | string;
  subtitle_preset?: SubtitlePreset | string;
  enable_polish?: boolean;
  enable_outro?: boolean;
  outro_channel_name?: string | null;
  gpu?: boolean;
}

export interface RenderTaskResponse {
  task_id: string;
  job_id: string;
  status: JobStatus | string;
  created_at?: string;
  check_status_url?: string;
}

export interface JobEvent {
  job_id: string;
  stage: JobStage;
  status: JobStatus;
  progress_pct: number;
  message: string;
  timestamp: string;
  error?: string;
}

export interface StageProgress {
  progress: number;
  current_stage: string;
  message: string;
  status: string;
  error?: string | null;
  clips?: unknown[];
}

export interface RenderProfile {
  name: string;
  width: number;
  height: number;
  aspect_ratio: string;
  fps: number;
  vcodec: string;
  acodec: string;
  crf: number;
  burn_subtitles: boolean;
  layout_mode: LayoutMode | string;
  subtitle_preset: SubtitlePreset | string;
  enable_cta: boolean;
  cta_text: string;
  cta_timing: string;
  cta_style: string;
  cta_duration: number;
  cta_margin_bottom: number;
  enable_outro_card: boolean;
  outro_duration: number;
  outro_channel_name?: string | null;
  outro_sub_heading: string;
  outro_prompt: string;
  enable_outro_chime: boolean;
  outro_chime_style: string;
  enable_pacing_polish: boolean;
  enable_flux: boolean;
  audio_fade_in_seconds: number;
  audio_fade_out_seconds: number;
  video_fade_in_seconds: number;
  video_fade_out_seconds: number;
}

export interface QAReport {
  qa_id: string;
  clip_id: string;
  status: 'PASSED' | 'FAILED' | 'WARNING';
  video_stream_ok: boolean;
  audio_stream_ok: boolean;
  duration_ok: boolean;
  actual_duration: number;
  expected_duration: number;
  aspect_ratio_ok: boolean;
  actual_aspect_ratio: string;
  file_size_bytes: number;
  errors: string[];
  warnings: string[];
  checksum_sha256: string;
  timestamp: string;
}

export interface RenderedClip {
  clip_id: string;
  job_id: string;
  candidate_id: string;
  file_path: string;
  file_hash: string;
  duration_seconds: number;
  width: number;
  height: number;
  manifest_path: string;
  rendered_at: string;
}

export interface RenderedClipSummary {
  clip_id: string;
  filename: string;
  url: string;
  playback_url: string;
  poster_url: string;
  download_url: string;
  duration_seconds: number;
  layout: string;
  aspect_ratio: string;
  hook_title?: string;
  caption?: string;
  hashtags?: string[];
}

export interface JobRecord {
  job_id: string;
  project_id?: string;
  video_id: string;
  status: JobStatus;
  stage?: JobStage;
  current_stage?: string;
  progress: number;
  message?: string;
  created_at: string;
  updated_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  clips?: RenderedClipSummary[] | RenderedClip[] | ClipSidecarRecord[] | Record<string, unknown>[];
  error?: string | null;
  retry_count?: number;
  max_retries?: number;
  request_params?: Record<string, unknown>;
}

export interface StreamToClipperRequest {
  video_id_or_url: string;
  max_clips?: number;
  layout?: LayoutMode | string;
  subtitle_preset?: SubtitlePreset | string;
  enable_polish?: boolean;
  enable_outro?: boolean;
  gpu?: boolean;
  auto_publish?: boolean;
  platforms?: string[];
  target?: PublishTarget | string;
  approved_by_user?: boolean;
  enable_flux?: boolean;
}

export interface StreamToClipperResponse {
  success: boolean;
  task_id: string;
  job_id: string;
  video_id: string;
  status: 'QUEUED' | string;
  message?: string;
  receipts?: PublishReceipt[];
}

export interface BatchStartRequest {
  video_ids?: string[] | null;
  name?: string | null;
  max_clips?: number | null;
  layout?: string | null;
  subtitle_preset?: string | null;
  enable_polish?: boolean | null;
  enable_outro?: boolean | null;
  gpu?: boolean | null;
}

export interface BatchVideoItem {
  video_id: string;
  url: string;
  title: string;
  channel_name: string;
  channel_subs: string;
  thumbnail_url: string;
  duration_seconds: number;
  status: BatchItemStatus | string;
  job_id?: string | null;
  clips_count: number;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface BatchSession {
  batch_id: string;
  name: string;
  status: BatchStatus | string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  total_videos: number;
  completed_videos: number;
  failed_videos: number;
  total_clips_generated: number;
  current_index: number;
  current_video_id?: string | null;
  current_stage: string;
  current_progress: number;
  render_config: Record<string, unknown>;
  items: BatchVideoItem[];
}


// ==============================================================================
// 7. Projects & Persistent Clip Store Contracts
// ==============================================================================

export interface ClipSidecarRecord {
  clip_id: string;
  project_id: string;
  video_id: string;
  file_path: string;
  relative_url: string;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  score: number;
  candidate_data: Record<string, unknown>;
  source_metadata: Record<string, unknown>;
  intelligence: Record<string, unknown>;
  caption_package: Record<string, unknown>;
  render_settings: Record<string, unknown>;
  file_size_bytes: number;
  file_hash: string;
  render_timestamp: string;
  qa_report?: QAReport | Record<string, unknown> | null;
  status: string;
  error_details?: string | null;
  thumbnail_path?: string | null;
}

export interface ProjectRecord {
  project_id: string;
  video_id: string;
  title: string;
  canonical_url: string;
  source_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  clips_count: number;
  status: string;
  clips?: Array<{
    clip_id: string;
    filename: string;
    duration: number;
    score: number;
    playback_url: string;
    poster_url: string;
    download_url: string;
    hook_title?: string;
    status: string;
  }>;
}

export interface ProjectDetailResponse extends Omit<ProjectRecord, 'clips'> {
  clips: ClipSidecarRecord[];
}

export interface ClipListItem {
  clip_id: string;
  project_id: string;
  video_id: string;
  filename: string;
  file_path: string;
  url: string;
  playback_url: string;
  poster_url: string;
  download_url: string;
  size_mb: number;
  duration: number;
  score: number;
  status: string;
  validation_status: string;
  modified_at: string;
  intelligence: Record<string, unknown>;
  caption_package: Record<string, unknown>;
  source_metadata: Record<string, unknown>;
  qa_report?: QAReport | null;
}

