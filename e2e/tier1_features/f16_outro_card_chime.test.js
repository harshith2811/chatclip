/**
 * e2e/tier1_features/f16_outro_card_chime.test.js
 * Feature F16: Outro Card & Chime Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { CANONICAL_VIDEOS } from '../harness/fixtures.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F16: Outro Card & Chime', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F16-TC-01: branded channel attribution: channel_name reflected in brand_text', async () => {
    const res = await client.post('/api/v1/render/outro', {
      channel_name: 'Intelligence Dynamics Lab'
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.success, true);
    assert.equal(res.data.brand_text, 'Intelligence Dynamics Lab');
  });

  it('F16-TC-02: 48kHz synthesized zen bell chime: audio_chime === "zen_bell_synth_48k.wav"', async () => {
    const res = await client.post('/api/v1/render/outro', {});
    assertStatus(res, 200);
    assert.equal(res.data.audio_chime, 'zen_bell_synth_48k.wav');
  });

  it('F16-TC-03: outro duration specification: outro_duration === 3.5 seconds', async () => {
    const res = await client.post('/api/v1/render/outro', {});
    assertStatus(res, 200);
    assert.equal(res.data.outro_duration, 3.5);
  });

  it('F16-TC-04: default brand text fallback: empty channel name defaults to "Autonomous Clipping"', async () => {
    const res = await client.post('/api/v1/render/outro', {});
    assertStatus(res, 200);
    assert.equal(res.data.brand_text, 'Autonomous Clipping');
  });

  it('F16-TC-05: render pipeline integration: POST /api/v1/render with enable_outro: true queues task', async () => {
    const res = await client.renderVideo(CANONICAL_VIDEOS.SAMPLE_1.id, {
      enable_outro: true
    });
    assertStatus(res, 200);
    assert.equal(res.data.status, 'QUEUED');
    assert.ok(res.data.task_id);
  });
});
