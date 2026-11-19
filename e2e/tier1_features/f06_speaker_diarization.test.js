/**
 * e2e/tier1_features/f06_speaker_diarization.test.js
 * Feature F06: Speaker Diarization Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus, assertHeaders } from '../harness/assertions.js';

describe('Feature F06: Speaker Diarization', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('F06-TC-01: two-speaker conversational audio returns speaker_turns with status 200', async () => {
    const res = await client.post('/api/v1/audio/diarize', {
      audio_path: 'data/audio/interview_sample.wav',
      num_speakers: 2
    });
    assertStatus(res, 200);
    assertHeaders(res, { 'content-type': 'application/json' });
    assert.equal(res.data.success, true);
    assert.ok(Array.isArray(res.data.speaker_turns));
    assert.ok(res.data.speaker_turns.length >= 2);
  });

  it('F06-TC-02: speaker identity tags: returns distinct labels (SPEAKER_00 and SPEAKER_01)', async () => {
    const res = await client.post('/api/v1/audio/diarize', {
      audio_path: 'data/audio/interview_sample.wav'
    });
    assertStatus(res, 200);
    const speakers = new Set(res.data.speaker_turns.map(t => t.speaker));
    assert.ok(speakers.has('SPEAKER_00'));
    assert.ok(speakers.has('SPEAKER_01'));
  });

  it('F06-TC-03: temporal chronology: turns are sorted chronologically without start/end inversion', async () => {
    const res = await client.post('/api/v1/audio/diarize', {
      audio_path: 'data/audio/interview_sample.wav'
    });
    assertStatus(res, 200);
    const turns = res.data.speaker_turns;
    for (let i = 0; i < turns.length; i++) {
      assert.ok(turns[i].start < turns[i].end, `Turn ${i} start must be < end`);
      if (i > 0) {
        assert.ok(turns[i - 1].end <= turns[i].start + 0.5, 'Turns must be chronologically ordered');
      }
    }
  });

  it('F06-TC-04: turn count consistency: count equals speaker_turns array length', async () => {
    const res = await client.post('/api/v1/audio/diarize', {
      audio_path: 'data/audio/interview_sample.wav'
    });
    assertStatus(res, 200);
    assert.equal(res.data.count, res.data.speaker_turns.length);
  });

  it('F06-TC-05: diarization turn durations: both interlocutors have positive duration coverage', async () => {
    const res = await client.post('/api/v1/audio/diarize', {
      audio_path: 'data/audio/interview_sample.wav'
    });
    assertStatus(res, 200);
    for (const turn of res.data.speaker_turns) {
      const duration = turn.end - turn.start;
      assert.ok(duration > 0, 'Turn duration must be positive');
    }
  });
});
