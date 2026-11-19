/**
 * e2e/tier1_features/f05_whisperx_alignment.test.js
 * Feature F05: WhisperX Alignment Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F05: WhisperX Alignment', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F05-TC-01: word-level phoneme alignment returns non-empty aligned_words array with status 200', async () => {
    const res = await client.post('/api/v1/transcribe/align', {
      audio_path: 'data/audio/sample_audio.wav',
      transcript_text: 'Autonomous intelligence executes seamlessly'
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.success, true);
    assert.ok(Array.isArray(res.data.aligned_words));
    assert.ok(res.data.aligned_words.length > 0);
  });

  it('F05-TC-02: monotonic timestamp progression: word.start < word.end and word[i].end <= word[i+1].start', async () => {
    const res = await client.post('/api/v1/transcribe/align', {
      audio_path: 'data/audio/sample_audio.wav'
    });
    assertStatus(res, 200);
    const words = res.data.aligned_words;
    for (let i = 0; i < words.length; i++) {
      assert.ok(words[i].start < words[i].end, `Word ${words[i].word} start must be < end`);
      if (i > 0) {
        assert.ok(words[i - 1].end <= words[i].start + 0.05, 'Word timestamps must be sequentially ordered');
      }
    }
  });

  it('F05-TC-03: phoneme confidence scores: each word has score >= 0.9 and <= 1.0', async () => {
    const res = await client.post('/api/v1/transcribe/align', {
      audio_path: 'data/audio/sample_audio.wav'
    });
    assertStatus(res, 200);
    for (const w of res.data.aligned_words) {
      assert.ok(typeof w.score === 'number');
      assert.ok(w.score >= 0.9 && w.score <= 1.0, `Score ${w.score} must be between 0.9 and 1.0`);
    }
  });

  it('F05-TC-04: total duration consistency: duration >= last_word.end', async () => {
    const res = await client.post('/api/v1/transcribe/align', {
      audio_path: 'data/audio/sample_audio.wav'
    });
    assertStatus(res, 200);
    assert.ok(typeof res.data.duration === 'number' && res.data.duration > 0);
    const lastWord = res.data.aligned_words[res.data.aligned_words.length - 1];
    assert.ok(res.data.duration >= lastWord.end);
  });

  it('F05-TC-05: word token preservation: tokens match expected words in sequence', async () => {
    const res = await client.post('/api/v1/transcribe/align', {
      audio_path: 'data/audio/sample_audio.wav'
    });
    assertStatus(res, 200);
    const tokens = res.data.aligned_words.map(w => w.word);
    assert.deepEqual(tokens, ['Autonomous', 'intelligence', 'executes', 'seamlessly']);
  });
});
