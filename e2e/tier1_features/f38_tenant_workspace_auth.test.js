/**
 * e2e/tier1_features/f38_tenant_workspace_auth.test.js
 * Feature F38: Tenant Workspace Auth Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus, assertMultiUserIsolation } from '../harness/assertions.js';

describe('Feature F38: Tenant Workspace Auth', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('TC_F38_01: allows authorized access to projects within same workspace', async () => {
    const teamAClient = client.asUser('user_editor_a1', 'editor', 'workspace-team-a');
    const res = await teamAClient.getProject('proj-default');
    assertStatus(res, 200);
    assert.equal(res.data.project_id, 'proj-default');
    assert.equal(res.data.workspace_id, 'workspace-team-a');
  });

  it('TC_F38_02: allows authorized tenant to query their own job status', async () => {
    const alphaClient = client.asTenant('tenant_alpha', 'key_tenant_alpha_secret_2026');
    const res = await alphaClient.getExternalAiJobStatus('job-sample-1');
    assertStatus(res, 200);
    assert.equal(res.data.tenant_id, 'tenant_alpha');
  });

  it('TC_F38_03: blocks cross-workspace project access with 403 Forbidden', async () => {
    const teamAClient = client.asUser('user_editor_a1', 'editor', 'workspace-team-a');
    const res = await teamAClient.getProject('proj-team-b');
    assertMultiUserIsolation(res, { expectedAccessDenied: true });
    assert.equal(res.status, 403);
    assert.ok(res.data.detail.includes('CROSS_TENANT_WORKSPACE_FORBIDDEN'));
  });

  it('TC_F38_04: blocks cross-tenant external AI job status queries with 403 Forbidden', async () => {
    const betaClient = client.asTenant('tenant_beta', 'key_tenant_beta_secret_2026');
    const res = await betaClient.getExternalAiJobStatus('job-sample-1');
    assertMultiUserIsolation(res, { expectedAccessDenied: true });
    assert.equal(res.status, 403);
    assert.ok(res.data.detail.includes('Tenant is not authorized to access this job'));
  });

  it('TC_F38_05: creates isolated project under designated workspace', async () => {
    const teamBClient = client.asUser('user_admin_b', 'admin', 'workspace-team-b');
    const res = await teamBClient.post('/api/v1/projects', {
      project_id: 'proj-team-b-new',
      title: 'Workspace B Isolated Project'
    });
    assertStatus(res, 201);
    assert.equal(res.data.workspace_id, 'workspace-team-b');

    // Clean up
    await teamBClient.deleteProject('proj-team-b-new');
  });
});
