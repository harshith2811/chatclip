/**
 * e2e/tier1_features/f08_dead_air_pruning.test.js
 * Feature F08: Dead-Air Pruning Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { CANONICAL_VIDEOS } from '../harness/fixtures.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F08: Dead-Air Pruning', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F08-TC-01: silence pause detection returns pruned_duration > 0 with status 200', async () => {
    const res = await client.post('/api/v1/audio/prune-dead-air', {
      audio_path: 'data/audio/raw_dialogue.wav',
      threshold_db: -40,
      min_silence_seconds: 0.8
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.success, true);
    assert.ok(typeof res.data.pruned_duration === 'number' && res.data.pruned_duration > 0);
  });

  it('F08-TC-02: timeline conservation equation: pruned_duration + new_duration === original_duration (30.0s)', async () => {
    const res = await client.post('/api/v1/audio/prune-dead-air', {
      audio_path: 'data/audio/raw_dialogue.wav'
    });
    assertStatus(res, 200);
    const sum = res.data.pruned_duration + res.data.new_duration;
    assert.ok(Math.abs(sum - 30.0) < 0.001, `Duration sum ${sum} must equal 30.0s`);
  });

  it('F08-TC-03: removed intervals integrity: each interval has start < end and positive duration', async () => {
    const res = await client.post('/api/v1/audio/prune-dead-air', {
      audio_path: 'data/audio/raw_dialogue.wav'
    });
    assertStatus(res, 200);
    assert.ok(Array.isArray(res.data.intervals_removed));
    assert.ok(res.data.intervals_removed.length > 0);
    for (const iv of res.data.intervals_removed) {
      assert.ok(iv.start < iv.end, `Interval start ${iv.start} must be < end ${iv.end}`);
      assert.ok(iv.end - iv.start > 0);
    }
  });

  it('F08-TC-04: disjoint interval ordering: interval 1 ends before interval 2 begins', async () => {
    const res = await client.post('/api/v1/audio/prune-dead-air', {
      audio_path: 'data/audio/raw_dialogue.wav'
    });
    assertStatus(res, 200);
    const intervals = res.data.intervals_removed;
    for (let i = 1; i < intervals.length; i++) {
      assert.ok(intervals[i - 1].end <= intervals[i].start, 'Intervals must be disjoint and sorted');
    }
  });

  it('F08-TC-05: render pipeline integration: POST /api/v1/render with enable_polish: true queues task', async () => {
    const res = await client.renderVideo(CANONICAL_VIDEOS.SAMPLE_1.id, {
      enable_polish: true
    });
    assertStatus(res, 200);
    assert.equal(res.data.status, 'QUEUED');
    assert.ok(res.data.task_id);
  });
});
