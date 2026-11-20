import type {
  PublishTarget,
  PublishPlatform,
  OmniPostRole,
} from './common';

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

