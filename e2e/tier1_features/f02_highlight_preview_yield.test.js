/**
 * e2e/tier1_features/f02_highlight_preview_yield.test.js
 * Feature F02: Highlight Preview & Yield Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { CANONICAL_VIDEOS } from '../harness/fixtures.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F02: Highlight Preview & Yield', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F02-TC-01: standard preview request yields non-empty candidates array with positive duration', async () => {
    const res = await client.getPreview(CANONICAL_VIDEOS.SAMPLE_1.id);
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.video_id, CANONICAL_VIDEOS.SAMPLE_1.id);
    assert.ok(Array.isArray(res.data.candidates));
    assert.ok(res.data.candidates.length > 0);
    const first = res.data.candidates[0];
    assert.ok(first.duration_seconds > 0);
    assert.ok(first.start_seconds >= 0);
    assert.ok(first.end_seconds > first.start_seconds);
  });

  it('F02-TC-02: candidate score breakdown verification confirms hook, moment, and confidence bounds', async () => {
    const res = await client.getPreview(CANONICAL_VIDEOS.SAMPLE_1.id);
    assertStatus(res, 200);
    const candidate = res.data.candidates[0];
    assert.ok(typeof candidate.score === 'number' && candidate.score > 0);
    assert.ok(candidate.breakdown, 'breakdown object must be present');
    assert.ok(candidate.breakdown.hook_score >= 8.0, 'hook_score must be >= 8.0');
    assert.ok(candidate.breakdown.moment_score >= 8.0, 'moment_score must be >= 8.0');
    assert.ok(candidate.breakdown.confidence >= 0.9, 'confidence must be >= 0.9');
  });

  it('F02-TC-03: retention curve evaluation verifies >=20 points, monotonic timestamps, and [0,1] scores', async () => {
    const res = await client.getPreview(CANONICAL_VIDEOS.SAMPLE_1.id);
    assertStatus(res, 200);
    assert.ok(Array.isArray(res.data.retention_curve));
    assert.ok(res.data.retention_curve.length >= 20, 'retention curve must have >= 20 data points');
    for (let i = 0; i < res.data.retention_curve.length; i++) {
      const pt = res.data.retention_curve[i];
      assert.ok(typeof pt.timestamp === 'number');
      assert.ok(typeof pt.score === 'number');
      assert.ok(pt.score >= 0.0 && pt.score <= 1.0, `Score ${pt.score} must be within [0.0, 1.0]`);
      if (i > 0) {
        assert.ok(pt.timestamp > res.data.retention_curve[i - 1].timestamp, 'timestamps must be monotonic');
      }
    }
  });

  it('F02-TC-04: solid clips and decision reasons verification', async () => {
    const res = await client.getPreview(CANONICAL_VIDEOS.SAMPLE_1.id);
    assertStatus(res, 200);
    assert.ok(Array.isArray(res.data.solid_clips));
    assert.ok(res.data.solid_clips.length >= 1);
    assert.ok(Array.isArray(res.data.decision_reasons));
    assert.ok(res.data.decision_reasons.length >= 1);
    assert.equal(typeof res.data.decision_reasons[0], 'string');
  });

  it('F02-TC-05: multi-platform caption package availability in candidates', async () => {
    const res = await client.getPreview(CANONICAL_VIDEOS.SAMPLE_1.id);
    assertStatus(res, 200);
    const candidate = res.data.candidates[0];
    assert.ok(candidate.caption_package, 'caption_package must exist');
    assert.ok(typeof candidate.caption_package.youtube_shorts === 'string');
    assert.ok(typeof candidate.caption_package.instagram_reels === 'string');
    assert.ok(typeof candidate.caption_package.tiktok === 'string');
    assert.ok(Array.isArray(candidate.caption_package.tags));
  });
});
