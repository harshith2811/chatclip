/**
 * e2e/tier1_features/f20_waveform_data.test.js
 * Feature F20: Waveform Data Extraction Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F20: Waveform Data Extraction', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('20.1: extracts 100-point normalized waveform array from clip', async () => {
    const res = await client.editorWaveform('clip-default-01');
    assertStatus(res, 200);
    assert.ok(Array.isArray(res.data.points));
    assert.equal(res.data.points.length, 100);
  });

  it('20.2: verifies all waveform energy values fall within normalized [0.0, 1.0] range', async () => {
    const res = await client.editorWaveform('clip-default-01');
    assertStatus(res, 200);
    for (const pt of res.data.points) {
      assert.equal(typeof pt, 'number');
      assert.ok(pt >= 0.0 && pt <= 1.0, `Point ${pt} outside normalized range`);
    }
  });

  it('20.3: verifies waveform duration corresponds to positive media duration', async () => {
    const res = await client.editorWaveform('clip-default-01');
    assertStatus(res, 200);
    assert.ok(res.data.duration > 0);
  });

  it('20.4: extracts waveform using full filesystem path string', async () => {
    const res = await client.post('/api/v1/editor/waveform', { file_path: 'data/rendered_clips/clip-default-01.mp4' });
    assertStatus(res, 200);
    assert.equal(res.data.points.length, 100);
  });

  it('20.5: confirms waveform contains no NaN or null values for timeline rendering', async () => {
    const res = await client.editorWaveform('clip-default-01');
    assertStatus(res, 200);
    assert.ok(res.data.points.every(p => !Number.isNaN(p) && p !== null));
  });
});
