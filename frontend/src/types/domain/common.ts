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

