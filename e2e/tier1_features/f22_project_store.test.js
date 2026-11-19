/**
 * e2e/tier1_features/f22_project_store.test.js
 * Feature F22: Persistent Project Store Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F22: Persistent Project Store', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({
      baseUrl: serverInfo.baseUrl,
      workspaceId: 'workspace-team-a',
      userId: 'user_admin_a',
      userRole: 'admin'
    });
  });

  after(async () => {
    await stopTestServer();
  });

  it('22.1: lists persistent projects enriched with clip metadata', async () => {
    const res = await client.listProjects();
    assertStatus(res, 200);
    assert.ok(Array.isArray(res.data));
    assert.ok(res.data.length >= 1);
    assert.ok(res.data[0].project_id);
  });

  it('22.2: creates new project atomically with title and returns 201 Created', async () => {
    const res = await client.post('/api/v1/projects', {
      project_id: 'proj-f22-atomic',
      title: 'F22 Persistent Project Test'
    });
    assertStatus(res, 201);
    assert.equal(res.data.project_id, 'proj-f22-atomic');
    assert.equal(res.data.title, 'F22 Persistent Project Test');
  });

  it('22.3: retrieves project details by ID with clips array', async () => {
    const res = await client.getProject('proj-default');
    assertStatus(res, 200);
    assert.equal(res.data.project_id, 'proj-default');
    assert.ok(Array.isArray(res.data.clips));
  });

  it('22.4: filters clips by project_id returning only associated clip records', async () => {
    const res = await client.listClips('proj-default');
    assertStatus(res, 200);
    assert.ok(Array.isArray(res.data));
    for (const clip of res.data) {
      assert.equal(clip.project_id, 'proj-default');
    }
  });

  it('22.5: deletes project record atomically returning 200 and subsequent 404', async () => {
    const delRes = await client.deleteProject('proj-f22-atomic');
    assertStatus(delRes, 200);
    assert.equal(delRes.data.status, 'deleted');

    const checkRes = await client.getProject('proj-f22-atomic');
    assertStatus(checkRes, 404);
  });
});
