/**
 * e2e/tier1_features/f18_frame_preview.test.js
 * Feature F18: Frame Preview Extraction Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F18: Frame Preview Extraction', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('18.1: extracts frame preview at onset timestamp 0.0s returning JPEG image', async () => {
    const res = await client.editorPreviewFrame('clip-default-01', 0.0);
    assertStatus(res, 200);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('image/jpeg'));
  });

  it('18.2: extracts frame preview at midpoint timestamp 15.0s returning valid binary buffer', async () => {
    const res = await client.editorPreviewFrame('clip-default-01', 15.0);
    assertStatus(res, 200);
    assert.ok(Buffer.isBuffer(res.data));
    assert.ok(res.data.length > 0);
  });

  it('18.3: extracts frame preview at high-precision floating point timestamp 3.755s', async () => {
    const res = await client.editorPreviewFrame('clip-default-01', 3.755);
    assertStatus(res, 200);
    assert.ok(Buffer.isBuffer(res.data));
  });

  it('18.4: extracts frame preview resolving clip ID alias through ProjectStore', async () => {
    const res = await client.post('/api/v1/editor/preview-frame', {
      file_path: 'clip-default-01',
      timestamp: 5.0
    });
    assertStatus(res, 200);
    assert.ok(Buffer.isBuffer(res.data));
  });

  it('18.5: verifies returned image buffer matches JPEG magic SOI/EOI markers', async () => {
    const res = await client.editorPreviewFrame('clip-default-01', 1.0);
    assertStatus(res, 200);
    const buf = res.data;
    assert.equal(buf[0], 0xFF);
    assert.equal(buf[1], 0xD8); // SOI
    assert.equal(buf[buf.length - 2], 0xFF);
    assert.equal(buf[buf.length - 1], 0xD9); // EOI
  });
});
