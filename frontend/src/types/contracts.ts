/**
 * ==============================================================================
 * YouTube Clipping Intelligence Engine & OmniPost Ecosystem
 * Strict TypeScript API Contracts & Data Models
 * Generated from Authoritative FastAPI & OmniPost Specifications (Milestone 1)
 * ==============================================================================
 */

// ==============================================================================
// 1. Core Enumerations & String Unions
// ==============================================================================

export type RightsBasis =
  | 'OWNED'
  | 'EXPLICIT_PERMISSION'
  | 'CREATIVE_COMMONS'
  | 'VERIFIED_LICENSE'
  | 'COMMENTARY_TRANSFORM'
  | 'OPERATOR_ASSET'
  | 'AI_GENERATED_ORIGINAL';

export type RightsStatus =
  | 'UNKNOWN'
  | 'VERIFIED'
  | 'PENDING_REVIEW'
  | 'REJECTED'
  | 'REVOKED'
  | 'EXPIRED';

export type ComplianceProfile =
  | 'STRICT_LICENSED'
  | 'REVIEW_REQUIRED'
  | 'COMMENTARY_REVIEW';

export type PipelineState =
  | 'DISCOVERED'
  | 'VALIDATING'
  | 'BLOCKED'
  | 'READY_FOR_PROCESSING'
  | 'PROCESSING'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'READY_TO_PUBLISH'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'REVOKED'
  | 'OUTCOME_UNKNOWN';

export type JobStage =
  | 'DISCOVERED'
  | 'RIGHTS_CHECKED'
  | 'ASSET_INGESTED'
  | 'TRANSCRIBED'
  | 'SEGMENTED'
  | 'SCORED'
  | 'REVIEWED'
  | 'COMMENTARY_GENERATED'
  | 'RENDERED'
  | 'QA_VERIFIED'
  | 'HANDED_OFF'
  | 'BLOCKED'
  | 'REVOKED'
  | 'FAILED';

export type JobStatus =
  // Lowercase variants (JobManager)
  | 'queued'
  | 'discovering'
  | 'analyzing'
  | 'generating_caption'
  | 'rendering'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled'
  // Uppercase variants (contracts/models.py & legacy state)
  | 'QUEUED'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'REVIEW_REQUIRED'
  | 'SUCCEEDED'
  | 'BLOCKED'
  | 'REVOKED'
  | 'OUTCOME_UNKNOWN'
  | 'FAILED'
  | 'RETRY_PENDING'
  | 'COMPLETED'
  | 'CANCELLED';

export type UserRole = 'admin' | 'editor' | 'publisher' | 'viewer';
export type OmniPostRole = 'chambers' | 'automation';

export type SubtitlePreset =
  | 'hormozi'
  | 'beast_bounce'
  | 'neon_cyber'
  | 'clean_editorial'
  | 'bold_social'
  | 'karaoke_gold';

export type LayoutMode =
  | 'active_speaker'
  | 'blur_background'
  | 'split_screen'
  | 'crop_center'
  | 'crop'
  | 'auto';

export type PublishTarget =
  | 'youtube_dedicated'
  | 'omnipost'
  | 'watched_folder';

export type PublishPlatform =
  | 'youtube'
  | 'youtube_shorts'
  | 'instagram_reels'
  | 'tiktok'
  | 'facebook'
  | 'x'
  | 'linkedin'
  | 'threads'
  | 'pinterest';

export type BatchStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type BatchItemStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'skipped';

// ==============================================================================
// 2. Multi-Tenant Workspace & Identity Context
// ==============================================================================

export interface WorkspaceUser {
  id: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
}

export interface Workspace {
  id: string;
  name: string;
  role: UserRole;
  apiKey?: string;
}

export interface TenantWorkspaceContext {
  workspace_id: string;
  user_id: string;
  user_role: UserRole;
  tenant_id?: string;
  api_key?: string;
}

export interface WorkspaceHeaders {
  'X-Workspace-Id': string;
  'X-User-Id': string;
  'X-User-Role': UserRole;
  'Authorization'?: string;
  'X-API-Key'?: string;
}

export interface TenantRecord {
  tenant_id: string;
  name: string;
  api_key?: string;
  api_key_masked?: string;
  webhook_url?: string;
  webhook_secret?: string;
  status: string;
  daily_render_limit?: number;
  current_daily_renders?: number;
  max_concurrent_jobs?: number;
  storage_quota_bytes?: number;
  created_at?: string;
  updated_at?: string;
}

