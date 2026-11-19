/**
 * e2e/harness/fixtures.js
 * Calibrated synthetic datasets, boundary fixtures, and identity accounts
 * adhering strictly to contracts in PROJECT.md and src/yt_clipping/contracts/models.py.
 */

import crypto from 'node:crypto';

// --- Shared Constants ---
export const DEFAULT_WEBHOOK_SECRET = 'omnipost_webhook_shared_secret_2026';
export const DEFAULT_ADMIN_KEY = 'test_admin_key_2026';

// Canonical YouTube Video IDs & URLs
export const CANONICAL_VIDEOS = {
  SAMPLE_1: {
    id: '0e3GPea1Tyg',
    url: 'https://www.youtube.com/watch?v=0e3GPea1Tyg',
    title: 'Autonomous AI Newsroom & Video Generation Pipeline',
    channel: 'Intelligence Dynamics',
    duration: 184.0
  },
  SAMPLE_2: {
    id: 'dQw4w9WgXcQ',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Breakthrough Neural Architecture in Production',
    channel: 'Deep Video Tech',
    duration: 212.0
  },
  INVALID_IDS: [
    '',
    '   ',
    'short',
    'too_long_to_be_a_valid_youtube_video_id_123456789',
    'invalid!char$',
    '../../etc/passwd',
    'https://not-youtube.com/watch?v=123'
  ]
};

// SSRF Attack Vectors
export const SSRF_TARGETS = [
  'http://127.0.0.1:8000',
  'http://127.0.0.1:3300',
  'http://localhost',
  'http://169.254.169.254/latest/meta-data/',
  'http://169.254.169.254/computeMetadata/v1/',
  'http://10.0.0.1/admin',
  'http://172.16.0.1',
  'http://192.168.1.1',
  'http://[::1]',
  'http://0.0.0.0:8000'
];

// --- 10 Team Member Accounts across Workspaces & Roles ---
export const TEAM_MEMBERS = [
  // Workspace Alpha (Production Team A)
  {
    userId: 'user_admin_a',
    workspaceId: 'workspace-team-a',
    role: 'admin',
    name: 'Alice Admin',
    apiKey: 'key_admin_a_2026',
    canMutate: true,
    canApprovePublish: true,
    canConfigureCompliance: true
  },
  {
    userId: 'user_editor_a1',
    workspaceId: 'workspace-team-a',
    role: 'editor',
    name: 'Bob Lead Editor',
    apiKey: 'key_editor_a1_2026',
    canMutate: true,
    canApprovePublish: false,
    canConfigureCompliance: false
  },
  {
    userId: 'user_editor_a2',
    workspaceId: 'workspace-team-a',
    role: 'editor',
    name: 'Charlie Assistant Editor',
    apiKey: 'key_editor_a2_2026',
    canMutate: true,
    canApprovePublish: false,
    canConfigureCompliance: false
  },
  {
    userId: 'user_publisher_a',
    workspaceId: 'workspace-team-a',
    role: 'publisher',
    name: 'Diana Social Publisher',
    apiKey: 'key_publisher_a_2026',
    canMutate: false,
    canApprovePublish: true,
    canConfigureCompliance: false
  },
  {
    userId: 'user_viewer_a',
    workspaceId: 'workspace-team-a',
    role: 'viewer',
    name: 'Evan Client Observer',
    apiKey: 'key_viewer_a_2026',
    canMutate: false,
    canApprovePublish: false,
    canConfigureCompliance: false
  },

  // Workspace Beta (Production Team B)
  {
    userId: 'user_admin_b',
    workspaceId: 'workspace-team-b',
    role: 'admin',
    name: 'Fiona Admin B',
    apiKey: 'key_admin_b_2026',
    canMutate: true,
    canApprovePublish: true,
    canConfigureCompliance: true
  },
  {
    userId: 'user_editor_b1',
    workspaceId: 'workspace-team-b',
    role: 'editor',
    name: 'George Senior Editor B',
    apiKey: 'key_editor_b1_2026',
    canMutate: true,
    canApprovePublish: false,
    canConfigureCompliance: false
  },
  {
    userId: 'user_editor_b2',
    workspaceId: 'workspace-team-b',
    role: 'editor',
    name: 'Hannah Junior Editor B',
    apiKey: 'key_editor_b2_2026',
    canMutate: true,
    canApprovePublish: false,
    canConfigureCompliance: false
  },
  {
    userId: 'user_publisher_b',
    workspaceId: 'workspace-team-b',
    role: 'publisher',
    name: 'Ian Platform Specialist B',
    apiKey: 'key_publisher_b_2026',
    canMutate: false,
    canApprovePublish: true,
    canConfigureCompliance: false
  },
  {
    userId: 'user_viewer_b',
    workspaceId: 'workspace-team-b',
    role: 'viewer',
    name: 'Julia Guest Reviewer B',
    apiKey: 'key_viewer_b_2026',
    canMutate: false,
    canApprovePublish: false,
    canConfigureCompliance: false
  }
];

