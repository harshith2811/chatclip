/**
 * e2e/tier1_features/f11_multi_layout_rendering.test.js
 * Feature F11: Multi-Layout Rendering Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { CANONICAL_VIDEOS } from '../harness/fixtures.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F11: Multi-Layout Rendering', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F11-TC-01: active speaker layout dispatch returns 200 with task ID', async () => {
    const res = await client.renderVideo(CANONICAL_VIDEOS.SAMPLE_1.id, {
      layout: 'active_speaker',
      subtitle_preset: 'clean_bold'
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.ok(res.data.task_id);
    assert.equal(res.data.status, 'QUEUED');
  });

  it('F11-TC-02: blurred background layout dispatch returns 200 QUEUED', async () => {
    const res = await client.renderVideo(CANONICAL_VIDEOS.SAMPLE_1.id, {
      layout: 'blur_background'
    });
    assertStatus(res, 200);
    assert.equal(res.data.status, 'QUEUED');
    assert.ok(res.data.task_id);
  });

  it('F11-TC-03: split screen layout dispatch returns 200 QUEUED', async () => {
    const res = await client.renderVideo(CANONICAL_VIDEOS.SAMPLE_1.id, {
      layout: 'split_screen'
    });
    assertStatus(res, 200);
    assert.equal(res.data.status, 'QUEUED');
    assert.ok(res.data.task_id);
  });

  it('F11-TC-04: endpoint alias /api/v1/render/job dispatches render jobs identically', async () => {
    const res = await client.post('/api/v1/render/job', {
      video_id_or_url: CANONICAL_VIDEOS.SAMPLE_1.id,
      layout: 'active_speaker'
    });
    assertStatus(res, 200);
    assert.equal(res.data.status, 'QUEUED');
    assert.ok(res.data.job_id);
  });

  it('F11-TC-05: task status polling via GET /api/v1/render/status/{task_id} verifies stored layout', async () => {
    const renderRes = await client.renderVideo(CANONICAL_VIDEOS.SAMPLE_1.id, {
      layout: 'split_screen',
      subtitle_preset: 'neon_cyber'
    });
    assertStatus(renderRes, 200);
    const taskId = renderRes.data.task_id;

    const statusRes = await client.getRenderStatus(taskId);
    assertStatus(statusRes, 200);
    assert.equal(statusRes.data.task_id, taskId);
    assert.equal(statusRes.data.layout, 'split_screen');
    assert.equal(statusRes.data.subtitle_preset, 'neon_cyber');
  });
});
