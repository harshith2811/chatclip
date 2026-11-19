/**
 * e2e/tier1_features/f21_batch_export.test.js
 * Feature F21: Multi-Clip Batch Export Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F21: Multi-Clip Batch Export', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('21.1: executes batch export of 3 sequential clips in a single operation', async () => {
    const res = await client.editorExport({
      source_path: 'clip-default-01',
      project_id: 'proj-default',
      clips: [
        { title: 'Part 1', start_seconds: 0.0, end_seconds: 10.0 },
        { title: 'Part 2', start_seconds: 10.0, end_seconds: 20.0 },
        { title: 'Part 3', start_seconds: 20.0, end_seconds: 30.0 }
      ]
    });
    assertStatus(res, 200);
    assert.equal(res.data.exported_count, 3);
    assert.equal(res.data.clips.length, 3);
  });

  it('21.2: generates distinct unique clip IDs for every segment in batch', async () => {
    const res = await client.editorExport({
      source_path: 'clip-default-01',
      project_id: 'proj-default',
      clips: [
        { title: 'Segment A', start_seconds: 0.0, end_seconds: 5.0 },
        { title: 'Segment B', start_seconds: 5.0, end_seconds: 10.0 }
      ]
    });
    assertStatus(res, 200);
    const ids = res.data.clips.map(c => c.clip_id);
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, ids.length);
  });

  it('21.3: exports batch with mixed aspect ratios across clips', async () => {
    const res = await client.editorExport({
      source_path: 'clip-default-01',
      project_id: 'proj-default',
      clips: [
        { title: 'Clip 9:16', start_seconds: 0.0, end_seconds: 10.0, aspect_ratio: '9:16' },
        { title: 'Clip 1:1', start_seconds: 10.0, end_seconds: 20.0, aspect_ratio: '1:1' },
        { title: 'Clip 16:9', start_seconds: 20.0, end_seconds: 30.0, aspect_ratio: '16:9' }
      ]
    });
    assertStatus(res, 200);
    assert.equal(res.data.clips[0].aspect_ratio, '9:16');
    assert.equal(res.data.clips[1].aspect_ratio, '1:1');
    assert.equal(res.data.clips[2].aspect_ratio, '16:9');
  });

  it('21.4: links all batch-exported clips to specified project ID', async () => {
    const res = await client.editorExport({
      source_path: 'clip-default-01',
      project_id: 'proj-default',
      clips: [{ title: 'Clip Linked', start_seconds: 0.0, end_seconds: 10.0 }]
    });
    assertStatus(res, 200);
    assert.equal(res.data.project_id, 'proj-default');
  });

  it('21.5: queues asynchronous batch export via batch-export endpoint', async () => {
    const res = await client.post('/api/v1/editor/batch-export', {
      source_path: 'clip-default-01',
      clips: [{ title: 'Async Clip 1' }, { title: 'Async Clip 2' }]
    });
    assertStatus(res, 200);
    assert.equal(res.data.status, 'BATCH_QUEUED');
    assert.equal(res.data.total_clips, 2);
  });
});