export interface TenantQuotaRecord {
  tenant_id: string;
  daily_render_limit: number;
  current_daily_renders: number;
  max_concurrent_jobs: number;
  storage_quota_bytes: number;
  used_storage_bytes: number;
  reset_date?: string;
}

// ==============================================================================
// 3. Discovery & Video Metadata Contracts
// ==============================================================================

export interface MetadataRequest {
  video_id_or_url: string;
}

export interface MetadataResponse {
  video_id: string;
  title: string;
  channel: string;
  channel_id: string;
  duration: number;
  thumbnail: string;
  view_count: number;
  rights_status?: RightsStatus;
  description?: string;
}

export interface EnrichedVideoInfo {
  video_id: string;
  title: string;
  description: string;
  channel_title: string;
  channel_handle?: string | null;
  channel_id?: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string;
  duration: number;
  category: string;
  tags: string[];
  thumbnail_url: string;
  canonical_url: string;
  metadata_provider: string;
  fetched_at: string;
  extraction_status: string;
  license: string;
  embeddable: boolean;
  privacy_status: string;
  made_for_kids: boolean;
  region_restriction: Record<string, unknown>;
  compliance_bucket: string;
  risk_flags: string[];
}

export interface TrendingVideoDescriptor {
  video_id: string;
  url: string;
  title: string;
  channel_name: string;
  channel_id: string;
  channel_handle: string;
  channel_subscribers: number;
  channel_subscribers_formatted: string;
  published_at: string;
  duration_seconds: number;
  duration_formatted: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  thumbnail_url: string;
  virality_score: number;
  clipping_suitability: string;
  license_status: string;
  embeddable: boolean;
  privacy_status: string;
  made_for_kids: boolean;
  category_id: string;
  region_restricted: boolean;
  compliance_bucket: string;
  risk_flags: string[];
  review_required: boolean;
}

export interface VideoCandidate {
  video_id: string;
  title: string;
  url: string;
  creator_id: string;
  published_at: string;
  retrieved_at: string;
  duration_seconds: number;
  view_count: number;
  like_count?: number;
  comment_count?: number;
  discovery_score?: number;
  rights_status: RightsStatus;
  discovery_rationale?: string;
}

// ==============================================================================
// 4. Preview, Heatmap & AI Scoring Contracts
// ==============================================================================

export interface PreviewRequest {
  video_id_or_url: string;
  min_duration?: number;
  max_duration?: number;
}

export interface RetentionPoint {
  start_time: number;
  end_time: number;
  value: number;
}

export interface HeatmapPeak {
  peak_id: string;
  start_time: number;
  end_time: number;
  center_time: number;
  intensity: number;
  prominence: number;
  width_seconds: number;
  classification: string;
  suggested_clip_start: number;
  suggested_clip_end: number;
}

export interface HeatmapData {
  video_id: string;
  source: string;
  points: RetentionPoint[];
  peaks: HeatmapPeak[];
  global_peak?: HeatmapPeak | null;
}

export interface ScoreBreakdown {
  hook_score: number;
  moment_score: number;
  coherence_score: number;
  pacing_score: number;
  audio_energy_score: number;
  visual_score: number;
  heatmap_score: number;
  confidence: number;
  rationale?: string;
}

export interface ClipIntelligence {
  why_it_works: string;
  hook_strength: number;
  context_completeness: number;
  narrative_quality: number;
  information_density: number;
  ending_quality: number;
  estimated_engagement_potential: number;
  selection_reason: string;
  clarity_score: number;
  replay_potential: number;
  quality_warnings: string[];
}

export interface ShortCaptionPackage {
  hook_title: string;
  hook_opening: string;
  core_summary: string;
  creator_credit: string;
  thank_you_note: string;
  legal_disclaimer: string;
  targeted_hashtags: string[];
  platform_variants: {
    youtube_shorts?: string;
    instagram_reels?: string;
    tiktok?: string;
    [platform: string]: string | undefined;
  };
  full_copy_caption: string;
  why_it_works: string;
  generation_provider: string;
  generation_status: string;
  copyright_awareness: Record<string, unknown>;
  created_at: string;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  speaker_tag?: string | null;
}

export interface TranscriptSegment {
  segment_id: number;
  start: number;
  end: number;
  text: string;
  words: WordTimestamp[];
  speaker_tag?: string | null;
}

