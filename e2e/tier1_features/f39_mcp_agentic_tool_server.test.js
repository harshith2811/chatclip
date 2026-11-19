/**
 * e2e/tier1_features/f39_mcp_agentic_tool_server.test.js
 * Feature F39: MCP Agentic Tool Server Tier 1 Happy-Path Coverage Suite.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { E2ETestClient } from '../harness/client.js';
import { startTestServer, stopTestServer } from '../harness/mock_backend.js';
import { assertStatus } from '../harness/assertions.js';

describe('Feature F39: MCP Agentic Tool Server', () => {
  let serverInfo = null;
  let client = null;

  before(async () => {
    serverInfo = await startTestServer({ port: 0 });
    client = new E2ETestClient({ baseUrl: serverInfo.baseUrl });
  });

  after(async () => {
    await stopTestServer();
  });

  it('TC_F39_01: lists MCP tools over JSON-RPC 2.0 tools/list', async () => {
    const res = await client.post('/api/v1/mcp', {
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/list'
    });
    assertStatus(res, 200);
    assert.equal(res.data.jsonrpc, '2.0');
    assert.equal(res.data.id, 101);
    assert.ok(Array.isArray(res.data.result.tools));
    assert.ok(res.data.result.tools.length >= 2);
    assert.ok(res.data.result.tools[0].name);
    assert.ok(res.data.result.tools[0].description);
  });

  it('TC_F39_02: executes initialize handshake', async () => {
    const res = await client.post('/api/v1/mcp', {
      jsonrpc: '2.0',
      id: 102,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' }
    });
    assertStatus(res, 200);
    assert.equal(res.data.jsonrpc, '2.0');
    assert.equal(res.data.id, 102);
    assert.ok(res.data.result);
  });

  it('TC_F39_03: invokes tool discover_viral_clips via tools/call', async () => {
    const res = await client.post('/api/v1/mcp', {
      jsonrpc: '2.0',
      id: 103,
      method: 'tools/call',
      params: { name: 'discover_viral_clips', arguments: { limit: 5 } }
    });
    assertStatus(res, 200);
    assert.equal(res.data.id, 103);
    assert.ok(res.data.result);
  });

  it('TC_F39_04: invokes tool render_vertical_clip via tools/call', async () => {
    const res = await client.post('/api/v1/mcp', {
      jsonrpc: '2.0',
      id: 104,
      method: 'tools/call',
      params: {
        name: 'render_vertical_clip',
        arguments: { video_id: '0e3GPea1Tyg', start_sec: 10, end_sec: 35, layout: 'stacked' }
      }
    });
    assertStatus(res, 200);
    assert.equal(res.data.id, 104);
    assert.ok(res.data.result);
  });

  it('TC_F39_05: echoes client correlation ID across diverse types (string UUID vs int)', async () => {
    const customId = 'req_agent_uuid_98765';
    const res = await client.post('/api/v1/mcp', {
      jsonrpc: '2.0',
      id: customId,
      method: 'ping'
    });
    assertStatus(res, 200);
    assert.equal(res.data.id, customId);
    assert.equal(res.data.jsonrpc, '2.0');
  });
});
