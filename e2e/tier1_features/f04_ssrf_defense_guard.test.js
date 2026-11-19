/**
 * e2e/tier1_features/f04_ssrf_defense_guard.test.js
 * Feature F04: SSRF Defense Guard Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { TENANTS, createValidExternalAiPayload } from '../harness/fixtures.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F04: SSRF Defense Guard', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F04-TC-01: legitimate public storage CDN URL passes SSRF defense guard with 201', async () => {
    const tenantClient = client.asTenant(TENANTS.ALPHA.tenantId, TENANTS.ALPHA.apiKey);
    const payload = createValidExternalAiPayload('proj-ssrf-01', {
      video_url: 'https://cdn.example-storage.com/scene.mp4'
    });
    const res = await tenantClient.externalAiIngest(payload);
    assertStatus(res, 201);
    assert.equal(res.data.success, true);
    assert.ok(res.data.job_id);
  });

  it('F04-TC-02: AWS S3 public bucket URL passes SSRF defense guard with 201', async () => {
    const tenantClient = client.asTenant(TENANTS.ALPHA.tenantId, TENANTS.ALPHA.apiKey);
    const payload = createValidExternalAiPayload('proj-ssrf-02', {
      video_url: 'https://s3.amazonaws.com/prod-ai-bucket/scene.mp4'
    });
    const res = await tenantClient.externalAiIngest(payload);
    assertStatus(res, 201);
    assert.equal(res.data.success, true);
  });

  it('F04-TC-03: Google Cloud Storage public URL passes SSRF defense guard with 201', async () => {
    const tenantClient = client.asTenant(TENANTS.ALPHA.tenantId, TENANTS.ALPHA.apiKey);
    const payload = createValidExternalAiPayload('proj-ssrf-03', {
      video_url: 'https://storage.googleapis.com/pipeline/scene.mp4'
    });
    const res = await tenantClient.externalAiIngest(payload);
    assertStatus(res, 201);
    assert.equal(res.data.success, true);
  });

  it('F04-TC-04: RunwayML public asset domain passes SSRF defense guard with 201', async () => {
    const tenantClient = client.asTenant(TENANTS.ALPHA.tenantId, TENANTS.ALPHA.apiKey);
    const payload = createValidExternalAiPayload('proj-ssrf-04', {
      video_url: 'https://media.runwayml.com/renders/gen3.mp4'
    });
    const res = await tenantClient.externalAiIngest(payload);
    assertStatus(res, 201);
    assert.equal(res.data.success, true);
  });

  it('F04-TC-05: Cloudflare R2 public storage asset passes SSRF defense guard with 201', async () => {
    const tenantClient = client.asTenant(TENANTS.ALPHA.tenantId, TENANTS.ALPHA.apiKey);
    const payload = createValidExternalAiPayload('proj-ssrf-05', {
      video_url: 'https://assets.cloudflare-r2.com/video/scene.mp4'
    });
    const res = await tenantClient.externalAiIngest(payload);
    assertStatus(res, 201);
    assert.equal(res.data.success, true);
  });
});