export interface Transcript {
  video_id: string;
  language: string;
  duration_seconds: number;
  text: string;
  segments: TranscriptSegment[];
  provider: string;
  model_version: string;
}

export interface HighlightCandidate {
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  score: number;
  hook_strength?: number;
  retention_score?: number;
  coherence_score?: number;
  title?: string;
  rationale?: string;
  recommended_layout?: LayoutMode;
  candidate_id?: string;
  video_id?: string;
  breakdown?: ScoreBreakdown;
  hook_title?: string;
  suggested_description?: string;
  approval_status?: string;
  transcript_text?: string;
  loop_affinity_score?: number;
}

export interface CandidateHighlight {
  candidate_id: string;
  start_seconds: number;
  end_seconds: number;
  start_time: string;
  end_time: string;
  duration: number;
  duration_seconds: number;
  score: number;
  hook_title: string;
  suggested_description: string;
  rationale: string;
  why_it_works: string;
  intelligence: ClipIntelligence;
  caption_package: ShortCaptionPackage;
}

export interface PreviewResponse {
  video_id: string;
  title?: string;
  channel?: string;
  duration: number;
  candidates: HighlightCandidate[] | CandidateHighlight[];
  metadata?: EnrichedVideoInfo | null;
  source_metadata?: EnrichedVideoInfo | null;
  solid_clips?: CandidateHighlight[];
  total_candidates_found?: number;
  recommended_solid_shorts_count?: number;
  capacity_limit?: number;
  decision_reasons?: string[];
  heatmap?: HeatmapData | null;
}

// ==============================================================================
// 5. Render, Job Queue & Pipeline Contracts
// ==============================================================================

