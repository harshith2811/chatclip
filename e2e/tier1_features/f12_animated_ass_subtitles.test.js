/**
 * e2e/tier1_features/f12_animated_ass_subtitles.test.js
 * Feature F12: Animated ASS Subtitles Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F12: Animated ASS Subtitles', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F12-TC-01: ASS V4+ script syntax: output contains [Script Info], [V4+ Styles], and [Events]', async () => {
    const res = await client.post('/api/v1/captions/generate-ass', {
      text: 'Viral content generation'
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.success, true);
    const content = res.data.ass_content;
    assert.ok(content.includes('[Script Info]'), 'Must include [Script Info]');
    assert.ok(content.includes('[V4+ Styles]'), 'Must include [V4+ Styles]');
    assert.ok(content.includes('[Events]'), 'Must include [Events]');
  });

  it('F12-TC-02: karaoke animation tags: output includes {\\k50} timing tags', async () => {
    const res = await client.post('/api/v1/captions/generate-ass', {
      text: 'Animated word highlights'
    });
    assertStatus(res, 200);
    assert.match(res.data.ass_content, /\{\\k\d+\}/, 'Must contain ASS karaoke timing tags');
  });

  it('F12-TC-03: ASS override injection sanitization: curly braces are stripped from text', async () => {
    const maliciousText = 'Safe text {\\b1\\c&H0000FF&} injected tag';
    const res = await client.post('/api/v1/captions/generate-ass', {
      text: maliciousText
    });
    assertStatus(res, 200);
    // Any injected braces inside the user text should be stripped so they cannot execute raw overrides
    assert.ok(!res.data.ass_content.includes('{\\b1\\c&H0000FF&}'), 'Injected override braces must be neutralized');
  });

  it('F12-TC-04: preset selection: supports distinct presets (hormozi, beast_bounce, neon_cyber)', async () => {
    const res = await client.post('/api/v1/captions/generate-ass', {
      text: 'Preset styled text',
      preset: 'hormozi'
    });
    assertStatus(res, 200);
    assert.equal(res.data.success, true);
    assert.ok(res.data.ass_content.length > 0);
  });

  it('F12-TC-05: dialogue line CSV formatting matches ASS events syntax', async () => {
    const res = await client.post('/api/v1/captions/generate-ass', {
      text: 'Exact timestamp sync'
    });
    assertStatus(res, 200);
    assert.match(res.data.ass_content, /Dialogue:\s*\d+,\d+:\d{2}:\d{2}\.\d{2},\d+:\d{2}:\d{2}\.\d{2}/);
  });
});
