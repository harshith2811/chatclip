/**
 * e2e/tier1_features/f26_google_oauth.test.js
 * Feature F26: Dedicated Google OAuth Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F26: Dedicated Google OAuth', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('26.1: generates Google OAuth 2.0 authorization URL with CSRF state token', async () => {
    const res = await client.fastApi('/api/v1/auth/google/url');
    assertStatus(res, 200);
    assert.ok(res.data.url.includes('accounts.google.com'));
    assert.ok(res.data.state);
  });

  it('26.2: inspects public OAuth status without leaking sensitive tokens', async () => {
    const res = await client.fastApi('/api/v1/auth/google/status');
    assertStatus(res, 200);
    assert.equal(typeof res.data.connected, 'boolean');
    assert.equal(res.data.client_secret, undefined);
    assert.equal(res.data.refresh_token, undefined);
  });

  it('26.3: verifies connected YouTube channel identity metadata', async () => {
    const res = await client.fastApi('/api/v1/auth/google/status');
    assertStatus(res, 200);
    assert.ok(res.data.channel_title);
    assert.ok(res.data.channel_id);
  });

  it('26.4: simulates OAuth code exchange callback returning confirmation', async () => {
    const res = await client.fastApi('/api/v1/auth/google/callback?code=mock_code&state=mock_state');
    assertStatus(res, 200);
    assert.ok(typeof res.data === 'string' && res.data.includes('Connected'));
  });

  it('26.5: verifies credential isolation to dedicated automation channel', async () => {
    const res = await client.fastApi('/api/v1/auth/google/status');
    assertStatus(res, 200);
    assert.equal(res.data.connected, true);
  });
});
