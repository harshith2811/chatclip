/**
 * e2e/tier1_features/f27_human_approval.test.js
 * Feature F27: Human Approval Gate Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F27: Human Approval Gate', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('27.1: accepts publish submission when approved_by_user is true', async () => {
    const res = await client.publishSubmit({
      clip_id: 'clip-default-01',
      idempotency_key: 'idem-f27-01',
      approved_by_user: true,
      platforms: ['youtube_shorts']
    });
    assertStatus(res, 200);
    assert.equal(res.data.success, true);
    assert.ok(res.data.receipt_id);
  });

  it('27.2: authorizes multi-platform submission with human approval', async () => {
    const res = await client.publishSubmit({
      clip_id: 'clip-default-01',
      idempotency_key: 'idem-f27-02',
      approved_by_user: true,
      platforms: ['youtube_shorts', 'instagram_reels']
    });
    assertStatus(res, 200);
  });

  it('27.3: authorizes batch clip publishing with explicit approval', async () => {
    const res = await client.publishSubmit({
      clip_ids: ['clip-default-01'],
      idempotency_key: 'idem-f27-03',
      approved_by_user: true,
      platforms: ['youtube_shorts']
    });
    assertStatus(res, 200);
  });

  it('27.4: publisher role user executes human-approved publishing dispatch', async () => {
    const pubClient = client.asUser('user_publisher_a', 'publisher');
    const res = await pubClient.publishSubmit({
      clip_id: 'clip-default-01',
      idempotency_key: 'idem-f27-04',
      approved_by_user: true,
      platforms: ['youtube_shorts']
    });
    assertStatus(res, 200);
  });

  it('27.5: verifies returned receipt contains status DISPATCHED', async () => {
    const res = await client.publishSubmit({
      clip_id: 'clip-default-01',
      idempotency_key: 'idem-f27-05',
      approved_by_user: true,
      platforms: ['youtube_shorts']
    });
    assertStatus(res, 200);
    assert.ok(res.data.receipt);
    assert.equal(res.data.receipt.status, 'DISPATCHED');
  });
});
