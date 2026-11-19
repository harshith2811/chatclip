import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Ensure automation key and isolated data directory are active before server.js/db.js evaluate.
process.env.AUTOMATION_SECRET_KEY = process.env.AUTOMATION_SECRET_KEY || 'test_v2_auto_secret_2026';
const isolatedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnipost-ingest-test-'));
process.env.OMNIPOST_DATA_DIR = isolatedDataDir;
process.env.OMNIPOST_STAGING_DIR = path.join(isolatedDataDir, 'staging');

const { app, revokedAssetIds } = await import('../server.js');
const registry = await import('./registry.js');

test('OmniPost V2 Ingest Security, Rights Enforcement & Adapter Integrity Suite', async (t) => {
  const autoKey = process.env.AUTOMATION_SECRET_KEY;
  let server;
  let baseUrl;

  t.before(async () => {
    revokedAssetIds.clear();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  t.after(async () => {
    revokedAssetIds.clear();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(isolatedDataDir, { recursive: true, force: true });
  });

  await t.test('1. youtubeAdapter refuses fake yt_* success without configured n8nClient', async () => {
    const adapter = registry.youtubeAdapter({
      post: { content_id: 'TEST-1', title: 'Test' },
      n8nClient: null
    });
    await assert.rejects(
      () => adapter.createContainer(),
      (err) => err.name === 'MetaApiError' && err.status === 503
    );

    const badBridgeAdapter = registry.youtubeAdapter({
      post: { content_id: 'TEST-2', title: 'Test' },
      n8nClient: async () => ({ ok: true }) // missing videoId/id
    });
    await assert.rejects(
      () => badBridgeAdapter.createContainer(),
      (err) => err.name === 'MetaApiError' && err.status === 502
    );
  });

  await t.test('2. POST /api/v2/ingest rejects unauthenticated and missing/invalid rights payloads', async () => {
    const unauth = await fetch(`${baseUrl}/api/v2/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No Auth' })
    });
    assert.equal(unauth.status, 401);

    const missingManifest = await fetch(`${baseUrl}/api/v2/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': autoKey },
      body: JSON.stringify({ title: 'Missing Rights', approved_by_user: true })
    });
    assert.equal(missingManifest.status, 403);

    const operatorAsset = await fetch(`${baseUrl}/api/v2/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': autoKey },
      body: JSON.stringify({
        video_id: 'v_op_bypass',
        approved_by_user: true,
        attribution: { creator_name: 'Me', source_url: 'https://example.com/v' },
        rights_manifest: { basis: 'OPERATOR_ASSET', status: 'VERIFIED', proof_reference: 'upload' }
      })
    });
    assert.equal(operatorAsset.status, 403);

    const unapproved = await fetch(`${baseUrl}/api/v2/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': autoKey },
      body: JSON.stringify({
        video_id: 'v_no_human',
        approved_by_user: false,
        attribution: { creator_name: 'CC Author', source_url: 'https://example.com/v' },
        rights_manifest: { basis: 'CREATIVE_COMMONS', status: 'VERIFIED', license_url: 'https://creativecommons.org/licenses/by/4.0/' }
      })
    });
    assert.equal(unapproved.status, 403);

    const missingAttr = await fetch(`${baseUrl}/api/v2/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': autoKey },
      body: JSON.stringify({
        video_id: 'v_no_attr',
        approved_by_user: true,
        rights_manifest: { basis: 'CREATIVE_COMMONS', status: 'VERIFIED', license_url: 'https://creativecommons.org/licenses/by/4.0/' }
      })
    });
    assert.equal(missingAttr.status, 403);
  });

  await t.test('3. POST /api/v2/ingest blocks SSRF loopback/metadata URLs and file_path traversal', async () => {
    for (const badUrl of [
      'http://127.0.0.1:8000/secret.mp4',
      'http://localhost/internal.mp4',
      'http://169.254.169.254/latest/meta-data/'
    ]) {
      const res = await fetch(`${baseUrl}/api/v2/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': autoKey },
        body: JSON.stringify({
          video_id: 'v_ssrf',
          mediaUrl: badUrl,
          approved_by_user: true,
          attribution: 'Credit: Example',
          rights_manifest: { basis: 'OWNED', status: 'VERIFIED', proof_reference: 'owned-1' }
        })
      });
      assert.equal(res.status, 400, `Expected SSRF block for ${badUrl}`);
    }

    const pathRes = await fetch(`${baseUrl}/api/v2/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': autoKey },
      body: JSON.stringify({
        file_path: '../../.env',
        video_id: 'v_traversal',
        approved_by_user: true,
        attribution: 'Credit: Example',
        rights_manifest: { basis: 'OWNED', status: 'VERIFIED', proof_reference: 'owned-1' }
      })
    });
    assert.equal(pathRes.status, 400);
  });

  await t.test('4. POST /api/v2/ingest enforces SHA-256 verification, idempotency, and mid-flight revocation', async () => {
    const tmpBytes = Buffer.from('synthetic-mp4-binary-payload-v2-ingest');
    const validSha = crypto.createHash('sha256').update(tmpBytes).digest('hex');

    // A) Bad checksum must be rejected with 422
    const badForm = new FormData();
    badForm.append('file', new Blob([tmpBytes], { type: 'video/mp4' }), 'clip.mp4');
    badForm.append('video_id', 'vid_cc_ok');
    badForm.append('expected_sha256', '0'.repeat(64));
    badForm.append('approved_by_user', 'true');
    badForm.append('attribution', JSON.stringify({ creator_name: 'CC Lab', text: 'Source: CC Lab (CC BY 4.0)' }));
    badForm.append('rights_manifest', JSON.stringify({
      video_id: 'vid_cc_ok',
      basis: 'CREATIVE_COMMONS',
      status: 'VERIFIED',
      license_url: 'https://creativecommons.org/licenses/by/4.0/'
    }));
    const badUpload = await fetch(`${baseUrl}/api/v2/ingest`, {
      method: 'POST',
      headers: { 'x-api-key': autoKey },
      body: badForm
    });
    assert.equal(badUpload.status, 422);

    // B) Valid checksum + manifest succeeds with 201 and caches idempotency key
    const goodForm = new FormData();
    goodForm.append('file', new Blob([tmpBytes], { type: 'video/mp4' }), 'clip.mp4');
    goodForm.append('video_id', 'vid_cc_ok');
    goodForm.append('expected_sha256', validSha);
    goodForm.append('approved_by_user', 'true');
    goodForm.append('platforms', JSON.stringify(['youtube']));
    goodForm.append('attribution', JSON.stringify({ creator_name: 'CC Lab', text: 'Source: CC Lab (CC BY 4.0)' }));
    goodForm.append('rights_manifest', JSON.stringify({
      video_id: 'vid_cc_ok',
      basis: 'CREATIVE_COMMONS',
      status: 'VERIFIED',
      license_url: 'https://creativecommons.org/licenses/by/4.0/'
    }));

    const okRes = await fetch(`${baseUrl}/api/v2/ingest`, {
      method: 'POST',
      headers: { 'x-api-key': autoKey, 'x-idempotency-key': 'idem-cc-123' },
      body: goodForm
    });
    assert.equal(okRes.status, 201);
    const okBody = await okRes.json();
    assert.equal(okBody.sha256, validSha);
    assert.equal(okBody.rightsStatus, 'VERIFIED');

    // C) Replay with same idempotency key deduplicates cleanly
    const replayRes = await fetch(`${baseUrl}/api/v2/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': autoKey, 'x-idempotency-key': 'idem-cc-123' },
      body: JSON.stringify({
        video_id: 'vid_cc_ok',
        approved_by_user: true,
        attribution: 'Source: CC Lab (CC BY 4.0)',
        rights_manifest: { video_id: 'vid_cc_ok', basis: 'CREATIVE_COMMONS', status: 'VERIFIED', license_url: 'https://creativecommons.org/licenses/by/4.0/' }
      })
    });
    assert.equal(replayRes.status, 200);
    const replayBody = await replayRes.json();
    assert.equal(replayBody.deduplicated, true);

    // D) Revoke rights and verify both publish and ops health reflect revocation
    const revRes = await fetch(`${baseUrl}/api/v2/rights/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': autoKey },
      body: JSON.stringify({ video_id: 'vid_cc_ok', content_id: okBody.contentId, reason: 'Creator opted out' })
    });
    assert.equal(revRes.status, 200);
    const revBody = await revRes.json();
    assert.equal(revBody.revoked, true);

    const postRevokePub = await fetch(`${baseUrl}/api/posts/${okBody.contentId}/publish`, {
      method: 'POST',
      headers: { 'x-api-key': autoKey }
    });
    assert.equal(postRevokePub.status, 403);

    const opsRes = await fetch(`${baseUrl}/api/v2/health/ops`, {
      headers: { 'x-api-key': autoKey }
    });
    assert.equal(opsRes.status, 200);
    const opsBody = await opsRes.json();
    assert.ok(opsBody.revokedCount >= 1);
    assert.equal(opsBody.legalOfficer, true);
  });

  await t.test('5. LEGAL_OFFICER=false allows unverified ingest while preserving SSRF and auth', async () => {
    const serverMod = await import('../server.js');
    process.env.LEGAL_OFFICER = 'false';
    try {
      assert.equal(serverMod.isLegalOfficerEnabled(), false);

      // Auth is STILL enforced
      const unauthRes = await fetch(`${baseUrl}/api/v2/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: 'vid_bypass_1', title: 'No Auth' })
      });
      assert.equal(unauthRes.status, 401);

      // SSRF defense is STILL enforced
      const ssrfRes = await fetch(`${baseUrl}/api/v2/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': autoKey },
        body: JSON.stringify({
          video_id: 'vid_bypass_ssrf',
          mediaUrl: 'http://127.0.0.1:8080/internal.mp4',
          title: 'SSRF Test'
        })
      });
      assert.equal(ssrfRes.status, 400);

      // Unverified ingest with no rights_manifest or attribution succeeds honestly with UNVERIFIED_BYPASS
      const bypassRes = await fetch(`${baseUrl}/api/v2/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': autoKey },
        body: JSON.stringify({
          video_id: 'vid_bypass_ok',
          title: 'Bypass Mode Video',
          platforms: ['youtube']
        })
      });
      assert.equal(bypassRes.status, 201);
      const bypassBody = await bypassRes.json();
      assert.equal(bypassBody.success, true);
      assert.equal(bypassBody.rightsStatus, 'UNVERIFIED_BYPASS');
      assert.equal(bypassBody.legalOfficer, false);

      const opsRes = await fetch(`${baseUrl}/api/v2/health/ops`, {
        headers: { 'x-api-key': autoKey }
      });
      const opsBody = await opsRes.json();
      assert.equal(opsBody.legalOfficer, false);
    } finally {
      delete process.env.LEGAL_OFFICER;
    }
  });
});
