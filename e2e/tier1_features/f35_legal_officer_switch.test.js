/**
 * e2e/tier1_features/f35_legal_officer_switch.test.js
 * Feature F35: Legal Officer Switch Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F35: Legal Officer Switch', () => {
  let serverInfo = null;
  let adminClient = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    adminClient = new E2ETestClient({
      baseUrl: serverInfo.baseUrl,
      userRole: 'admin',
      userId: 'user_admin_a',
      workspaceId: 'workspace-team-a'
    });
  });

  after(async () => {
    await stopTestServer();
  });

  it('TC_F35_01: queries current legal officer mode and status', async () => {
    const res = await adminClient.getLegalOfficer();
    assertStatus(res, 200);
    assert.equal(typeof res.data.enabled, 'boolean');
    assert.ok(['STRICT_COMPLIANCE', 'UNRESTRICTED_BYPASS'].includes(res.data.mode));
  });

  it('TC_F35_02: toggles legal officer to unrestricted bypass mode', async () => {
    const res = await adminClient.setLegalOfficer(false);
    assertStatus(res, 200);
    assert.equal(res.data.enabled, false);
    assert.equal(res.data.mode, 'UNRESTRICTED_BYPASS');
  });

  it('TC_F35_03: restores legal officer to strict compliance mode', async () => {
    const res = await adminClient.setLegalOfficer(true);
    assertStatus(res, 200);
    assert.equal(res.data.enabled, true);
    assert.equal(res.data.mode, 'STRICT_COMPLIANCE');
  });

  it('TC_F35_04: verifies toggle state persists across sequential GET requests', async () => {
    await adminClient.setLegalOfficer(false);
    const getRes = await adminClient.getLegalOfficer();
    assertStatus(getRes, 200);
    assert.equal(getRes.data.enabled, false);
    assert.equal(getRes.data.mode, 'UNRESTRICTED_BYPASS');

    // Reset back
    await adminClient.setLegalOfficer(true);
  });

  it('TC_F35_05: synchronizes state with governor HUD telemetry', async () => {
    await adminClient.setLegalOfficer(true);
    const hudRes = await adminClient.getGovernorStatus();
    assertStatus(hudRes, 200);
    assert.equal(hudRes.data.legal_officer_enabled, true);
  });
});
