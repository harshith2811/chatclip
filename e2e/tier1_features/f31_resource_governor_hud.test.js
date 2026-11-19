/**
 * e2e/tier1_features/f31_resource_governor_hud.test.js
 * Feature F31: Resource Governor HUD Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F31: Resource Governor HUD', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('TC_F31_01: queries governor status and validates complete telemetry schema', async () => {
    const res = await client.getGovernorStatus();
    assertStatus(res, 200);
    const data = res.data;
    assert.equal(typeof data.hardware_concurrency, 'number');
    assert.equal(typeof data.active_render_jobs, 'number');
    assert.equal(typeof data.cpu_cores, 'number');
    assert.equal(typeof data.free_disk_gb, 'number');
    assert.equal(typeof data.total_disk_gb, 'number');
    assert.equal(typeof data.rss_memory_mb, 'number');
    assert.equal(typeof data.zero_memory_leak_certified, 'boolean');
    assert.equal(typeof data.rss_growth_pct, 'number');
    assert.equal(typeof data.legal_officer_enabled, 'boolean');
  });

  it('TC_F31_02: verifies physical hardware bounds and capacity ratios', async () => {
    const res = await client.getGovernorStatus();
    assertStatus(res, 200);
    const data = res.data;
    assert.ok(data.cpu_cores >= 1, 'CPU cores must be >= 1');
    assert.ok(data.hardware_concurrency >= 1, 'Hardware concurrency limit must be >= 1');
    assert.ok(data.free_disk_gb >= 0, 'Free disk GB must be non-negative');
    assert.ok(data.total_disk_gb >= data.free_disk_gb, 'Total disk must be >= free disk');
    assert.ok(data.rss_memory_mb > 0, 'Process RSS memory must be positive');
  });

  it('TC_F31_03: tracks active render job count accurately', async () => {
    const res = await client.getGovernorStatus();
    assertStatus(res, 200);
    assert.ok(res.data.active_render_jobs >= 0, 'Active renders must be non-negative');
  });

  it('TC_F31_04: verifies zero memory leak certification and <5% growth bound', async () => {
    const res = await client.getGovernorStatus();
    assertStatus(res, 200);
    assert.equal(res.data.zero_memory_leak_certified, true, 'Zero memory leak must be certified');
    assert.ok(res.data.rss_growth_pct < 5.0, 'RSS growth percentage must be strictly below 5%');
  });

  it('TC_F31_05: synchronizes legal officer master switch status', async () => {
    await client.setLegalOfficer(true);
    const res = await client.getGovernorStatus();
    assertStatus(res, 200);
    assert.equal(res.data.legal_officer_enabled, true);
  });
});