export interface RenderRequest {
  video_id_or_url: string;
  max_clips?: number;
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

// ==============================================================================
// 8. FLUX.1 Creative Engine Contracts
// ==============================================================================

export interface FluxGenerateRequest {
  prompt: string;
  style_preset?: string | null;
  width?: number | null;
  height?: number | null;
  steps?: number | null;
  animate_broll?: boolean | null;
}

export interface FluxGenerateResponse {
  success: boolean;
  prompt: string;
  style_preset: string;
  file_path: string;
  file_url: string;
  width: number;
  height: number;
  steps: number;
  duration_ms: number;
  broll_video_path?: string;
  broll_video_url?: string;
  concept?: string;
  error?: string;
}

export interface FluxBRollRequest {
  image_path: string;
  duration?: number | null;
  motion?: 'zoom_in' | 'zoom_out' | 'pan' | string | null;
}

export interface FluxBRollResponse {
  success: boolean;
  broll_video_path: string;
  broll_video_url: string;
  duration: number;
  motion: string;
}

export interface FluxAutoBRollRequest {
  transcript_text: string;
  max_concepts?: number | null;
  style_preset?: string | null;
}

export interface FluxAutoBRollResponse {
  success: boolean;
  count: number;
  assets: FluxGenerateResponse[];
}

export interface FluxSettingsRequest {
  account_id: string;
  api_token: string;
}

export interface FluxStatusResponse {
  configured: boolean;
  account_id_masked?: string;
  default_model: string;
  output_dir: string;
}

// ==============================================================================
// 9. Dedicated YouTube & Publishing Contracts
// ==============================================================================

export interface YouTubeAuthStatus {
  connected: boolean;
  channel_id: string;
  channel_title: string;
  channel_handle: string;
  subscriber_count: string;
  thumbnail_url: string;
  env_mode: string;
  has_dedicated_client: boolean;
  authorized_at: string | null;
  scopes: string[];
  isolation_verified: boolean;
}

export interface PlatformChannel {
  channel_id: string;
  channel_title: string;
  channel_handle?: string;
  subscriber_count?: string | number;
  thumbnail_url?: string;
  is_default?: boolean;
  platform?: string;
}

export interface PublishChannel {
  id: string;
  platform: PublishPlatform;
  channel_name: string;
  channel_id: string;
  connected: boolean;
  avatar_url?: string;
}

export interface PublishChannelsResponse {
  dedicated_youtube: YouTubeAuthStatus;
  omnipost_gateway: OmniPostPreflight | Record<string, unknown>;
  channels: PlatformChannel[];
  ready: boolean;
}

export interface PublishSubmitRequest {
  clip_id?: string | null;
  clip_ids?: string[] | null;
  target?: PublishTarget | 'youtube_dedicated' | 'omnipost' | string;
  channel_id?: string | null;
  platforms?: PublishPlatform[] | string[];
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  thumbnail_path?: string | null;
  scheduled_time?: string | null;
  approved_by_user: boolean; // Mandatory human gate
}

export interface PublishReceipt {
  receipt_id: string;
  clip_id: string;
  idempotency_key?: string;
  status:
    | 'QUEUED'
    | 'PUBLISHED'
    | 'DELIVERED'
    | 'SCHEDULED'
    | 'REJECTED'
    | 'DUPLICATE_SKIPPED'
    | 'DRY_RUN_SIMULATED'
    | 'FAILED'
    | 'OUTCOME_UNKNOWN'
    | string;
  target?: string;
  target_mode?: string;
  platforms?: string[];
  created_at?: string;
  published_at?: string;
  external_urls?: Record<string, string>;
  timestamp?: string;
  response?: Record<string, unknown>;
  response_payload?: Record<string, unknown>;
  error?: string;
}

export interface PublishReceiptResponse {
  receipt_id: string;
  clip_id: string;
  status: 'QUEUED' | 'PUBLISHED' | 'FAILED' | 'OUTCOME_UNKNOWN';
  target: string;
  platforms: string[];
  created_at: string;
  published_at?: string;
  external_urls?: Record<string, string>;
  error?: string;
}

export interface PublishBatchReceiptResponse {
  success: boolean;
  total_published?: number;
  target: string;
  receipt_id?: string;
  status?: string;
  timestamp?: string;
  response?: Record<string, unknown>;
  receipts?: Array<{
    receipt_id: string;
    clip_id: string;
    status: string;
    target: string;
    timestamp: string;
    response: Record<string, unknown>;
  }>;
}

export interface PublishHistoryResponse {
  count: number;
  receipts: PublishReceipt[];
}

// ==============================================================================
// 10. OmniPost Universal Publishing Engine Contracts
// ==============================================================================

export interface ChannelProbeResult {
  ready: boolean;
  status: 'READY' | 'DEGRADED' | 'NEEDS_CONFIGURATION' | 'DISABLED' | 'UNREACHABLE' | string;
  detail?: string;
  account?: string;
  accountId?: string;
  backend?: string;
  tables?: string[];
  ms?: number;
}

export interface OmniPostServicesProbe {
  supabase: ChannelProbeResult;
  drive: ChannelProbeResult;
  n8n: {
    ready: boolean;
    status: string;
    reachable: boolean;
    contentBridge: string;
    targets: string[];
    detail: string;
  };
}

export interface OmniPostBlocker {
  dependency: string;
  status?: string;
  detail?: string;
}

export interface OmniPostPreflight {
  success?: boolean;
  signal: 'GREEN_SIGNAL' | 'NOT_GREEN' | string;
  armed: boolean;
  selectiveArmed: boolean;
  readyCount: number;
  totalCount: number;
  checkedAt: string;
  durationMs: number;
  core: string[];
  optional: string[];
  services: OmniPostServicesProbe;
  channels: Record<string, ChannelProbeResult>;
  readyToPublish: string[];
  blockers: OmniPostBlocker[];
  inventory: Record<string, unknown>;
}

export interface OmniPostPreflightResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  channels: Array<{
    platform: string;
    authorized: boolean;
    rate_limit_remaining: number;
    error?: string;
  }>;
  queue_length: number;
  active_workers: number;
}

export interface OmniPostPost {
  id: string;
  title: string;
  description: string;
  media_url: string;
  platforms: string[];
  status: 'PENDING_REVIEW' | 'APPROVED' | 'POSTED' | 'FAILED' | 'RETRY';
  scheduled_at?: string;
  created_at: string;
}

export interface OmniPostIngestRequest {
  file?: File | Blob;
  mediaUrl?: string;
  public_media_url?: string;
  title?: string;
  caption?: string;
  platforms?: string[] | string;
  scheduled_datetime?: string;
  expected_sha256?: string;
  file_hash?: string;
  tenant_id?: string;
  workspace_id?: string;
  asset_manifest?: Record<string, unknown>;
  idempotency_key?: string;
}

export interface OmniPostIngestResponse {
  success: boolean;
  contentId: string;
  videoId?: string;
  assetId?: string;
  status: string;
  rightsStatus?: string;
  legalOfficer: boolean;
  sha256?: string | null;
  idempotencyKey?: string | null;
  mediaUrl?: string | null;
  deduplicated?: boolean;
}

export interface OmniPostUploadResponse {
  success: boolean;
  contentId?: string;
  mediaType: string;
  media_type: string;
  publicMediaUrl?: string;
  offline?: boolean;
  message?: string;
}

