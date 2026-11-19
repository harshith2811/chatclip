/**
 * e2e/tier1_features/f25_universal_ingestion.test.js
 * Feature F25: Universal Ingestion Gate Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F25: Universal Ingestion Gate', () => {
  let serverInfo, client;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('25.1: ingests video from valid URL with explicit human approval', async () => {
    const res = await client.omniIngest({
      title: 'Universal Ingestion Test',
      video_url: 'https://cdn.example.com/renders/sample.mp4',
      approved_by_user: true
    });
    assertStatus(res, 201);
    assert.equal(res.data.success, true);
    assert.ok(res.data.contentId);
  });

  it('25.2: routes ingested media across multi-platform destinations', async () => {
    const res = await client.omniIngest({
      title: 'Multi-Channel Ingest',
      video_url: 'https://cdn.example.com/renders/multi.mp4',
      approved_by_user: true,
      platforms: ['youtube_shorts', 'instagram_reels', 'tiktok']
    });
    assertStatus(res, 201);
  });

  it('25.3: enforces 500 MB upload limit accepting compliant payloads', async () => {
    const res = await client.omniIngest({
      title: 'Bounded Payload Test',
      video_url: 'https://cdn.example.com/renders/bounded.mp4',
      approved_by_user: true,
      file_size_bytes: 1048576
    });
    assertStatus(res, 201);
  });

  it('25.4: verifies SHA-256 deduplication and integrity check', async () => {
    const res = await client.omniIngest({
      title: 'Integrity Check Ingest',
      video_url: 'https://cdn.example.com/renders/checked.mp4',
      approved_by_user: true,
      expected_sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    });
    assertStatus(res, 201);
    assert.equal(res.data.rightsStatus, 'VERIFIED');
  });

  it('25.5: returns safe deduplicated 200 response on replayed idempotency key', async () => {
    const idemKey = 'idem-f25-replay-001';
    const firstRes = await client.omniIngest({
      title: 'Idempotency Clip',
      video_url: 'https://cdn.example.com/renders/idem.mp4',
      approved_by_user: true,
      idempotency_key: idemKey
    });
    assertStatus(firstRes, 201);

    const dupRes = await client.omniIngest({
      title: 'Idempotency Clip Duplicate',
      video_url: 'https://cdn.example.com/renders/idem.mp4',
      approved_by_user: true,
      idempotency_key: idemKey
    });
    assertStatus(dupRes, 200);
    assert.equal(dupRes.data.deduplicated, true);
    assert.equal(dupRes.data.status, 'DUPLICATE_SKIPPED');
  });
});
