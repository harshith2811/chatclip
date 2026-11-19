/**
 * e2e/tier1_features/f03_external_ai_video_ingest.test.js
 * Feature F03: External AI Video Ingest Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { TENANTS, createValidExternalAiPayload } from '../harness/fixtures.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F03: External AI Video Ingest', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F03-TC-01: ComfyUI / FLUX.1 video ingest by authorized tenant returns 201 with valid job_id', async () => {
    const tenantClient = client.asTenant(TENANTS.ALPHA.tenantId, TENANTS.ALPHA.apiKey);
    const payload = createValidExternalAiPayload('proj-f03-01', {
      source_engine: 'comfyui_flux_luma',
      video_url: 'https://cdn.example-storage.com/renders/scene_01.mp4'
    });
    const res = await tenantClient.externalAiIngest(payload);
    assertStatus(res, 201);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.success, true);
    assert.ok(res.data.job_id);
    assert.equal(res.data.tenant_id, TENANTS.ALPHA.tenantId);
    assert.equal(res.data.status, 'QUEUED');
  });

  it('F03-TC-02: Runway Gen-3 video ingest with prompt metadata returns 201 QUEUED', async () => {
    const tenantClient = client.asTenant(TENANTS.ALPHA.tenantId, TENANTS.ALPHA.apiKey);
    const payload = createValidExternalAiPayload('proj-f03-02', {
      source_engine: 'runway_gen3',
      video_url: 'https://media.runwayml.com/renders/gen3_scene.mp4',
      prompt_metadata: {
        prompt: 'Futuristic hyperloop transit terminal',
        style: 'cinematic_8k'
      }
    });
    const res = await tenantClient.externalAiIngest(payload);
    assertStatus(res, 201);
    assert.equal(res.data.success, true);
    assert.equal(res.data.status, 'QUEUED');
  });

  it('F03-TC-03: Luma Dream Machine video ingest with timed transcript array returns 201', async () => {
    const tenantClient = client.asTenant(TENANTS.ALPHA.tenantId, TENANTS.ALPHA.apiKey);
    const payload = createValidExternalAiPayload('proj-f03-03', {
      source_engine: 'luma_dream_machine',
      video_url: 'https://assets.example.com/luma_render.mp4',
      transcript: [
        { start: 0.0, end: 3.5, text: 'Next-generation generative media processing.' },
        { start: 3.8, end: 7.2, text: 'Real-time multi-platform short form syndication.' }
      ]
    });
    const res = await tenantClient.externalAiIngest(payload);
    assertStatus(res, 201);
    assert.equal(res.data.success, true);
    assert.ok(res.data.job_id);
  });

  it('F03-TC-04: OpenAI Sora ingest with multi-platform OmniPost routing returns 201', async () => {
    const tenantClient = client.asTenant(TENANTS.ALPHA.tenantId, TENANTS.ALPHA.apiKey);
    const payload = createValidExternalAiPayload('proj-f03-04', {
      source_engine: 'openai_sora',
      video_url: 'https://cdn.example-storage.com/sora_sample.mp4',
      omnipost_routing: {
        workspace_id: 'workspace-team-a',
        channels: ['youtube_shorts', 'instagram_reels', 'tiktok'],
        publish_immediately: true
      }
    });
    const res = await tenantClient.externalAiIngest(payload);
    assertStatus(res, 201);
    assert.equal(res.data.success, true);
  });

  it('F03-TC-05: status query GET /api/v1/external/ai-video/status/{job_id} returns 200 matching job details', async () => {
    const tenantClient = client.asTenant(TENANTS.ALPHA.tenantId, TENANTS.ALPHA.apiKey);
    const ingestRes = await tenantClient.externalAiIngest(createValidExternalAiPayload());
    assertStatus(ingestRes, 201);
    const jobId = ingestRes.data.job_id;

    const statusRes = await tenantClient.getExternalAiJobStatus(jobId);
    assertStatus(statusRes, 200);
    assert.equal(statusRes.data.job_id, jobId);
    assert.equal(statusRes.data.tenant_id, TENANTS.ALPHA.tenantId);
    assert.equal(statusRes.data.status, 'QUEUED');
  });
});
