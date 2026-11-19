/**
 * e2e/tier1_features/f23_range_streaming.test.js
 * Feature F23: Range-Streaming Playback Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus, assertRangeResponse } from '../harness/assertions.js';

describe('Feature F23: Range-Streaming Playback', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('23.1: requests initial chunk bytes 0-1023 returning HTTP 206 with Content-Range', async () => {
    const rangeRes = await client.getMediaWithRange('clip-default-01', 0, 1023);
    assertRangeResponse(rangeRes, {
      expectedStatus: 206,
      start: 0,
      end: 1023,
      totalLength: 10240,
      mimeType: 'video/mp4'
    });
    assert.equal(rangeRes.buffer.length, 1024);
  });

  it('23.2: requests mid-stream scrub slice bytes 2048-4095 returning exact 2048-byte chunk', async () => {
    const rangeRes = await client.getMediaWithRange('clip-default-01', 2048, 4095);
    assertRangeResponse(rangeRes, {
      expectedStatus: 206,
      start: 2048,
      end: 4095,
      totalLength: 10240
    });
    assert.equal(rangeRes.buffer.length, 2048);
  });

  it('23.3: requests open-ended range bytes 5000- returning bytes to end of stream', async () => {
    const rangeRes = await client.getMediaWithRange('clip-default-01', 5000, null);
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.buffer.length, 5240);
  });

  it('23.4: verifies streaming alias endpoint /stream supports Range requests equivalently', async () => {
    const rangeRes = await client.requestRange('/api/v1/clips/clip-default-01/stream', 0, 511);
    assertRangeResponse(rangeRes, {
      expectedStatus: 206,
      start: 0,
      end: 511,
      totalLength: 10240
    });
  });

  it('23.5: requests full media without Range header returning HTTP 200 with Accept-Ranges', async () => {
    const res = await client.fastApi('/api/v1/clips/clip-default-01/media');
    assertStatus(res, 200);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('content-type'), 'video/mp4');
    assert.equal(Buffer.byteLength(res.data), 10240);
  });
});
