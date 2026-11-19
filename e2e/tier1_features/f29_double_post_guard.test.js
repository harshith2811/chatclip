/**
 * e2e/tier1_features/f29_double_post_guard.test.js
 * Feature F29: Double-Post Guard Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus, assertDoublePostGuarded } from '../harness/assertions.js';

describe('Feature F29: Double-Post Guard', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('29.1: initial publish submission succeeds and registers idempotency token', async () => {
    const res = await client.publishSubmit({
      clip_id: 'clip-default-01',
      idempotency_key: 'idem-f29-unique-001',
      approved_by_user: true,
      platforms: ['youtube_shorts']
    });
    assertStatus(res, 200);
    assert.equal(res.data.success, true);
  });

  it('29.2: duplicate publish submission with identical idempotency token is intercepted', async () => {
    const dupRes = await client.publishSubmit({
      clip_id: 'clip-default-01',
      idempotency_key: 'idem-f29-unique-001',
      approved_by_user: true,
      platforms: ['youtube_shorts']
    });
    assertStatus(dupRes, 200);
  });

  it('29.3: duplicate submission is locked in OUTCOME_UNKNOWN guard state', async () => {
    const dupRes = await client.publishSubmit({
      clip_id: 'clip-default-01',
      idempotency_key: 'idem-f29-unique-001',
      approved_by_user: true,
      platforms: ['youtube_shorts']
    });
    assert.equal(dupRes.data.status, 'OUTCOME_UNKNOWN');
  });

  it('29.4: asserts double-post response satisfies assertDoublePostGuarded', async () => {
    const dupRes = await client.publishSubmit({
      clip_id: 'clip-default-01',
      idempotency_key: 'idem-f29-unique-001',
      approved_by_user: true,
      platforms: ['youtube_shorts']
    });
    assertDoublePostGuarded(dupRes);
  });

  it('29.5: OmniPost ingest deduplicates repeated submission with DUPLICATE_SKIPPED', async () => {
    const idem = 'idem-f29-omni-dup';
    await client.omniIngest({ title: 'Omni Test', video_url: 'https://cdn.example.com/v.mp4', approved_by_user: true, idempotency_key: idem });
    const dupRes = await client.omniIngest({ title: 'Omni Test Dup', video_url: 'https://cdn.example.com/v.mp4', approved_by_user: true, idempotency_key: idem });
    assertDoublePostGuarded(dupRes);
    assert.equal(dupRes.data.status, 'DUPLICATE_SKIPPED');
  });
});