// Pre-seeded multi-tenancy records
export const TENANTS = {
  ALPHA: {
    tenantId: 'tenant_alpha',
    name: 'Alpha Media Networks',
    apiKey: 'key_tenant_alpha_secret_2026',
    workspaceId: 'workspace-team-a',
    dailyLimit: 50,
    maxConcurrentJobs: 4
  },
  BETA: {
    tenantId: 'tenant_beta',
    name: 'Beta Global Studio',
    apiKey: 'key_tenant_beta_secret_2026',
    workspaceId: 'workspace-team-b',
    dailyLimit: 20,
    maxConcurrentJobs: 2
  }
};

// --- Synthetic Media Buffers ---
export function createSyntheticMp4Buffer(byteLength = 1024) {
  const buf = Buffer.alloc(Math.max(byteLength, 32));
  // Write a basic ISO Base Media File Format header (ftyp box)
  buf.writeUInt32BE(28, 0); // box size
  buf.write('ftyp', 4, 4, 'ascii'); // box type
  buf.write('isom', 8, 4, 'ascii'); // major brand
  buf.writeUInt32BE(512, 12); // minor version
  buf.write('isomiso2mp41', 16, 12, 'ascii'); // compatible brands
  // Write moov tag marker at byte 28
  buf.writeUInt32BE(byteLength - 28, 28);
  if (byteLength >= 36) {
    buf.write('moov', 32, 4, 'ascii');
  }
  return buf;
}

export const SYNTHETIC_BUFFERS = {
  validMp4: createSyntheticMp4Buffer(1024),
  empty: Buffer.alloc(0),
  corrupt: Buffer.from('CORRUPTED_NON_MP4_HEADER_PAYLOAD_TEST_DATA')
};

// --- Fixture Factories ---

export function createValidRightsManifest(videoId = CANONICAL_VIDEOS.SAMPLE_1.id, overrides = {}) {
  return {
    rights_id: `rights_${crypto.randomUUID().slice(0, 8)}`,
    video_id: videoId,
    basis: 'OWNED', // OWNED | EXPLICIT_PERMISSION | CREATIVE_COMMONS | VERIFIED_LICENSE
    status: 'VERIFIED',
    owner: 'Verified Studio Fixture Owner',
    owner_name: 'Verified Studio Fixture Owner',
    proof_reference: 'doc_verified_license_2026',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    notes: 'Autonomous verification fixture',
    ...overrides
  };
}

export function createInvalidRightsManifest(videoId = CANONICAL_VIDEOS.SAMPLE_1.id, overrides = {}) {
  return {
    rights_id: `rights_inv_${crypto.randomUUID().slice(0, 8)}`,
    video_id: videoId,
    basis: 'UNAUTHORIZED_SCRAPE',
    status: 'REVOKED',
    owner: 'Unknown Third Party',
    proof_reference: '',
    ...overrides
  };
}

export function createValidHighlightCandidate(videoId = CANONICAL_VIDEOS.SAMPLE_1.id, overrides = {}) {
  return {
    candidate_id: `cand_${crypto.randomUUID().slice(0, 8)}`,
    video_id: videoId,
    start_seconds: 15.0,
    end_seconds: 45.0,
    duration_seconds: 30.0,
    score: 93.4,
    hook_title: 'Transformative Autonomous Generation',
    suggested_description: 'Discover how multi-platform video pipelines execute with verified zero leaks.',
    breakdown: {
      hook_score: 9.6,
      moment_score: 9.2,
      coherence_score: 9.1,
      pacing_score: 8.8,
      audio_energy_score: 8.5,
      visual_score: 9.0,
      heatmap_score: 9.4,
      confidence: 0.98
    },
    caption_package: {
      youtube_shorts: 'Autonomous video generation in 2026 #AI #Tech',
      instagram_reels: 'The next evolution of video intelligence 🚀 #engineering',
      tiktok: 'Full automation is here #fyp #techtok',
      tags: ['ai', 'automation', 'video', 'nextjs']
    },
    ...overrides
  };
}