export interface OmniPostRevokeRequest {
  video_id?: string;
  asset_id?: string;
  creator_id?: string;
  reason: string;
  actor?: string;
}

export interface OmniPostRevokeResponse {
  success: boolean;
  revokedAt: string;
  reason: string;
  actionTaken: string;
  cancelledContentIds: string[];
}

export interface OmniPostPlatformState {
  status: 'Published' | 'Pending' | 'Queued' | 'Failed' | 'Skipped';
  postId?: string;
  publishedAt?: string;
  error?: string;
  failureKind?: string;
  retryCount?: number;
}

export interface OmniPostCalendarPost {
  'Content ID': string;
  'Title': string;
  'Caption': string;
  'Platforms': string;
  'Scheduled DateTime': string;
  'Status': string;
  'Retry Count': number;
  'Posted At'?: string;
  'Error'?: string;
  'Drive File ID'?: string;
  'Public Media URL'?: string;
  'Media Type'?: string;
  'publish_state'?: string;
  'last_attempt_at'?: string;
  'platform_statuses'?: Record<string, OmniPostPlatformState>;
}

export interface OmniPostWebhookPayload {
  event_type: 'PUBLISH_SUCCESS' | 'PUBLISH_FAILED' | 'REVOCATION' | string;
  event_id: string;
  tenant_id?: string;
  workspace_id?: string;
  project_id?: string;
  job_id?: string;
  content_id: string;
  status: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

// ==============================================================================
// 11. Governance, Rights & Tenancy Contracts
// ==============================================================================

export interface SystemGovernorStatus {
  cpu_percent?: number;
  ram_percent?: number;
  ram_used_gb?: number;
  ram_total_gb?: number;
  gpu_percent?: number;
  vram_used_mb?: number;
  vram_total_mb?: number;
  active_renders?: number;
  max_concurrent_renders?: number;
  monotonic_rss_leak_warning?: boolean;
  uptime_seconds?: number;
  timestamp?: string;
  hardware_concurrency?: number;
  active_render_jobs?: number;
  vram_gb?: number;
  cpu_cores?: number;
  free_disk_gb?: number;
  total_disk_gb?: number;
  rss_memory_mb?: number;
  zero_memory_leak_certified?: boolean;
  rss_growth_pct?: number;
  legal_officer_enabled?: boolean;
}

export interface LegalOfficerConfigResponse {
  enabled: boolean;
  mode: 'STRICT_COMPLIANCE' | 'UNRESTRICTED_BYPASS';
  description?: string;
}

export interface LegalOfficerToggleRequest {
  enabled: boolean;
}

export interface LegalOfficerToggleResponse {
  success: boolean;
  enabled: boolean;
  mode: 'STRICT_COMPLIANCE' | 'UNRESTRICTED_BYPASS';
}

export interface SystemHealthResponse {
  status: 'healthy' | 'degraded' | string;
  timestamp: string;
  gpu_available: boolean;
  gpu_device: string;
  ffmpeg_ready: boolean;
  ffmpeg_path?: string | null;
  ffprobe_ready: boolean;
  models: {
    yunet_onnx: boolean;
    yolov8n_seg: boolean;
    gemini_active: boolean;
    gemini_model: string;
  };
  metadata_provider: string;
  storage: {
    data_dir: string;
    clips_count: number;
    projects_count: number;
  };
}

export interface OpsHealthResponse {
  status: string;
  compliance_profile: string;
  legal_officer: boolean;
  auth_configured: boolean;
  rights_summary: {
    total: number;
    by_status: Record<string, number>;
  };
  recent_revocation_impacts: unknown[];
  active_render_jobs_count: number;
  free_disk_gb: number;
  timestamp: string;
}

export interface StudioSettings {
  gemini_model: string;
  compliance_profile: ComplianceProfile | string;
  layout_mode: LayoutMode | string;
  subtitle_preset: SubtitlePreset | string;
  gpu_acceleration: boolean;
  enable_polish: boolean;
  enable_outro: boolean;
  attribution_template: string;
  fair_use_disclaimer: string;
  contact_email: string;
}

export interface LicenseMetadata {
  license_id: string;
  license_name: string;
  license_url: string;
  license_version: string;
  embeddable: boolean;
  made_for_kids: boolean;
  privacy_status: string;
  category_id: string;
  region_restrictions: Record<string, unknown>;
  source_url: string;
  creator_id: string;
  verified_at?: string | null;
  verification_status: string;
  attribution_required: boolean;
  changes_notice_required: boolean;
}

export interface AttributionRequirements {
  creator_name: string;
  creator_handle?: string;
  creator_id?: string;
  source_title?: string;
  source_url?: string;
  license_id?: string;
  license_url?: string;
  changes_made?: string;
  required_credit_line?: string;
  required_notices?: string[];
  validated?: boolean;
}

export interface AudioRiskAssessment {
  assessment_id: string;
  video_id: string;
  clip_id?: string;
  match_status: 'DETECTED_MATCH' | 'POSSIBLE_MATCH' | 'NO_MATCH_DETECTED' | 'UNABLE_TO_ANALYZE' | string;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'REVIEW_REQUIRED' | string;
  flagged_segments: unknown[];
  detected_tracks: unknown[];
  review_required: boolean;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  replacement_audio_path?: string | null;
  disclaimer: string;
  created_at: string;
}

export interface RightsManifest {
  rights_id: string;
  video_id: string;
  basis: RightsBasis;
  status: RightsStatus;
  owner_name: string;
  creator_id?: string;
  license_id?: string;
  license_url?: string;
  proof_reference?: string;
  evidence_type?: string;
  permitted_platforms: string[];
  valid_until?: string | null;
  verified_at?: string | null;
  verified_by?: string;
  revoked_at?: string | null;
  revoked_by?: string;
  revocation_reason?: string;
  compliance_profile: string;
  attribution_requirements: Record<string, unknown>;
  audit_notes?: string;
}

export interface RightsRegisterRequest {
  video_id: string;
  basis: RightsBasis | string;
  owner: string;
  status?: RightsStatus | string;
  proof_reference?: string;
  license_url?: string;
  license_id?: string;
  creator_id?: string;
  evidence_type?: string;
  verified_by?: string;
  valid_until?: string | null;
  audit_notes?: string;
  allow_regrant_revoked?: boolean;
}

export interface RightsRegisterResponse {
  success: boolean;
  rights_id: string;
  video_id: string;
  basis: string;
  status: string;
}

export interface RightsRevokeRequest {
  video_id?: string | null;
  creator_id?: string | null;
  reason: string;
  actor?: string;
}

export interface RightsRevokeResponse {
  success: boolean;
  revocation_id?: string;
  revoked_video_ids?: string[];
  cancelled_jobs?: string[];
  held_receipts?: string[];
  [key: string]: unknown;
}

export interface RightsAuditEntry {
  audit_id: string;
  rights_id: string;
  video_id: string;
  previous_status?: string | null;
  new_status: string;
  transition_reason: string;
  actor: string;
  timestamp: string;
}

export interface RightsAuditResponse {
  count: number;
  entries: RightsAuditEntry[];
}

export interface CreatorApproveRequest {
  channel_id: string;
  channel_name: string;
  policy: string;
  approval_evidence: string;
  creator_handle?: string | null;
  approved_by?: string;
  expires_at?: string | null;
  notes?: string;
}

export interface CreatorRevokeRequest {
  channel_id: string;
  reason: string;
  revoked_by?: string;
}

export interface CreatorRecord {
  creator_key: string;
  channel_id: string;
  channel_name: string;
  handle?: string;
  policy: string;
  approval_status: string;
  approval_evidence: string;
  approved_by: string;
  permission_scope: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  revocation_reason?: string | null;
}

export interface ExternalAIVideoIngestRequest {
  project_id: string;
  video_url: string;
  source_engine?: string;
  prompt_metadata?: Record<string, unknown> | null;
  transcript?: Array<Record<string, unknown>> | null;
  target_aspect_ratio?: string;
  audio_treatment?: Record<string, unknown> | null;
  omnipost_routing?: Record<string, unknown> | null;
}

export interface ExternalAIVideoJobResponse {
  job_id: string;
  project_id: string;
  tenant_id: string;
  status: string;
  source_engine: string;
  file_hash?: string;
  rights_id?: string;
  omnipost_receipt_id?: string;
  output_clip_path?: string;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

// ==============================================================================
// 12. Server-Sent Events (SSE) Contracts
// ==============================================================================

export type SSEEventName = 'message' | 'error' | 'end';

export interface SSEJobStreamEvent {
  event?: SSEEventName;
  data: JobRecord | SSEErrorPayload;
}

export interface SSEErrorPayload {
  error: string;
}
