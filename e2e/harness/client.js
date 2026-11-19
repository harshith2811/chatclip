/**
 * e2e/harness/client.js
 * Declarative, zero-dependency E2E Test Client for YouTube Clipping Intelligence & OmniPost.
 * Uses native Node 22 fetch, node:crypto, and node:http.
 */

import crypto from 'node:crypto';

export class E2EClient {
  constructor(options = {}) {
    const defaultBase = options.baseUrl || 'http://127.0.0.1:8000';
    this.fastApiUrl = (
      options.fastApiUrl ||
      options.baseUrlFastApi ||
      options.baseUrl ||
      process.env.E2E_BASE_URL_FASTAPI ||
      process.env.FASTAPI_URL ||
      'http://127.0.0.1:8000'
    ).replace(/\/$/, '');

    this.omniPostUrl = (
      options.omniPostUrl ||
      options.baseUrlOmniPost ||
      options.baseUrl ||
      process.env.E2E_BASE_URL_OMNIPOST ||
      process.env.OMNIPOST_URL ||
      'http://127.0.0.1:3300'
    ).replace(/\/$/, '');

    this.timeout = options.timeout || 15000;

    const workspaceId = options.workspaceId || 'workspace_default';
    const userId = options.userId || 'user_admin';
    const userRole = options.userRole || 'admin';

    this.headers = {
      'content-type': 'application/json',
      'x-workspace-id': workspaceId,
      'x-user-id': userId,
      'x-user-role': userRole,
      ...(options.headers || {})
    };

    if (options.apiKey) {
      this.headers['authorization'] = `Bearer ${options.apiKey}`;
      this.headers['x-api-key'] = options.apiKey;
    }

    if (options.tenantId) {
      this.headers['x-tenant-id'] = options.tenantId;
    }

    if (options.tenantKey) {
      this.headers['x-tenant-key'] = options.tenantKey;
    }
  }

  // --- Identity Scoping ---

  /**
   * Clone client scoped to a specific team member identity.
   */
  asUser(userId, role = 'editor', workspaceId = 'workspace_default') {
    return new E2EClient({
      fastApiUrl: this.fastApiUrl,
      omniPostUrl: this.omniPostUrl,
      timeout: this.timeout,
      headers: {
        ...this.headers,
        'x-workspace-id': workspaceId,
        'x-user-id': userId,
        'x-user-role': role
      }
    });
  }

  /**
   * Clone client scoped to a specific multi-tenant identity.
   */
  asTenant(tenantId, apiKey) {
    return new E2EClient({
      fastApiUrl: this.fastApiUrl,
      omniPostUrl: this.omniPostUrl,
      timeout: this.timeout,
      headers: {
        ...this.headers,
        'x-tenant-key': apiKey,
        'x-tenant-id': tenantId,
        'authorization': `Bearer ${apiKey}`
      }
    });
  }

  /**
   * Clone client scoped to an elevated administrative session.
   */
  asAdmin(apiKey = process.env.WEB_STUDIO_API_KEY || 'test_admin_key') {
    return new E2EClient({
      fastApiUrl: this.fastApiUrl,
      omniPostUrl: this.omniPostUrl,
      timeout: this.timeout,
      headers: {
        ...this.headers,
        'x-user-role': 'admin',
        'authorization': `Bearer ${apiKey}`,
        'x-admin-key': apiKey,
        'x-api-key': apiKey
      }
    });
  }

  // --- Low-Level Request Execution ---

