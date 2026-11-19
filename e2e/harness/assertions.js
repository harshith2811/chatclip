/**
 * e2e/harness/assertions.js
 * Contract-accurate, reusable assertions for E2E testing across Tiers 1–4.
 * Uses native node:assert/strict with informative failure reporting.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';

/**
 * Asserts exact HTTP status match with rich diagnostic context on failure.
 */
export function assertStatus(response, expectedStatus, message = '') {
  const actualStatus = response.status;
  const failureDetail = response.data ? `\nResponse Data: ${JSON.stringify(response.data)}` : '';
  assert.equal(
    actualStatus,
    expectedStatus,
    `${message || 'Expected HTTP status mismatch'}. Expected: ${expectedStatus}, Received: ${actualStatus}.${failureDetail}`
  );
}

/**
 * Asserts that specified headers are present and match (case-insensitive).
 */
export function assertHeaders(response, headerMap) {
  const headers = response.headers;
  for (const [key, expectedVal] of Object.entries(headerMap)) {
    const actualVal = typeof headers.get === 'function' ? headers.get(key) : headers[key.toLowerCase()];
    assert.ok(
      actualVal !== null && actualVal !== undefined,
      `Expected header "${key}" was not found in response headers.`
    );
    if (typeof expectedVal === 'string') {
      assert.ok(
        actualVal.toLowerCase().includes(expectedVal.toLowerCase()),
        `Header "${key}" value mismatch. Expected substring "${expectedVal}", Received: "${actualVal}".`
      );
    } else if (expectedVal instanceof RegExp) {
      assert.match(
        actualVal,
        expectedVal,
        `Header "${key}" does not match pattern ${expectedVal}. Received: "${actualVal}".`
      );
    }
  }
}

/**
 * Asserts HTTP 206 Partial Content range streaming compliance.
 */
export function assertRangeResponse(rangeResult, {
  expectedStatus = 206,
  start,
  end,
  totalLength,
  mimeType = 'video/mp4'
} = {}) {
  assert.equal(
    rangeResult.status,
    expectedStatus,
    `Range response status should be ${expectedStatus}, received: ${rangeResult.status}`
  );

  const headers = rangeResult.headers;
  const acceptRanges = typeof headers.get === 'function' ? headers.get('accept-ranges') : headers['accept-ranges'];
  assert.equal(acceptRanges, 'bytes', 'Header "Accept-Ranges" must equal "bytes".');

  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type'];
  assert.ok(
    contentType && contentType.includes(mimeType),
    `Header "Content-Type" must include "${mimeType}". Received: "${contentType}".`
  );

  if (start !== undefined && end !== undefined) {
    const expectedChunkSize = end - start + 1;
    const contentRange = rangeResult.contentRange || (typeof headers.get === 'function' ? headers.get('content-range') : headers['content-range']);
    assert.ok(contentRange, 'Header "Content-Range" must be present.');

    const expectedRangePattern = totalLength
      ? new RegExp(`bytes ${start}-${end}/${totalLength}`)
      : new RegExp(`bytes ${start}-${end}/\\d+`);
    assert.match(
      contentRange,
      expectedRangePattern,
      `Content-Range "${contentRange}" does not match expected range bytes ${start}-${end}/${totalLength || '*'}`
    );

    if (rangeResult.contentLength !== null && rangeResult.contentLength !== undefined) {
      assert.equal(
        rangeResult.contentLength,
        expectedChunkSize,
        `Content-Length (${rangeResult.contentLength}) must match byte span (${expectedChunkSize})`
      );
    }

    if (rangeResult.buffer && rangeResult.buffer.length > 0) {
      assert.equal(
        rangeResult.buffer.length,
        expectedChunkSize,
        `Buffer byte length (${rangeResult.buffer.length}) must equal expected chunk size (${expectedChunkSize})`
      );
    }
  }
}

/**
 * Asserts Server-Sent Events (SSE) stream framing and stage progression.
 */
