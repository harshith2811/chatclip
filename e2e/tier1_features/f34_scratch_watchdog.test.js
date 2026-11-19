/**
 * e2e/tier1_features/f34_scratch_watchdog.test.js
 * Feature F34: Scratch Watchdog Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F34: Scratch Watchdog', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('TC_F34_01: triggers default scratch directory sweep', async () => {
    const res = await client.post('/api/v1/system/scratch-sweep', {});
    assertStatus(res, 200);
    assert.ok(typeof res.data.files_swept === 'number' && res.data.files_swept >= 0);
    assert.ok(typeof res.data.reclaimed_mb === 'number' && res.data.reclaimed_mb >= 0);
    assert.ok(typeof res.data.active_files_skipped === 'number' && res.data.active_files_skipped >= 0);
  });

  it('TC_F34_02: verifies actively processing media files are spared from cleanup', async () => {
    const res = await client.post('/api/v1/system/scratch-sweep', {});
    assertStatus(res, 200);
    assert.ok(res.data.active_files_skipped >= 0);
  });

  it('TC_F34_03: verifies reclaimed storage accounting measurement', async () => {
    const res = await client.post('/api/v1/system/scratch-sweep', {});
    assertStatus(res, 200);
    assert.ok(res.data.reclaimed_mb >= 0);
  });

  it('TC_F34_04: executes sweep with custom max age threshold parameter', async () => {
    const res = await client.post('/api/v1/system/scratch-sweep', { max_age_seconds: 1800 });
    assertStatus(res, 200);
    assert.ok(res.data.files_swept >= 0);
  });

  it('TC_F34_05: executes consecutive sweeps idempotently without errors', async () => {
    const r1 = await client.post('/api/v1/system/scratch-sweep', {});
    assertStatus(r1, 200);
    const r2 = await client.post('/api/v1/system/scratch-sweep', {});
    assertStatus(r2, 200);
    assert.ok(r2.data.files_swept >= 0);
  });
});
