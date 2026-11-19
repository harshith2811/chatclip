/**
 * e2e/tier1_features/f10_kinematic_trajectory.test.js
 * Feature F10: Kinematic Trajectory Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F10: Kinematic Trajectory', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F10-TC-01: viewport trajectory generation returns >= 3 smoothed keyframe points', async () => {
    const res = await client.post('/api/v1/framing/solve-trajectory', {
      target_aspect_ratio: '9:16',
      smoothing_window: 5
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.success, true);
    assert.ok(Array.isArray(res.data.viewport_trajectory));
    assert.ok(res.data.viewport_trajectory.length >= 3);
  });

  it('F10-TC-02: bounded camera velocity: |velocity| <= 0.05 ensures smooth panning without jitter', async () => {
    const res = await client.post('/api/v1/framing/solve-trajectory', {
      target_aspect_ratio: '9:16'
    });
    assertStatus(res, 200);
    for (const point of res.data.viewport_trajectory) {
      assert.ok(typeof point.velocity === 'number');
      assert.ok(Math.abs(point.velocity) <= 0.05, `Velocity ${point.velocity} must be within [-0.05, 0.05]`);
    }
  });

  it('F10-TC-03: viewport bounds clamping: center_x values remain clamped within [0.0, 1.0]', async () => {
    const res = await client.post('/api/v1/framing/solve-trajectory', {
      target_aspect_ratio: '9:16'
    });
    assertStatus(res, 200);
    for (const point of res.data.viewport_trajectory) {
      assert.ok(typeof point.center_x === 'number');
      assert.ok(point.center_x >= 0.0 && point.center_x <= 1.0, `center_x ${point.center_x} must be in [0.0, 1.0]`);
    }
  });

  it('F10-TC-04: monotonic temporal sequence: keyframes strictly advance in time t', async () => {
    const res = await client.post('/api/v1/framing/solve-trajectory', {
      target_aspect_ratio: '9:16'
    });
    assertStatus(res, 200);
    const traj = res.data.viewport_trajectory;
    for (let i = 1; i < traj.length; i++) {
      assert.ok(traj[i].t > traj[i - 1].t, 'Keyframes must strictly advance in time t');
    }
  });

  it('F10-TC-05: spatial continuity: frame-to-frame delta |center_x[i+1] - center_x[i]| <= 0.05', async () => {
    const res = await client.post('/api/v1/framing/solve-trajectory', {
      target_aspect_ratio: '9:16'
    });
    assertStatus(res, 200);
    const traj = res.data.viewport_trajectory;
    for (let i = 1; i < traj.length; i++) {
      const delta = Math.abs(traj[i].center_x - traj[i - 1].center_x);
      assert.ok(delta <= 0.05, `Spatial delta ${delta} exceeds smooth panning limit of 0.05`);
    }
  });
});
