/**
 * e2e/harness/harness.test.js
 * Verification smoke test certifying every component of the E2E Test Harness:
 * Server lifecycle, Client REST methods, Range 206, SSE streams, HMAC webhooks,
 * RBAC/Tenant isolation, and custom assertions.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { E2ETestClient } from './client.js';
import { startTestServer, stopTestServer } from './mock_backend.js';
import {
  TestFixtures,
  CANONICAL_VIDEOS,
  DEFAULT_WEBHOOK_SECRET
} from './fixtures.js';
import {
  assertStatus,
  assertHeaders,
  assertRangeResponse,
  assertSSEStream,
  assert12PointMediaQA,
  assertMultiUserIsolation,
  assertSignedHMAC
} from './assertions.js';

describe('E2E Harness Infrastructure & Runner Certification', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    // Start mock backend on ephemeral port
    serverInfo = await startTestServer({ port: 0 });
    assert.ok(serverInfo.port > 0, 'Server should bind to a valid dynamic ephemeral port');
    assert.ok(serverInfo.baseUrl.startsWith('http://127.0.0.1:'), 'Base URL should target 127.0.0.1');

    client = new E2ETestClient({
      baseUrl: serverInfo.baseUrl,
      workspaceId: 'workspace-team-a',
      userId: 'user_admin_a',
      userRole: 'admin'
    });
  });

  after(async () => {
    await stopTestServer();
  });

  describe('1. Health & Core REST Contracts', () => {
    it('verifies GET /api/v1/health returns healthy payload', async () => {
      const res = await client.getHealth();
      assertStatus(res, 200);
      assert.equal(res.data.status, 'healthy');
      assert.equal(res.data.ffmpeg_ready, true);
    });

    it('verifies POST /api/v1/metadata resolves canonical video info', async () => {
      const res = await client.getMetadata(CANONICAL_VIDEOS.SAMPLE_1.id);
      assertStatus(res, 200);
      assert.equal(res.data.video_id, CANONICAL_VIDEOS.SAMPLE_1.id);
      assert.ok(res.data.title.length > 0);
      assert.ok(res.data.duration > 0);
    });

    it('verifies POST /api/v1/metadata rejects invalid video ID format with 400', async () => {
      const res = await client.getMetadata('../../etc/passwd');
      assertStatus(res, 400);
      assert.ok(res.data.detail.includes('Invalid'));
    });

    it('verifies POST /api/v1/preview returns highlight candidates and retention curve', async () => {
      const res = await client.getPreview(CANONICAL_VIDEOS.SAMPLE_1.id);
      assertStatus(res, 200);
      assert.ok(Array.isArray(res.data.candidates));
      assert.ok(res.data.candidates.length > 0);
      assert.ok(res.data.candidates[0].score > 90);
    });

    it('verifies POST /api/v1/render queues rendering job', async () => {
      const res = await client.renderVideo({
        video_id_or_url: CANONICAL_VIDEOS.SAMPLE_1.id,
        layout: 'active_speaker',
        subtitle_preset: 'bold_stroke'
      });
      assertStatus(res, 200);
      assert.equal(res.data.status, 'QUEUED');
      assert.ok(res.data.job_id);
    });

    it('verifies GET /api/v1/trending/top10m returns curated trending video list', async () => {
      const res = await client.getTop10mTrending(5);
      assertStatus(res, 200);
      assert.ok(Array.isArray(res.data));
      assert.equal(res.data.length, 5);
      assert.ok(res.data[0].video_id);
    });
  });

  describe('2. Project Store & Sidecar Contracts', () => {
    it('lists existing projects and gets project by ID', async () => {
      const listRes = await client.listProjects();
      assertStatus(listRes, 200);
      assert.ok(Array.isArray(listRes.data));
      assert.ok(listRes.data.length >= 1);

      const projRes = await client.getProject('proj-default');
      assertStatus(projRes, 200);
      assert.equal(projRes.data.project_id, 'proj-default');
    });

    it('creates, inspects, and deletes a temporary project atomically', async () => {
      const createRes = await client.post('/api/v1/projects', {
        project_id: 'proj-temp-smoke',
        title: 'Temporary Smoke Project'
      });
      assertStatus(createRes, 201);
      assert.equal(createRes.data.project_id, 'proj-temp-smoke');

      const delRes = await client.deleteProject('proj-temp-smoke');
      assertStatus(delRes, 200);
      assert.equal(delRes.data.status, 'deleted');

      const checkRes = await client.getProject('proj-temp-smoke');
      assertStatus(checkRes, 404);
    });
  });

  describe('3. HTTP 206 Partial Content Range Streaming', () => {
    it('executes valid HTTP 206 Range request with exact byte slice', async () => {
      const rangeRes = await client.getMediaWithRange('clip-default-01', 0, 511);
      assertRangeResponse(rangeRes, {
        expectedStatus: 206,
        start: 0,
        end: 511,
        totalLength: 10240,
        mimeType: 'video/mp4'
      });
      assert.equal(rangeRes.buffer.length, 512);
    });

    it('returns HTTP 416 Range Not Satisfiable for out-of-bounds start byte', async () => {
      const rangeRes = await client.getMediaWithRange('clip-default-01', 999999, 1000050);
      assert.equal(rangeRes.status, 416);
      assertHeaders(rangeRes, { 'content-range': 'bytes */10240' });
    });

    it('rejects path traversal attempts on media endpoint with 400', async () => {
      const traversalRes = await client.getMediaWithRange('../../../etc/passwd', 0, 100);
      assertStatus(traversalRes, 400);
      assert.ok(traversalRes.data.detail.includes('Invalid clip identifier'));
    });
  });

  describe('4. Server-Sent Events (SSE) Streaming', () => {
    it('listens to SSE job stream and receives progress stages and terminal completion', async () => {
      const events = await client.listenJobStream('job-sample-1', { timeoutMs: 5000 });
      assertSSEStream(events, {
        expectedStages: ['downloading', 'transcribing', 'rendering'],
        terminalEvent: 'end',
        minEvents: 4
      });
      const terminal = events.find(e => e.event === 'end');
      assert.equal(terminal.data.status, 'COMPLETED');
      assert.equal(terminal.data.progress, 100);
    });

    it('returns SSE error frame on non-existent job ID', async () => {
      const events = await client.listenJobStream('job-missing-smoke-id', { timeoutMs: 3000 });
      assert.ok(events.length >= 1);
      assert.equal(events[0].event, 'error');
      assert.ok(events[0].data.error.includes('not found'));
    });
  });

  describe('5. HMAC-SHA256 Signed Webhooks', () => {
    it('accepts valid HMAC-SHA256 signed webhook delivery', async () => {
      const payload = TestFixtures.createValidWebhookPayload('evt_smoke_001');
      const res = await client.sendSignedOmniPostWebhook(payload, {
        secret: DEFAULT_WEBHOOK_SECRET
      });
      assertStatus(res, 200);
      assert.equal(res.data.success, true);
      assert.equal(res.data.processed, true);
    });

    it('rejects tampered / invalid HMAC-SHA256 signature with 401 Unauthorized', async () => {
      const payload = TestFixtures.createValidWebhookPayload('evt_smoke_tamper');
      const res = await client.sendSignedOmniPostWebhook(payload, {
        customSignature: 'bad_forged_hex_signature_1234567890abcdef'
      });
      assertStatus(res, 401);
      assert.ok(res.data.detail.includes('Invalid or missing webhook HMAC signature'));
    });

    it('safely suppresses duplicate webhook replay with 200 skip confirmation', async () => {
      const payload = TestFixtures.createValidWebhookPayload('evt_smoke_replay');
      const res1 = await client.sendSignedOmniPostWebhook(payload, { secret: DEFAULT_WEBHOOK_SECRET });
      assertStatus(res1, 200);
      assert.equal(res1.data.processed, true);

      // Replay same event ID
      const res2 = await client.sendSignedOmniPostWebhook(payload, { secret: DEFAULT_WEBHOOK_SECRET });
      assertStatus(res2, 200);
      assert.ok(res2.data.message.includes('Duplicate webhook event safely skipped'));
    });
  });

  describe('6. RBAC & Multi-Tenant Workspace Isolation', () => {
    it('prevents viewer role from executing mutating operations (POST)', async () => {
      const viewerClient = client.asUser('user_viewer_a', 'viewer', 'workspace-team-a');
      const res = await viewerClient.post('/api/v1/render', {
        video_id_or_url: CANONICAL_VIDEOS.SAMPLE_1.id
      });
      assertMultiUserIsolation(res, { expectedAccessDenied: true });
      assert.equal(res.status, 403);
      assert.ok(res.data.detail.includes('Role viewer has read-only access'));
    });

    it('prevents cross-workspace access to foreign tenant projects', async () => {
      // workspace-team-a attempting to access project belonging to workspace-team-b
      const crossClient = client.asUser('user_editor_a1', 'editor', 'workspace-team-a');
      const res = await crossClient.getProject('proj-team-b');
      assertMultiUserIsolation(res, { expectedAccessDenied: true });
      assert.equal(res.status, 403);
      assert.ok(res.data.detail.includes('CROSS_TENANT_WORKSPACE_FORBIDDEN'));
    });

    it('allows authorized access within same workspace', async () => {
      const teamBClient = client.asUser('user_editor_b1', 'editor', 'workspace-team-b');
      const res = await teamBClient.getProject('proj-team-b');
      assertMultiUserIsolation(res, { expectedAccessDenied: false });
      assert.equal(res.status, 200);
      assert.equal(res.data.project_id, 'proj-team-b');
    });

    it('enforces tenant API key authentication on external AI video ingest', async () => {
      const payload = TestFixtures.createValidExternalAiPayload();
      // No tenant key provided -> 401
      const unauthClient = client.asTenant('tenant_alpha', '');
      const unauthRes = await unauthClient.externalAiIngest(payload);
      assertStatus(unauthRes, 401);

      // Valid tenant key provided -> 201
      const authClient = client.asTenant('tenant_alpha', 'key_tenant_alpha_secret_2026');
      const authRes = await authClient.externalAiIngest(payload);
      assertStatus(authRes, 201);
      assert.equal(authRes.data.tenant_id, 'tenant_alpha');
    });

    it('rejects unauthenticated external AI job status queries with 401 Unauthorized', async () => {
      const res = await client.fastApi('/api/v1/external/ai-video/status/job-sample-1');
      assertStatus(res, 401);
      assert.ok(res.data.detail.includes('Authentication required'));
    });

    it('rejects external AI job status queries with invalid tenant key with 401 Unauthorized', async () => {
      const res = await client.fastApi('/api/v1/external/ai-video/status/job-sample-1', {
        headers: { 'x-tenant-key': 'bogus_invalid_tenant_key' }
      });
      assertStatus(res, 401);
      assert.ok(res.data.detail.includes('invalid or inactive tenant credentials'));
    });

    it('prevents foreign tenant from accessing external AI job with 403 Forbidden', async () => {
      const betaClient = client.asTenant('tenant_beta', 'key_tenant_beta_secret_2026');
      const res = await betaClient.getExternalAiJobStatus('job-sample-1');
      assertMultiUserIsolation(res, { expectedAccessDenied: true });
      assert.equal(res.status, 403);
      assert.ok(res.data.detail.includes('Tenant is not authorized to access this job'));
    });

    it('prevents default workspace from accessing foreign private project with 403 Forbidden', async () => {
      const defaultWsClient = client.asUser('user_default', 'viewer', 'workspace_default');
      const res = await defaultWsClient.getProject('proj-team-b');
      assertMultiUserIsolation(res, { expectedAccessDenied: true });
      assert.equal(res.status, 403);
      assert.ok(res.data.detail.includes('CROSS_TENANT_WORKSPACE_FORBIDDEN'));
    });
  });

  describe('7. SSRF Security Guard', () => {
    it('blocks internal loopback IP connection attempt on external ingest', async () => {
      const tenantClient = client.asTenant('tenant_alpha', 'key_tenant_alpha_secret_2026');
      const payload = TestFixtures.createValidExternalAiPayload('proj-ssrf-1', {
        video_url: 'http://127.0.0.1:8000/internal-data'
      });
      const res = await tenantClient.externalAiIngest(payload);
      assertStatus(res, 400);
      assert.ok(res.data.detail.includes('SSRF Blocked'));
    });

    it('blocks cloud metadata endpoint (169.254.169.254) connection attempt', async () => {
      const tenantClient = client.asTenant('tenant_alpha', 'key_tenant_alpha_secret_2026');
      const payload = TestFixtures.createValidExternalAiPayload('proj-ssrf-2', {
        video_url: 'http://169.254.169.254/latest/meta-data/'
      });
      const res = await tenantClient.externalAiIngest(payload);
      assertStatus(res, 400);
      assert.ok(res.data.detail.includes('SSRF Blocked'));
    });
  });

  describe('8. Governance, Compliance & Media QA Gates', () => {
    it('queries telemetry governor HUD status', async () => {
      const res = await client.getGovernorStatus();
      assertStatus(res, 200);
      assert.equal(res.data.zero_memory_leak_certified, true);
      assert.ok(res.data.cpu_cores >= 1);
    });

    it('toggles legal officer strict compliance switch', async () => {
      const getRes = await client.getLegalOfficer();
      assertStatus(getRes, 200);
      assert.equal(typeof getRes.data.enabled, 'boolean');

      const setRes = await client.setLegalOfficer(false);
      assertStatus(setRes, 200);
      assert.equal(setRes.data.enabled, false);
      assert.equal(setRes.data.mode, 'UNRESTRICTED_BYPASS');

      // Re-enable
      const resetRes = await client.setLegalOfficer(true);
      assertStatus(resetRes, 200);
      assert.equal(resetRes.data.enabled, true);
      assert.equal(resetRes.data.mode, 'STRICT_COMPLIANCE');
    });

    it('prevents editor role from toggling legal officer compliance switch with 403 Forbidden', async () => {
      const editorClient = client.asUser('user_editor_a1', 'editor', 'workspace-team-a');
      const res = await editorClient.setLegalOfficer(false);
      assert.equal(res.status, 403);
      assert.ok(res.data.detail.includes('Admin role required'));
    });

    it('verifies append-only rights log rejects mutation (PUT/DELETE) on item and collection root with 403', async () => {
      const regRes = await client.registerRights({
        video_id: 'test_vid_rights',
        basis: 'OWNED',
        owner: 'Verified QA Lead'
      });
      assertStatus(regRes, 200);

      // Attempt to modify append-only log entry -> must be rejected
      const putRes = await client.put(`/api/v1/rights/audit/${regRes.data.rights_id}`, {
        owner: 'Unauthorized Malicious Modification'
      });
      assertStatus(putRes, 403);
      assert.ok(putRes.data.detail.includes('append-only'));

      // Attempt to modify collection root directly -> must be rejected with 403
      const putRootRes = await client.put('/api/v1/rights/audit', {
        owner: 'Unauthorized Root Modification'
      });
      assertStatus(putRootRes, 403);
      assert.ok(putRootRes.data.detail.includes('append-only'));

      const delRootRes = await client.delete('/api/v1/rights/audit');
      assertStatus(delRootRes, 403);
      assert.ok(delRootRes.data.detail.includes('append-only'));
    });

    it('validates 12-point media QA gate assertion helper', () => {
      const validReport = TestFixtures.create12PointQAReport('clip_qa_verified_01');
      assert12PointMediaQA(validReport);
      assert.equal(validReport.status, 'PASSED');
    });

    it('asserts signed HMAC calculation helper', () => {
      const payload = { test: 'hmac_verification', timestamp: 12345 };
      const secret = 'custom_secret_key_2026';
      const realSig = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
      assertSignedHMAC(realSig, payload, secret);
    });
  });
});
