/**
 * e2e/tier1_features/f01_metadata_resolution.test.js
 * Feature F01: Metadata Resolution Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { CANONICAL_VIDEOS } from '../harness/fixtures.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F01: Metadata Resolution', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F01-TC-01: canonical 11-character video ID lookup resolves metadata with 200 OK', async () => {
    const res = await client.getMetadata(CANONICAL_VIDEOS.SAMPLE_1.id);
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.video_id, CANONICAL_VIDEOS.SAMPLE_1.id);
    assert.equal(res.data.title, CANONICAL_VIDEOS.SAMPLE_1.title);
    assert.equal(res.data.duration, CANONICAL_VIDEOS.SAMPLE_1.duration);
    assert.equal(typeof res.data.channel_title, 'string');
  });

  it('F01-TC-02: standard full YouTube watch URL extracts video ID and resolves metadata', async () => {
    const watchUrl = `https://www.youtube.com/watch?v=${CANONICAL_VIDEOS.SAMPLE_1.id}`;
    const res = await client.getMetadata(watchUrl);
    assertStatus(res, 200);
    assert.equal(res.data.video_id, CANONICAL_VIDEOS.SAMPLE_1.id);
    assert.equal(res.data.title, CANONICAL_VIDEOS.SAMPLE_1.title);
  });

  it('F01-TC-03: secondary canonical video ID resolves distinct title and duration (>200s)', async () => {
    const res = await client.getMetadata(CANONICAL_VIDEOS.SAMPLE_2.id);
    assertStatus(res, 200);
    assert.equal(res.data.video_id, CANONICAL_VIDEOS.SAMPLE_2.id);
    assert.equal(res.data.title, CANONICAL_VIDEOS.SAMPLE_2.title);
    assert.ok(res.data.duration > 200);
  });

  it('F01-TC-04: comprehensive schema validation confirms view_count, like_count, and tags array', async () => {
    const res = await client.getMetadata(CANONICAL_VIDEOS.SAMPLE_1.id);
    assertStatus(res, 200);
    assert.ok(typeof res.data.view_count === 'number' && res.data.view_count >= 0);
    assert.ok(typeof res.data.like_count === 'number' && res.data.like_count >= 0);
    assert.ok(Array.isArray(res.data.tags));
    assert.ok(res.data.thumbnail_url.startsWith('https://'));
  });

  it('F01-TC-05: watch URL with tracking query params & feature=share&t=42s normalizes to 11-char ID', async () => {
    const complexUrl = `https://www.youtube.com/watch?v=${CANONICAL_VIDEOS.SAMPLE_1.id}&feature=share&t=42s`;
    const res = await client.getMetadata(complexUrl);
    assertStatus(res, 200);
    assert.equal(res.data.video_id, CANONICAL_VIDEOS.SAMPLE_1.id);
  });
});
