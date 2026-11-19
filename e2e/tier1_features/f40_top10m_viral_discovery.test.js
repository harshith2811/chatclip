/**
 * e2e/tier1_features/f40_top10m_viral_discovery.test.js
 * Feature F40: Top 10M Viral Discovery Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F40: Top 10M Viral Discovery', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('TC_F40_01: queries default top 10M trending video list', async () => {
    const res = await client.getTop10mTrending();
    assertStatus(res, 200);
    assert.ok(Array.isArray(res.data));
    assert.ok(res.data.length > 0);
    const first = res.data[0];
    assert.ok(first.video_id);
    assert.ok(first.title);
    assert.ok(first.view_count > 0);
  });

  it('TC_F40_02: respects custom limit parameter', async () => {
    const res = await client.getTop10mTrending(5);
    assertStatus(res, 200);
    assert.equal(res.data.length, 5);
  });

  it('TC_F40_03: applies filter mode parameter cleanly', async () => {
    const res = await client.getTop10mTrending(10, 'tech');
    assertStatus(res, 200);
    assert.ok(Array.isArray(res.data));
    assert.equal(res.data.length, 10);
  });

  it('TC_F40_04: verifies virality indicators and stream readiness', async () => {
    const res = await client.getTop10mTrending(3);
    assertStatus(res, 200);
    for (const item of res.data) {
      assert.ok(item.view_count >= 1000000, 'Viral videos must exceed 1M views');
      assert.ok(item.duration > 0, 'Duration must be positive');
      assert.equal(item.stream_ready, true, 'Viral video must be stream-ready');
    }
  });

  it('TC_F40_05: integrates discovery output with downstream highlight preview pipeline', async () => {
    const trendingRes = await client.getTop10mTrending(1);
    assertStatus(trendingRes, 200);
    const viralVideoId = trendingRes.data[0].video_id;

    const previewRes = await client.getPreview(viralVideoId);
    assertStatus(previewRes, 200);
    assert.ok(Array.isArray(previewRes.data.candidates));
    assert.ok(previewRes.data.candidates.length > 0);
  });
});