  async request(baseUrl, endpoint, options = {}) {
    const url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    const headers = { ...this.headers, ...(options.headers || {}) };

    if (options.body && typeof FormData !== 'undefined' && options.body instanceof FormData) {
      delete headers['content-type'];
      delete headers['Content-Type']; // Let runtime set multipart boundary
    }

    const controller = new AbortController();
    const timeoutMs = options.timeout || this.timeout;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        signal: controller.signal
      });

      const contentType = res.headers.get('content-type') || '';
      let data = null;

      if (contentType.includes('application/json')) {
        data = await res.json().catch(() => null);
      } else if (contentType.includes('text/')) {
        data = await res.text().catch(() => null);
      } else {
        const arrayBuf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
        data = Buffer.from(arrayBuf);
      }

      return {
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        data,
        rawResponse: res
      };
    } finally {
      clearTimeout(timer);
    }
  }

  fastApi(endpoint, options = {}) {
    return this.request(this.fastApiUrl, endpoint, options);
  }

  omni(endpoint, options = {}) {
    return this.request(this.omniPostUrl, endpoint, options);
  }

  // Generic HTTP verbs
  get(endpoint, options = {}) {
    return this.fastApi(endpoint, { ...options, method: 'GET' });
  }

  post(endpoint, body = {}, options = {}) {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    return this.fastApi(endpoint, {
      ...options,
      method: 'POST',
      body: isForm ? body : (typeof body === 'string' ? body : JSON.stringify(body))
    });
  }

  put(endpoint, body = {}, options = {}) {
    return this.fastApi(endpoint, {
      ...options,
      method: 'PUT',
      body: typeof body === 'string' ? body : JSON.stringify(body)
    });
  }

  delete(endpoint, options = {}) {
    return this.fastApi(endpoint, { ...options, method: 'DELETE' });
  }

  upload(endpoint, formData, options = {}) {
    return this.post(endpoint, formData, options);
  }

  // --- Core API Operations (FastAPI) ---

  getHealth() {
    return this.fastApi('/api/v1/health');
  }

  getMetadata(videoIdOrUrl) {
    return this.fastApi('/api/v1/metadata', {
      method: 'POST',
      body: JSON.stringify({ video_id_or_url: videoIdOrUrl })
    });
  }

  getPreview(videoIdOrUrl, minDuration = 15, maxDuration = 60) {
    return this.fastApi('/api/v1/preview', {
      method: 'POST',
      body: JSON.stringify({
        video_id_or_url: videoIdOrUrl,
        min_duration: minDuration,
        max_duration: maxDuration
      })
    });
  }

  renderVideo(req, options = {}) {
    const payload = typeof req === 'string'
      ? { video_id_or_url: req, ...options }
      : req;
    return this.fastApi('/api/v1/render', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  getRenderStatus(taskId) {
    return this.fastApi(`/api/v1/render/status/${taskId}`);
  }

  getJob(jobId) {
    return this.fastApi(`/api/v1/jobs/${jobId}`);
  }

  cancelJob(jobId) {
    return this.fastApi(`/api/v1/jobs/${jobId}/cancel`, { method: 'POST' });
  }

  listClips(projectId) {
    return this.fastApi(projectId ? `/api/v1/clips?project_id=${projectId}` : '/api/v1/clips');
  }

  getClip(clipId) {
    return this.fastApi(`/api/v1/clips/${clipId}`);
  }

  getClipPoster(clipId) {
    return this.fastApi(`/api/v1/clips/${clipId}/poster`);
  }

  regenerateCaption(clipId) {
    return this.fastApi(`/api/v1/clips/${clipId}/regenerate_caption`, { method: 'POST' });
  }

  listProjects() {
    return this.fastApi('/api/v1/projects');
  }

  getProject(projectId) {
    return this.fastApi(`/api/v1/projects/${projectId}`);
  }

  deleteProject(projectId) {
    return this.fastApi(`/api/v1/projects/${projectId}`, { method: 'DELETE' });
  }

  editorPreviewFrame(filePath, timestamp = 0.0) {
    return this.fastApi('/api/v1/editor/preview-frame', {
      method: 'POST',
      body: JSON.stringify({ file_path: filePath, timestamp })
    });
  }

  editorExport(exportReq) {
    return this.fastApi('/api/v1/editor/export', {
      method: 'POST',
      body: JSON.stringify(exportReq)
    });
  }

  editorWaveform(filePath) {
    return this.fastApi('/api/v1/editor/waveform', {
      method: 'POST',
      body: JSON.stringify({ file_path: filePath })
    });
  }

  getGovernorStatus() {
    return this.fastApi('/api/v1/system/governor-status');
  }

  getLegalOfficer() {
    return this.fastApi('/api/v1/config/legal-officer');
  }

  setLegalOfficer(enabled) {
    return this.fastApi('/api/v1/config/legal-officer', {
      method: 'POST',
      body: JSON.stringify({ enabled })
    });
  }

  registerRights(rightsReq) {
    return this.fastApi('/api/v1/rights/register', {
      method: 'POST',
      body: JSON.stringify(rightsReq)
    });
  }

  revokeRights(revokeReq) {
    return this.fastApi('/api/v1/rights/revoke', {
      method: 'POST',
      body: JSON.stringify(revokeReq)
    });
  }

  getRightsAudit(videoId, limit = 100) {
    const q = videoId ? `video_id=${videoId}&limit=${limit}` : `limit=${limit}`;
    return this.fastApi(`/api/v1/rights/audit?${q}`);
  }

  publishSubmit(submitReq) {
    return this.fastApi('/api/v1/publish/submit', {
      method: 'POST',
      body: JSON.stringify(submitReq)
    });
  }

  getPublishHistory(limit = 50) {
    return this.fastApi(`/api/v1/publish/history?limit=${limit}`);
  }

  getPublishStatus(receiptId) {
    return this.fastApi(`/api/v1/publish/status/${receiptId}`);
  }

  externalAiIngest(payload, tenantKey) {
    const headers = tenantKey ? { 'X-Tenant-Key': tenantKey } : {};
    return this.fastApi('/api/v1/external/ai-video/ingest', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  }

  getExternalAiJobStatus(jobId, tenantKey) {
    const headers = tenantKey ? { 'X-Tenant-Key': tenantKey } : {};
    return this.fastApi(`/api/v1/external/ai-video/status/${jobId}`, { headers });
  }

  getTop10mTrending(limit = 15, filterMode = 'all') {
    return this.fastApi(`/api/v1/trending/top10m?limit=${limit}&filter_mode=${filterMode}`);
  }

  // --- OmniPost API Operations ---

  getOmniPreflight(authKey) {
    const headers = authKey ? { 'x-api-key': authKey } : {};
    return this.omni('/api/engine/preflight', { headers });
  }

  getOmniChannels(authKey) {
    const headers = authKey ? { 'x-api-key': authKey } : {};
    return this.omni('/api/channels', { headers });
  }

  omniIngest(formDataOrJson, options = {}) {
    const isForm = typeof FormData !== 'undefined' && formDataOrJson instanceof FormData;
    return this.omni('/api/v2/ingest', {
      method: 'POST',
      headers: options.headers,
      body: isForm ? formDataOrJson : JSON.stringify(formDataOrJson)
    });
  }

  omniRevokeRights(payload, authKey) {
    const headers = authKey ? { 'x-api-key': authKey } : {};
    return this.omni('/api/v2/rights/revoke', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  }

  getOmniOpsHealth(authKey) {
    const headers = authKey ? { 'x-api-key': authKey } : {};
    return this.omni('/api/v2/health/ops', { headers });
  }

  // --- Range Streaming Support (HTTP 206) ---

  async getMediaWithRange(clipId, startByte, endByte) {
    return this.requestRange(`/api/v1/clips/${clipId}/media`, startByte, endByte);
  }

  async requestRange(path, startByte, endByte, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (startByte !== undefined && startByte !== null) {
      headers['Range'] = `bytes=${startByte}-${endByte !== undefined && endByte !== null ? endByte : ''}`;
    }

    const res = await this.fastApi(path, { ...options, headers });
    const contentRange = res.headers.get('content-range') || '';
    const contentLength = res.headers.get('content-length') ? parseInt(res.headers.get('content-length'), 10) : null;

    let totalLength = null;
    if (contentRange) {
      const match = contentRange.match(/\/(\d+|\*)$/);
      if (match && match[1] !== '*') {
        totalLength = parseInt(match[1], 10);
      }
    }

    let buf = Buffer.alloc(0);
    if (Buffer.isBuffer(res.data)) {
      buf = res.data;
    } else if (typeof res.data === 'string') {
      buf = Buffer.from(res.data);
    } else if (res.data) {
      buf = Buffer.from(JSON.stringify(res.data));
    }

    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      contentRange,
      contentLength,
      totalLength,
      buffer: buf,
      data: res.data,
      rawResponse: res.rawResponse
    };
  }

  // --- Server-Sent Events (SSE) Listener ---

  async listenJobStream(jobId, options = {}) {
    return this.streamSSE(`/api/v1/jobs/${jobId}/stream`, options);
  }

  async streamSSE(path, { timeoutMs = 15000, maxEvents = 20, onEvent, abortOnEvent = 'end' } = {}) {
    const url = `${this.fastApiUrl}${path.startsWith('/') ? path : '/' + path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const events = [];

    try {
      const res = await fetch(url, {
        headers: {
          ...this.headers,
          'Accept': 'text/event-stream'
        },
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`SSE request failed with status ${res.status}: ${res.statusText}`);
      }

      if (!res.body) {
        return events;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (events.length < maxEvents) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          if (!block.trim()) continue;

          let eventType = 'message';
          let eventData = null;
          let eventId = null;

          for (const line of block.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('event:')) {
              eventType = trimmed.slice(6).trim();
            } else if (trimmed.startsWith('id:')) {
              eventId = trimmed.slice(3).trim();
            } else if (trimmed.startsWith('data:')) {
              const rawData = trimmed.slice(5).trim();
              try {
                eventData = JSON.parse(rawData);
              } catch {
                eventData = rawData;
              }
            }
          }

          const eventObj = { event: eventType, data: eventData, id: eventId };
          events.push(eventObj);
          if (onEvent) onEvent(eventObj);

          if (abortOnEvent && eventType === abortOnEvent) {
            reader.cancel().catch(() => {});
            return events;
          }
          if (eventType === 'error') {
            reader.cancel().catch(() => {});
            return events;
          }
        }
      }

      reader.cancel().catch(() => {});
    } catch (err) {
      if (err.name !== 'AbortError') {
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }

    return events;
  }

  // --- HMAC Webhook Support ---

  async sendSignedOmniPostWebhook(payload, { secret = 'omnipost_webhook_shared_secret_2026', customSignature } = {}) {
    return this.sendSignedWebhook('/api/v1/webhooks/omnipost', payload, secret, { customSignature });
  }

  async sendSignedWebhook(path, payload, secret, { customSignature, customHeaders = {} } = {}) {
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const signature = customSignature !== undefined
      ? customSignature
      : crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');

    const headers = {
      'Content-Type': 'application/json',
      'X-OmniPost-Signature': signature ? `sha256=${signature}` : '',
      'X-Signature-SHA256': signature || '',
      'User-Agent': 'OmniPost-Publisher/2.0',
      ...customHeaders
    };

    return this.fastApi(path, {
      method: 'POST',
      headers,
      body: payloadStr
    });
  }
}

// Alias for flexibility across caller conventions
export const E2ETestClient = E2EClient;
