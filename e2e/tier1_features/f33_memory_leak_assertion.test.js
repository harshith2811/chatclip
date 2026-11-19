/**
 * e2e/tier1_features/f33_memory_leak_assertion.test.js
 * Feature F33: Memory Leak Assertion Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F33: Memory Leak Assertion', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('TC_F33_01: queries memory profiler metrics schema', async () => {
    const res = await client.get('/api/v1/system/memory-profiler');
    assertStatus(res, 200);
    const data = res.data;
    assert.equal(typeof data.leak_detected, 'boolean');
    assert.equal(typeof data.rss_growth_pct, 'number');
    assert.equal(typeof data.cycles_tested, 'number');
    assert.equal(typeof data.certified, 'boolean');
  });

  it('TC_F33_02: verifies RSS growth is strictly below 5% across 50 cycles', async () => {
    const res = await client.get('/api/v1/system/memory-profiler');
    assertStatus(res, 200);
    assert.ok(res.data.rss_growth_pct < 5.0, `RSS growth was ${res.data.rss_growth_pct}%, must be < 5.0%`);
  });

  it('TC_F33_03: asserts zero leak detected flag and valid certification', async () => {
    const res = await client.get('/api/v1/system/memory-profiler');
    assertStatus(res, 200);
    assert.equal(res.data.leak_detected, false);
    assert.equal(res.data.certified, true);
  });

  it('TC_F33_04: verifies evaluation cycle window meets 50 cycles standard', async () => {
    const res = await client.get('/api/v1/system/memory-profiler');
    assertStatus(res, 200);
    assert.ok(res.data.cycles_tested >= 50, 'Cycles tested must be at least 50');
  });

  it('TC_F33_05: cross-validates profiler metrics with governor HUD telemetry', async () => {
    const [profRes, hudRes] = await Promise.all([
      client.get('/api/v1/system/memory-profiler'),
      client.getGovernorStatus()
    ]);
    assertStatus(profRes, 200);
    assertStatus(hudRes, 200);
    assert.ok(profRes.data.rss_growth_pct < 5.0);
    assert.equal(hudRes.data.zero_memory_leak_certified, true);
  });
});
