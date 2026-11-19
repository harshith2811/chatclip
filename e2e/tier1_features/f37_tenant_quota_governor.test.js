/**
 * e2e/tier1_features/f37_tenant_quota_governor.test.js
 * Feature F37: Tenant Quota Governor Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { TestFixtures } from '../harness/fixtures.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F37: Tenant Quota Governor', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('TC_F37_01: lists tenant quota profiles with daily limits and concurrency bounds', async () => {
    const res = await client.fastApi('/api/v1/external/ai-video/tenants');
    assertStatus(res, 200);
    assert.equal(res.data.success, true);
    assert.ok(Array.isArray(res.data.tenants));
    const alpha = res.data.tenants.find(t => t.tenant_id === 'tenant_alpha');
    assert.ok(alpha, 'Tenant Alpha must be configured');
    assert.ok(alpha.daily_render_limit > 0);
    assert.ok(alpha.max_concurrent_jobs >= 1);
  });

  it('TC_F37_02: queues external AI video ingest within tenant quota bounds', async () => {
    const tenantClient = client.asTenant('tenant_alpha', 'key_tenant_alpha_secret_2026');
    const payload = TestFixtures.createValidExternalAiPayload();
    const res = await tenantClient.externalAiIngest(payload);
    assertStatus(res, 201);
    assert.equal(res.data.success, true);
    assert.equal(res.data.status, 'QUEUED');
    assert.equal(res.data.tenant_id, 'tenant_alpha');
  });

  it('TC_F37_03: increments tenant daily usage counter after job creation', async () => {
    const resBefore = await client.fastApi('/api/v1/external/ai-video/tenants');
    const beforeCount = resBefore.data.tenants.find(t => t.tenant_id === 'tenant_alpha').renders_used_today;

    const tenantClient = client.asTenant('tenant_alpha', 'key_tenant_alpha_secret_2026');
    await tenantClient.externalAiIngest(TestFixtures.createValidExternalAiPayload());

    const resAfter = await client.fastApi('/api/v1/external/ai-video/tenants');
    const afterCount = resAfter.data.tenants.find(t => t.tenant_id === 'tenant_alpha').renders_used_today;
    assert.equal(afterCount, beforeCount + 1);
  });

  it('TC_F37_04: validates tenant quota partitioning independence', async () => {
    const res = await client.fastApi('/api/v1/external/ai-video/tenants');
    const beta = res.data.tenants.find(t => t.tenant_id === 'tenant_beta');
    assert.equal(beta.renders_used_today, 0, 'Tenant Beta renders used must remain 0 when Alpha ingests');
  });

  it('TC_F37_05: checks external AI job status under tenant credentials', async () => {
    const tenantClient = client.asTenant('tenant_alpha', 'key_tenant_alpha_secret_2026');
    const res = await tenantClient.getExternalAiJobStatus('job-sample-1');
    assertStatus(res, 200);
    assert.equal(res.data.job_id, 'job-sample-1');
  });
});
