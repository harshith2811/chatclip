/**
 * e2e/tier1_features/f17_12point_media_qa.test.js
 * Feature F17: 12-Point Media QA Gate Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus, assert12PointMediaQA } from '../harness/assertions.js';

describe('Feature F17: 12-Point Media QA Gate', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('17.1: verifies rendered clip passes all 12 QA gate checks with PASSED status', async () => {
    const res = await client.post('/api/v1/qa/verify', { clip_id: 'clip-default-01' });
    assertStatus(res, 200);
    assert12PointMediaQA(res.data);
    assert.equal(res.data.status, 'PASSED');
    assert.equal(res.data.score, 100);
  });

  it('17.2: verifies container decodability, video stream, and audio stream checks pass', async () => {
    const res = await client.post('/api/v1/qa/verify', { clip_id: 'clip-default-01' });
    assertStatus(res, 200);
    const checks = res.data.checks || [];
    const decodable = checks.find(c => c.name === 'container_decodability');
    const videoStream = checks.find(c => c.name === 'video_stream_present');
    const audioStream = checks.find(c => c.name === 'audio_stream_present');
    assert.ok(decodable && decodable.passed, 'container_decodability must pass');
    assert.ok(videoStream && videoStream.passed, 'video_stream_present must pass');
    assert.ok(audioStream && audioStream.passed, 'audio_stream_present must pass');
  });

  it('17.3: verifies aspect ratio metrics: SAR unity 1:1 and DAR 9:16 conformance', async () => {
    const res = await client.post('/api/v1/qa/verify', { clip_id: 'clip-default-01' });
    assertStatus(res, 200);
    const checks = res.data.checks || [];
    const sar = checks.find(c => c.name === 'sar_unity');
    const dar = checks.find(c => c.name === 'dar_conformance');
    assert.ok(sar && sar.passed, 'sar_unity must pass');
    assert.ok(dar && dar.passed, 'dar_conformance must pass');
  });

  it('17.4: verifies audio normalization (-14 LUFS) and sampling rate (48 kHz) checks', async () => {
    const res = await client.post('/api/v1/qa/verify', { clip_id: 'clip-default-01' });
    assertStatus(res, 200);
    const checks = res.data.checks || [];
    const rate = checks.find(c => c.name === 'audio_sampling_rate');
    const loudness = checks.find(c => c.name === 'audio_loudness_normalized');
    assert.ok(rate && rate.passed, 'audio_sampling_rate must pass');
    assert.ok(loudness && loudness.passed, 'audio_loudness_normalized must pass');
  });

  it('17.5: verifies 64-char SHA-256 hex digest integrity and score >= 90', async () => {
    const res = await client.post('/api/v1/qa/verify', { clip_id: 'clip-default-01' });
    assertStatus(res, 200);
    assert.match(res.data.sha256, /^[a-f0-9]{64}$/i);
    assert.ok(res.data.score >= 90);
  });
});