export function assertSSEStream(events, {
  expectedStages = [],
  terminalEvent = 'end',
  minEvents = 1
} = {}) {
  assert.ok(
    Array.isArray(events),
    'SSE events must be an array.'
  );
  assert.ok(
    events.length >= minEvents,
    `Expected at least ${minEvents} SSE event(s), received ${events.length}.`
  );

  // Check stage ordering if stages specified
  if (expectedStages.length > 0) {
    const observedStages = events
      .map(e => e.data && typeof e.data === 'object' ? (e.data.stage || e.data.current_stage || e.data.status) : null)
      .filter(Boolean)
      .map(s => String(s).toLowerCase());

    for (const expectedStage of expectedStages) {
      const match = observedStages.some(s => s.includes(expectedStage.toLowerCase()));
      assert.ok(
        match,
        `Expected stage "${expectedStage}" was not observed in SSE stream stages: [${observedStages.join(', ')}]`
      );
    }
  }

  // Check terminal completion event
  if (terminalEvent) {
    const terminal = events.find(e => e.event === terminalEvent || (e.data && (e.data.status === 'COMPLETED' || e.data.progress === 100)));
    assert.ok(
      terminal,
      `Expected terminal event "${terminalEvent}" was not found in SSE events: [${events.map(e => e.event).join(', ')}]`
    );
  }
}

/**
 * Asserts full 12-point media QA gate compliance.
 */
export function assert12PointMediaQA(qaReport) {
  assert.ok(qaReport, 'QA report must not be null or undefined.');
  assert.equal(qaReport.status, 'PASSED', `QA report status should be PASSED, received: ${qaReport.status}`);

  const requiredChecks = [
    'container_decodability',
    'duration_tolerance',
    'video_stream_present',
    'audio_stream_present',
    'sar_unity',
    'dar_conformance',
    'frame_rate_conformance',
    'audio_sampling_rate',
    'audio_loudness_normalized',
    'zero_frozen_frames',
    'sha256_verified',
    'file_size_valid'
  ];

  if (Array.isArray(qaReport.checks)) {
    const passedCheckNames = qaReport.checks
      .filter(c => c.passed === true)
      .map(c => c.name);

    for (const reqCheck of requiredChecks) {
      assert.ok(
        passedCheckNames.includes(reqCheck),
        `Required QA gate check "${reqCheck}" was not passed in QA Report.`
      );
    }
  }

  // Check 64-char SHA-256 presence
  if (qaReport.sha256) {
    assert.match(
      qaReport.sha256,
      /^[a-f0-9]{64}$/i,
      `QA report sha256 must be a valid 64-character hex string. Received: ${qaReport.sha256}`
    );
  }
}

/**
 * Asserts multi-user / multi-tenant workspace isolation.
 */
export function assertMultiUserIsolation(response, {
  expectedAccessDenied = true
} = {}) {
  if (expectedAccessDenied) {
    assert.ok(
      response.status === 403 || response.status === 401,
      `Expected access denial (HTTP 403 or 401) for cross-workspace/tenant access. Received status: ${response.status}`
    );
  } else {
    assert.ok(
      response.status >= 200 && response.status < 300,
      `Expected access granted (HTTP 2xx). Received status: ${response.status}`
    );
  }
}

/**
 * Asserts timing-safe HMAC-SHA256 signature verification.
 */
export function assertSignedHMAC(signatureHeader, payload, secret) {
  assert.ok(signatureHeader, 'Signature header must be non-empty.');
  const rawSig = signatureHeader.replace(/^sha256=/, '').trim();
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');

  const actualBuf = Buffer.from(rawSig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');

  assert.equal(
    actualBuf.length,
    expectedBuf.length,
    `Signature length mismatch: actual ${actualBuf.length} vs expected ${expectedBuf.length}`
  );

  const matches = crypto.timingSafeEqual(actualBuf, expectedBuf);
  assert.ok(matches, 'HMAC-SHA256 signature did not match recomputed payload hash.');
}

/**
 * Asserts double-post prevention state machine.
 */
export function assertDoublePostGuarded(response) {
  // Can either be HTTP 200 with skipped duplicate indicator, or HTTP 400/409 duplicate rejection
  if (response.status === 200) {
    const dataStr = JSON.stringify(response.data || {}).toLowerCase();
    const isDuplicateSkipped = dataStr.includes('duplicate') ||
      dataStr.includes('skipped') ||
      dataStr.includes('deduplicated') ||
      dataStr.includes('outcome_unknown');
    assert.ok(
      isDuplicateSkipped,
      `HTTP 200 response should signal safe duplicate skip. Received data: ${JSON.stringify(response.data)}`
    );
  } else {
    assert.ok(
      response.status === 400 || response.status === 409 || response.status === 422,
      `Double-post rejection should return 400, 409, or 422. Received: ${response.status}`
    );
  }
}

export const CustomAssertions = {
  assertStatus,
  assertHeaders,
  assertRangeResponse,
  assertSSEStream,
  assert12PointMediaQA,
  assertMultiUserIsolation,
  assertSignedHMAC,
  assertDoublePostGuarded
};

export default CustomAssertions;
