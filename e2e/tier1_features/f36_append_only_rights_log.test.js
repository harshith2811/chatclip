/**
 * e2e/tier1_features/f36_append_only_rights_log.test.js
 * Feature F36: Append-Only Rights Log Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { CANONICAL_VIDEOS } from '../harness/fixtures.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F36: Append-Only Rights Log', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('TC_F36_01: registers evidence-backed rights manifest', async () => {
    const res = await client.registerRights({
      video_id: CANONICAL_VIDEOS.SAMPLE_1.id,
      basis: 'OWNED',
      owner: 'Verified Studio Fixture Owner'
    });
    assertStatus(res, 200);
    assert.equal(res.data.success, true);
    assert.ok(res.data.rights_id);
    assert.equal(res.data.video_id, CANONICAL_VIDEOS.SAMPLE_1.id);
  });

  it('TC_F36_02: asserts registration event appears in audit log', async () => {
    const res = await client.getRightsAudit(CANONICAL_VIDEOS.SAMPLE_1.id);
    assertStatus(res, 200);
    assert.ok(Array.isArray(res.data.entries));
    const entry = res.data.entries.find(e => e.video_id === CANONICAL_VIDEOS.SAMPLE_1.id && e.action === 'REGISTER');
    assert.ok(entry, 'Registration entry must be recorded in audit log');
  });

  it('TC_F36_03: revokes rights and confirms new revocation entry is appended', async () => {
    const revokeRes = await client.revokeRights({
      video_id: CANONICAL_VIDEOS.SAMPLE_1.id,
      reason: 'Contractual term expiration'
    });
    assertStatus(revokeRes, 200);
    assert.equal(revokeRes.data.success, true);

    const auditRes = await client.getRightsAudit(CANONICAL_VIDEOS.SAMPLE_1.id);
    assertStatus(auditRes, 200);
    const revokeEntry = auditRes.data.entries.find(e => e.video_id === CANONICAL_VIDEOS.SAMPLE_1.id && e.action === 'REVOKE');
    assert.ok(revokeEntry, 'Revocation event must be appended');
  });

  it('TC_F36_04: verifies append-only immutability rejects mutation attempts with 403', async () => {
    const putRes = await client.put('/api/v1/rights/audit', { owner: 'Illegal Mutation' });
    assertStatus(putRes, 403);
    assert.ok(putRes.data.detail.includes('append-only'));

    const delRes = await client.delete('/api/v1/rights/audit');
    assertStatus(delRes, 403);
    assert.ok(delRes.data.detail.includes('append-only'));
  });

  it('TC_F36_05: queries audit log with video filtering and limit parameters', async () => {
    const res = await client.getRightsAudit(CANONICAL_VIDEOS.SAMPLE_1.id, 10);
    assertStatus(res, 200);
    assert.ok(res.data.count >= 1);
    for (const e of res.data.entries) {
      assert.equal(e.video_id, CANONICAL_VIDEOS.SAMPLE_1.id);
    }
  });
});
