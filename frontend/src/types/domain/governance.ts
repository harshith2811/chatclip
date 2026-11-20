import type {
  RightsBasis,
  RightsStatus,
  ComplianceProfile,
  LayoutMode,
  SubtitlePreset,
} from './common';

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

