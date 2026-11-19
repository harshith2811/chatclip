/**
 * e2e/tier1_features/f07_hook_arc_detection.test.js
 * Feature F07: Hook & Arc Detection Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { CANONICAL_VIDEOS } from '../harness/fixtures.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F07: Hook & Arc Detection', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F07-TC-01: high virality opening hook scoring: returns hook_score >= 9.0', async () => {
    const res = await client.post('/api/v1/detection/arc', {
      transcript: [
        { start: 0.0, end: 5.0, text: 'This secret changes everything we know about neural processing.' }
      ],
      video_duration: 60.0
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.success, true);
    assert.ok(typeof res.data.hook_score === 'number');
    assert.ok(res.data.hook_score >= 9.0 && res.data.hook_score <= 10.0);
  });

  it('F07-TC-02: narrative arc categorization: returns valid narrative type (REVELATION_BUILD)', async () => {
    const res = await client.post('/api/v1/detection/arc', {
      video_duration: 60.0
    });
    assertStatus(res, 200);
    assert.equal(res.data.arc_type, 'REVELATION_BUILD');
  });

  it('F07-TC-03: key moments extraction: returns non-empty array with timestamps and labels', async () => {
    const res = await client.post('/api/v1/detection/arc', {
      video_duration: 60.0
    });
    assertStatus(res, 200);
    assert.ok(Array.isArray(res.data.key_moments));
    assert.ok(res.data.key_moments.length >= 2);
    for (const moment of res.data.key_moments) {
      assert.ok(typeof moment.time === 'number');
      assert.ok(typeof moment.label === 'string' && moment.label.length > 0);
    }
  });

  it('F07-TC-04: temporal moment ordering: hook moment occurs before climax moment', async () => {
    const res = await client.post('/api/v1/detection/arc', {
      video_duration: 60.0
    });
    assertStatus(res, 200);
    const moments = res.data.key_moments;
    assert.ok(moments[0].time < moments[1].time, 'Key moments must be chronologically ordered');
  });

  it('F07-TC-05: preview yield correlation: POST /api/v1/preview surfaces candidate with strong hook score', async () => {
    const previewRes = await client.getPreview(CANONICAL_VIDEOS.SAMPLE_1.id);
    assertStatus(previewRes, 200);
    assert.ok(previewRes.data.candidates.length > 0);
    const topCandidate = previewRes.data.candidates[0];
    assert.ok(topCandidate.breakdown.hook_score >= 8.0);
  });
});
