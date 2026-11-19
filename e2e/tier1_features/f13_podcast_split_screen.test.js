/**
 * e2e/tier1_features/f13_podcast_split_screen.test.js
 * Feature F13: Podcast Split-Screen Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { CANONICAL_VIDEOS } from '../harness/fixtures.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F13: Podcast Split-Screen', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F13-TC-01: stacked 9:8 dimensions: top and bottom crop regions are both exactly 1080w x 960h', async () => {
    const res = await client.post('/api/v1/podcast/layout', {
      speaker_a_box: [100, 200, 400, 400],
      speaker_b_box: [700, 200, 400, 400]
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.success, true);
    assert.equal(res.data.top_crop.w, 1080);
    assert.equal(res.data.top_crop.h, 960);
    assert.equal(res.data.bottom_crop.w, 1080);
    assert.equal(res.data.bottom_crop.h, 960);
  });

  it('F13-TC-02: vertical divider midpoint: divider_y === 960 (center of 1920h canvas)', async () => {
    const res = await client.post('/api/v1/podcast/layout', {});
    assertStatus(res, 200);
    assert.equal(res.data.divider_y, 960);
  });

  it('F13-TC-03: divider thickness: divider_thickness === 4 px', async () => {
    const res = await client.post('/api/v1/podcast/layout', {
      divider_thickness: 4
    });
    assertStatus(res, 200);
    assert.equal(res.data.divider_thickness, 4);
  });

  it('F13-TC-04: canvas continuity: top_crop.y + top_crop.h === bottom_crop.y and total height is 1920', async () => {
    const res = await client.post('/api/v1/podcast/layout', {});
    assertStatus(res, 200);
    assert.equal(res.data.top_crop.y + res.data.top_crop.h, res.data.bottom_crop.y);
    assert.equal(res.data.top_crop.h + res.data.bottom_crop.h, 1920);
  });

  it('F13-TC-05: render integration: POST /api/v1/render with layout: "split_screen" queues task', async () => {
    const res = await client.renderVideo(CANONICAL_VIDEOS.SAMPLE_1.id, {
      layout: 'split_screen'
    });
    assertStatus(res, 200);
    assert.equal(res.data.status, 'QUEUED');
    assert.ok(res.data.task_id);
  });
});
