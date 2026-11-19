/**
 * e2e/tier1_features/f24_caption_regeneration.test.js
 * Feature F24: AI Caption Regeneration Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F24: AI Caption Regeneration', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('24.1: triggers caption regeneration on valid clip returning success status', async () => {
    const res = await client.regenerateCaption('clip-default-01');
    assertStatus(res, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.clip_id, 'clip-default-01');
  });

  it('24.2: verifies regenerated package contains YouTube Shorts title & description', async () => {
    const res = await client.regenerateCaption('clip-default-01');
    assertStatus(res, 200);
    const yt = res.data.caption_package.youtube_shorts;
    assert.ok(yt && yt.length > 0);
    assert.ok(yt.includes('#'));
  });

  it('24.3: verifies regenerated package contains Instagram Reels caption hook', async () => {
    const res = await client.regenerateCaption('clip-default-01');
    assertStatus(res, 200);
    const ig = res.data.caption_package.instagram_reels;
    assert.ok(ig && ig.length > 0);
  });

  it('24.4: verifies regenerated package contains TikTok viral caption', async () => {
    const res = await client.regenerateCaption('clip-default-01');
    assertStatus(res, 200);
    const tt = res.data.caption_package.tiktok;
    assert.ok(tt && tt.length > 0);
  });

  it('24.5: confirms regenerated caption package reflects in clip metadata', async () => {
    const res = await client.regenerateCaption('clip-default-01');
    assertStatus(res, 200);
    const clipRes = await client.getClip('clip-default-01');
    assertStatus(clipRes, 200);
    assert.ok(clipRes.data.caption_package);
  });
});
