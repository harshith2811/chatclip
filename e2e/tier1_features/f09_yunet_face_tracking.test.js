/**
 * e2e/tier1_features/f09_yunet_face_tracking.test.js
 * Feature F09: YuNet Face Tracking Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F09: YuNet Face Tracking', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F09-TC-01: face detection execution returns faces array with status 200', async () => {
    const res = await client.post('/api/v1/framing/detect-faces', {
      video_path: 'data/video/speaker_frame.mp4',
      timestamp: 1.5
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.success, true);
    assert.ok(Array.isArray(res.data.faces));
    assert.ok(res.data.faces.length > 0);
  });

  it('F09-TC-02: bounding box geometry returns valid pixel coordinates [x, y, w, h] with w > 0, h > 0', async () => {
    const res = await client.post('/api/v1/framing/detect-faces', {
      video_path: 'data/video/speaker_frame.mp4'
    });
    assertStatus(res, 200);
    const face = res.data.faces[0];
    assert.ok(Array.isArray(face.box));
    assert.equal(face.box.length, 4);
    const [x, y, w, h] = face.box;
    assert.ok(typeof x === 'number' && x >= 0);
    assert.ok(typeof y === 'number' && y >= 0);
    assert.ok(typeof w === 'number' && w > 0);
    assert.ok(typeof h === 'number' && h > 0);
  });

  it('F09-TC-03: model confidence threshold satisfies >= 0.95 tracking standard', async () => {
    const res = await client.post('/api/v1/framing/detect-faces', {
      video_path: 'data/video/speaker_frame.mp4'
    });
    assertStatus(res, 200);
    const face = res.data.faces[0];
    assert.ok(typeof face.confidence === 'number');
    assert.ok(face.confidence >= 0.95 && face.confidence <= 1.0);
  });

  it('F09-TC-04: primary speaker identification tags exactly one face with primary: true', async () => {
    const res = await client.post('/api/v1/framing/detect-faces', {
      video_path: 'data/video/speaker_frame.mp4'
    });
    assertStatus(res, 200);
    const primaryFaces = res.data.faces.filter(f => f.primary === true);
    assert.equal(primaryFaces.length, 1);
  });

  it('F09-TC-05: facial aspect ratio sanity: box width-to-height ratio within reasonable range (0.6 to 1.2)', async () => {
    const res = await client.post('/api/v1/framing/detect-faces', {
      video_path: 'data/video/speaker_frame.mp4'
    });
    assertStatus(res, 200);
    const [, , w, h] = res.data.faces[0].box;
    const ratio = w / h;
    assert.ok(ratio >= 0.6 && ratio <= 1.2, `Aspect ratio ${ratio} must be between 0.6 and 1.2`);
  });
});