export function createValidVideoInfo(videoId = CANONICAL_VIDEOS.SAMPLE_1.id, overrides = {}) {
  const isSample2 = videoId === CANONICAL_VIDEOS.SAMPLE_2.id;
  const isSample1 = videoId === CANONICAL_VIDEOS.SAMPLE_1.id;
  const title = isSample2
    ? CANONICAL_VIDEOS.SAMPLE_2.title
    : (isSample1 ? CANONICAL_VIDEOS.SAMPLE_1.title : 'Autonomous YouTube Clipping & Video Intelligence');
  const duration = isSample2 ? CANONICAL_VIDEOS.SAMPLE_2.duration : 184.0;
  const channel_title = isSample2 ? CANONICAL_VIDEOS.SAMPLE_2.channel : 'Intelligence Dynamics Lab';

  return {
    video_id: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    description: 'High-performance video analysis, clipping, and multi-platform publishing platform.',
    duration,
    channel_id: 'UC_test_intelligence_channel',
    channel_title,
    view_count: 1450200,
    like_count: 89400,
    tags: ['ai', 'video', 'clipping', 'omnipost'],
    thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    ...overrides
  };
}

export function createValidExternalAiPayload(projectId = 'proj-e2e-01', overrides = {}) {
  return {
    project_id: projectId,
    video_url: 'https://cdn.example-storage.com/renders/scene_01.mp4',
    source_engine: 'comfyui_flux_luma',
    prompt_metadata: {
      prompt: 'Futuristic cityscape in neon rain with flying vehicles',
      style: 'cyberpunk_cinematic'
    },
    transcript: [
      { start: 0.0, end: 4.5, text: 'The city breathes through optical fiber nodes.' },
      { start: 4.8, end: 9.2, text: 'Autonomous render engines process every frame at scale.' }
    ],
    target_aspect_ratio: '9:16',
    omnipost_routing: {
      workspace_id: 'workspace-team-a',
      channels: ['youtube_shorts', 'instagram_reels', 'tiktok'],
      publish_immediately: true
    },
    ...overrides
  };
}

export function createValidWebhookPayload(eventId = `evt_${crypto.randomUUID().slice(0, 8)}`, overrides = {}) {
  return {
    event_id: eventId,
    event_type: 'POST_PUBLISHED',
    timestamp: new Date().toISOString(),
    tenant_id: 'tenant_alpha',
    project_id: 'proj-e2e-01',
    job_id: 'job-e2e-01',
    content_id: 'CLIP-01-V2',
    idempotency_key: `idem_${eventId}`,
    status: 'PUBLISHED',
    platforms: ['youtube_shorts', 'instagram_reels'],
    published_urls: {
      youtube_shorts: 'https://youtube.com/shorts/sample123',
      instagram_reels: 'https://instagram.com/reel/sample456'
    },
    ...overrides
  };
}

export function create12PointQAReport(clipId = 'clip_test_01', overrides = {}) {
  return {
    clip_id: clipId,
    status: 'PASSED',
    score: 100,
    checks: [
      { name: 'container_decodability', passed: true, details: 'QuickTime/MP4 decodable' },
      { name: 'duration_tolerance', passed: true, details: 'Duration within ±0.5s of spec' },
      { name: 'video_stream_present', passed: true, details: 'h264 stream active' },
      { name: 'audio_stream_present', passed: true, details: 'aac 48kHz stereo stream active' },
      { name: 'sar_unity', passed: true, details: 'Sample Aspect Ratio 1:1 verified' },
      { name: 'dar_conformance', passed: true, details: 'Display Aspect Ratio conforms to 9:16' },
      { name: 'frame_rate_conformance', passed: true, details: 'Frame rate 30.0 fps ≥ 24 fps' },
      { name: 'audio_sampling_rate', passed: true, details: 'Audio rate 48000 Hz ≥ 44100 Hz' },
      { name: 'audio_loudness_normalized', passed: true, details: 'Integrated loudness -14 LUFS' },
      { name: 'zero_frozen_frames', passed: true, details: 'Zero consecutive frozen frames detected' },
      { name: 'sha256_verified', passed: true, details: 'Valid 64-char hex digest present' },
      { name: 'file_size_valid', passed: true, details: 'Non-empty file size > 1024 bytes' }
    ],
    sha256: crypto.createHash('sha256').update(clipId).digest('hex'),
    ...overrides
  };
}

// Bundle as default object for easy namespace consumption
export const TestFixtures = {
  CANONICAL_VIDEOS,
  SSRF_TARGETS,
  TEAM_MEMBERS,
  TENANTS,
  SYNTHETIC_BUFFERS,
  DEFAULT_WEBHOOK_SECRET,
  DEFAULT_ADMIN_KEY,
  createSyntheticMp4Buffer,
  createValidRightsManifest,
  createInvalidRightsManifest,
  createValidHighlightCandidate,
  createValidVideoInfo,
  createValidExternalAiPayload,
  createValidWebhookPayload,
  create12PointQAReport
};

export default TestFixtures;
