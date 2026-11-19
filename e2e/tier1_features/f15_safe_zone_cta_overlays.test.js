/**
 * e2e/tier1_features/f15_safe_zone_cta_overlays.test.js
 * Feature F15: Safe-Zone CTA Overlays Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F15: Safe-Zone CTA Overlays', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F15-TC-01: optimal safe-zone Y (1500) remains untouched (clamped_y === 1500)', async () => {
    const res = await client.post('/api/v1/render/cta', {
      text: 'Subscribe for daily AI breakthroughs',
      position_y: 1500
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.success, true);
    assert.equal(res.data.clamped_y, 1500);
    assert.equal(res.data.safe_zone_verified, true);
  });

  it('F15-TC-02: below-safe-zone upward clamping: position_y: 1800 clamped to 1560', async () => {
    const res = await client.post('/api/v1/render/cta', {
      text: 'Follow @channel',
      position_y: 1800
    });
    assertStatus(res, 200);
    assert.equal(res.data.clamped_y, 1560);
    assert.equal(res.data.safe_zone_verified, true);
  });

  it('F15-TC-03: above-safe-zone downward clamping: position_y: 1200 clamped to 1440', async () => {
    const res = await client.post('/api/v1/render/cta', {
      text: 'Like and share',
      position_y: 1200
    });
    assertStatus(res, 200);
    assert.equal(res.data.clamped_y, 1440);
    assert.equal(res.data.safe_zone_verified, true);
  });

  it('F15-TC-04: custom CTA copy preservation: input text is accurately reflected in cta_text', async () => {
    const customText = 'Exclusive early access link in bio!';
    const res = await client.post('/api/v1/render/cta', {
      text: customText,
      position_y: 1520
    });
    assertStatus(res, 200);
    assert.equal(res.data.cta_text, customText);
  });

  it('F15-TC-05: safe zone invariant: for any input Y, clamped_y >= 1440 && clamped_y <= 1560', async () => {
    const testPositions = [0, 500, 1440, 1500, 1560, 1920, 2500];
    for (const pos of testPositions) {
      const res = await client.post('/api/v1/render/cta', {
        text: 'Invariant check',
        position_y: pos
      });
      assertStatus(res, 200);
      assert.ok(res.data.clamped_y >= 1440 && res.data.clamped_y <= 1560, `Position ${pos} resulted in out-of-bounds ${res.data.clamped_y}`);
    }
  });
});
