/**
 * e2e/tier1_features/f14_monologue_broll_overlay.test.js
 * Feature F14: Monologue B-Roll Overlay Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F14: Monologue B-Roll Overlay', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F14-TC-01: standard B-roll asset generation returns status "success" and MP4 path', async () => {
    const res = await client.post('/api/v1/render/b-roll', {
      source_clip_id: 'clip-default-01',
      prompt: 'Neon cybernetic cityscape at night',
      duration: 4.0
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.status, 'success');
    assert.ok(res.data.video_path.endsWith('.mp4'));
  });

  it('F14-TC-02: FLUX.1 generative route /api/v1/flux/broll-clip equivalence', async () => {
    const res = await client.post('/api/v1/flux/broll-clip', {
      prompt: 'Quantum computer processor glowing with laser light'
    });
    assertStatus(res, 200);
    assert.equal(res.data.status, 'success');
    assert.ok(res.data.url);
  });

  it('F14-TC-03: audio ducking coefficient returns audio_ducking === 0.4', async () => {
    const res = await client.post('/api/v1/render/b-roll', {
      prompt: 'Abstract technology backdrop',
      ducking_level: 0.4
    });
    assertStatus(res, 200);
    assert.equal(res.data.audio_ducking, 0.4);
  });

  it('F14-TC-04: B-roll video path format starts with /media/broll/', async () => {
    const res = await client.post('/api/v1/render/b-roll', {
      prompt: 'Data stream flowing through fiber optic'
    });
    assertStatus(res, 200);
    assert.ok(res.data.video_path.startsWith('/media/broll/'));
  });

  it('F14-TC-05: media streaming URL format starts with /api/v1/media/', async () => {
    const res = await client.post('/api/v1/render/b-roll', {
      prompt: 'High-speed cloud server rack'
    });
    assertStatus(res, 200);
    assert.ok(res.data.url.startsWith('/api/v1/media/'));
  });
});
