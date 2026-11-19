/**
 * e2e/tier1_features/f28_multi_platform_drivers.test.js
 * Feature F28: Multi-Platform Drivers Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F28: Multi-Platform Drivers', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('28.1: queries platform channels registry returning 8 supported social platforms', async () => {
    const res = await client.getOmniChannels();
    assertStatus(res, 200);
    assert.ok(Array.isArray(res.data.channels));
    assert.equal(res.data.channels.length, 8);
  });

  it('28.2: verifies core short-form vertical video drivers are active', async () => {
    const res = await client.getOmniChannels();
    assertStatus(res, 200);
    const platforms = res.data.channels.map(c => c.platform);
    assert.ok(platforms.includes('youtube_shorts'));
    assert.ok(platforms.includes('instagram_reels'));
    assert.ok(platforms.includes('facebook_reels'));
    assert.ok(platforms.includes('tiktok'));
  });

  it('28.3: verifies secondary social platform drivers are present', async () => {
    const res = await client.getOmniChannels();
    assertStatus(res, 200);
    const platforms = res.data.channels.map(c => c.platform);
    assert.ok(platforms.includes('x'));
    assert.ok(platforms.includes('linkedin'));
    assert.ok(platforms.includes('threads'));
    assert.ok(platforms.includes('pinterest'));
  });

  it('28.4: verifies OmniPost engine preflight returns GREEN armed status', async () => {
    const res = await client.getOmniPreflight();
    assertStatus(res, 200);
    assert.equal(res.data.signal, 'GREEN');
    assert.equal(res.data.armed, true);
    assert.equal(res.data.channels.active, 8);
  });

  it('28.5: confirms platform drivers report enabled and connected states', async () => {
    const res = await client.getOmniChannels();
    assertStatus(res, 200);
    for (const ch of res.data.channels) {
      assert.equal(ch.enabled, true);
      assert.equal(ch.connected, true);
    }
  });
});
