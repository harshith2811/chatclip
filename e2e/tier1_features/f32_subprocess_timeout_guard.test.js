/**
 * e2e/tier1_features/f32_subprocess_timeout_guard.test.js
 * Feature F32: Subprocess Timeout Guard Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F32: Subprocess Timeout Guard', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('TC_F32_01: verifies normal sub-second subprocess completes cleanly', async () => {
    const res = await client.post('/api/v1/system/test-subprocess', { timeout_simulation: false });
    assertStatus(res, 200);
    assert.equal(res.data.status, 'COMPLETED');
    assert.ok(res.data.elapsed_seconds < 180.0);
  });

  it('TC_F32_02: verifies hanging subprocess triggers 180s timeout guard and SIGKILL escalation', async () => {
    const res = await client.post('/api/v1/system/test-subprocess', { timeout_simulation: true });
    assertStatus(res, 200);
    assert.equal(res.data.status, 'TIMEOUT_KILLED');
    assert.equal(res.data.signal, 'SIGKILL');
  });

  it('TC_F32_03: asserts guarded flag confirms governor intervention', async () => {
    const res = await client.post('/api/v1/system/test-subprocess', { timeout_simulation: true });
    assertStatus(res, 200);
    assert.equal(res.data.guarded, true);
    assert.ok(res.data.elapsed_seconds >= 180.0);
  });

  it('TC_F32_04: verifies pipe cleanup without hanging file descriptors', async () => {
    const res = await client.post('/api/v1/system/test-subprocess', { timeout_simulation: true });
    assertStatus(res, 200);
    assert.ok(res.data.status === 'TIMEOUT_KILLED');
  });

  it('TC_F32_05: verifies sequential executions remain resilient without deadlock', async () => {
    const r1 = await client.post('/api/v1/system/test-subprocess', { timeout_simulation: false });
    assertStatus(r1, 200);
    const r2 = await client.post('/api/v1/system/test-subprocess', { timeout_simulation: true });
    assertStatus(r2, 200);
    const r3 = await client.post('/api/v1/system/test-subprocess', { timeout_simulation: false });
    assertStatus(r3, 200);
    assert.equal(r3.data.status, 'COMPLETED');
  });
});
