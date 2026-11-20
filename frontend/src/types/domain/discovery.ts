import type {
  RightsStatus,
  LayoutMode,
  SubtitlePreset,
} from './common';

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

