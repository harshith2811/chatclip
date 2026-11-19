/**
 * e2e/tier1_features/f30_signed_hmac_webhooks.test.js
 * Feature F30: Signed HMAC Webhooks Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { DEFAULT_WEBHOOK_SECRET, createValidWebhookPayload } from '../harness/fixtures.js';
import { assertStatus, assertSignedHMAC } from '../harness/assertions.js';

describe('Feature F30: Signed HMAC Webhooks', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('30.1: accepts valid HMAC-SHA256 signed webhook returning processed: true', async () => {
    const payload = createValidWebhookPayload('evt_f30_001');
    const res = await client.sendSignedOmniPostWebhook(payload, { secret: DEFAULT_WEBHOOK_SECRET });
    assertStatus(res, 200);
    assert.equal(res.data.processed, true);
    assert.equal(res.data.event_id, 'evt_f30_001');
  });

  it('30.2: validates HMAC-SHA256 signature using timing-safe assertSignedHMAC', () => {
    const payload = { event_id: 'evt_sig_test', status: 'PUBLISHED' };
    const payloadStr = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', DEFAULT_WEBHOOK_SECRET).update(payloadStr).digest('hex');
    assertSignedHMAC(`sha256=${sig}`, payload, DEFAULT_WEBHOOK_SECRET);
  });

  it('30.3: synchronizes status on POST_PUBLISHED webhook event', async () => {
    const payload = createValidWebhookPayload('evt_f30_published', { event_type: 'POST_PUBLISHED', status: 'PUBLISHED' });
    const res = await client.sendSignedOmniPostWebhook(payload, { secret: DEFAULT_WEBHOOK_SECRET });
    assertStatus(res, 200);
    assert.equal(res.data.success, true);
  });

  it('30.4: synchronizes status on POST_SCHEDULED webhook event', async () => {
    const payload = createValidWebhookPayload('evt_f30_scheduled', { event_type: 'POST_SCHEDULED', status: 'SCHEDULED' });
    const res = await client.sendSignedOmniPostWebhook(payload, { secret: DEFAULT_WEBHOOK_SECRET });
    assertStatus(res, 200);
    assert.equal(res.data.processed, true);
  });

  it('30.5: suppresses replay attacks skipping duplicate event_id delivery', async () => {
    const payload = createValidWebhookPayload('evt_f30_replay_test');
    const res1 = await client.sendSignedOmniPostWebhook(payload, { secret: DEFAULT_WEBHOOK_SECRET });
    assertStatus(res1, 200);
    assert.equal(res1.data.processed, true);

    const res2 = await client.sendSignedOmniPostWebhook(payload, { secret: DEFAULT_WEBHOOK_SECRET });
    assertStatus(res2, 200);
    assert.ok(res2.data.message.includes('safely skipped'));
  });
});
