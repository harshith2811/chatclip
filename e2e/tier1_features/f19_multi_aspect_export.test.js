/**
 * e2e/tier1_features/f19_multi_aspect_export.test.js
 * Feature F19: Multi-Aspect Export Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F19: Multi-Aspect Export', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('19.1: exports vertical 9:16 clip for Shorts and Reels', async () => {
    const res = await client.editorExport({
      source_path: 'clip-default-01',
      project_id: 'proj-default',
      clips: [{ title: 'Vertical Clip', start_seconds: 0.0, end_seconds: 15.0, aspect_ratio: '9:16' }]
    });
    assertStatus(res, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.clips[0].aspect_ratio, '9:16');
  });

  it('19.2: exports landscape 16:9 clip for standard widescreen video', async () => {
    const res = await client.editorExport({
      source_path: 'clip-default-01',
      project_id: 'proj-default',
      clips: [{ title: 'Landscape Clip', start_seconds: 0.0, end_seconds: 20.0, aspect_ratio: '16:9' }]
    });
    assertStatus(res, 200);
    assert.equal(res.data.clips[0].aspect_ratio, '16:9');
  });

  it('19.3: exports square 1:1 clip for feed previews and social posts', async () => {
    const res = await client.editorExport({
      source_path: 'clip-default-01',
      project_id: 'proj-default',
      clips: [{ title: 'Square Clip', start_seconds: 5.0, end_seconds: 25.0, aspect_ratio: '1:1' }]
    });
    assertStatus(res, 200);
    assert.equal(res.data.clips[0].aspect_ratio, '1:1');
  });

  it('19.4: exports clip with custom subject-tracking center coordinates', async () => {
    const res = await client.editorExport({
      source_path: 'clip-default-01',
      project_id: 'proj-default',
      clips: [{ title: 'Panned Clip', start_seconds: 0.0, end_seconds: 10.0, aspect_ratio: '9:16', center_x: 0.75, center_y: 0.5 }]
    });
    assertStatus(res, 200);
    assert.equal(res.data.clips[0].status, 'READY');
  });

  it('19.5: exports clip with custom styled text overlay', async () => {
    const res = await client.editorExport({
      source_path: 'clip-default-01',
      project_id: 'proj-default',
      clips: [{ title: 'Overlay Clip', start_seconds: 0.0, end_seconds: 15.0, aspect_ratio: '9:16', text_overlay: 'Breaking News', text_position: 'top' }]
    });
    assertStatus(res, 200);
    assert.ok(res.data.clips[0].clip_id);
  });
});
