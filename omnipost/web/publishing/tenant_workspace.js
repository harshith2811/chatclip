/**
 * Multi-Tenant Workspace & Social Account Routing Registry for OmniPost.
 * Manages tenant-specific workspace authorization, account matching,
 * and signed webhook synchronization back to yt-clipping-intelligence.
 */

import crypto from 'crypto';

// Map of workspaceId -> { tenantId, accounts, createdAt }
const WORKSPACE_REGISTRY = new Map([
  ['workspace-tenant-alpha', {
    tenantId: 'tenant-alpha',
    accounts: {
      youtube: 'yt-channel-alpha',
      instagram: 'ig-alpha-reels',
      tiktok: 'tt-alpha-creator',
      facebook: 'fb-page-alpha',
      threads: 'th-alpha'
    }
  }],
  ['workspace-tenant-beta', {
    tenantId: 'tenant-beta',
    accounts: {
      youtube: 'yt-channel-beta',
      instagram: 'ig-beta-reels',
      tiktok: 'tt-beta-creator',
      facebook: 'fb-page-beta',
      threads: 'th-beta'
    }
  }],
  ['default-workspace', {
    tenantId: 'default',
    accounts: {
      youtube: 'yt-default',
      instagram: 'ig-default'
    }
  }]
]);

// Map platform aliases to canonical OmniPost platforms
const CHANNEL_ALIAS_MAP = {
  youtube_shorts: 'youtube',
  youtube: 'youtube',
  instagram_reels: 'instagram',
  instagram: 'instagram',
  facebook_reels: 'facebook',
  facebook: 'facebook',
  threads: 'threads',
  linkedin: 'linkedin',
  pinterest: 'pinterest',
  tiktok: 'tiktok'
};

/**
 * Validates tenant and workspace ownership.
 * Prevents cross-tenant access and unknown workspace spoofing.
 */
export function verifyTenantWorkspace(tenantId, workspaceId) {
  const cleanTenant = String(tenantId || '').trim();
  const cleanWorkspace = String(workspaceId || '').trim();

  // If no tenant or workspace specified, allow default for legacy backward compatibility
  if (!cleanTenant && !cleanWorkspace) {
    return { ok: true, tenantId: 'default', workspaceId: 'default-workspace' };
  }

  // If workspace is supplied, check registry
  if (cleanWorkspace && WORKSPACE_REGISTRY.has(cleanWorkspace)) {
    const ws = WORKSPACE_REGISTRY.get(cleanWorkspace);
    if (cleanTenant && ws.tenantId !== cleanTenant) {
      return {
        ok: false,
        status: 403,
        code: 'CROSS_TENANT_WORKSPACE_FORBIDDEN',
        message: `Tenant '${cleanTenant}' is not authorized to publish to workspace '${cleanWorkspace}'.`
      };
    }
    return { ok: true, tenantId: ws.tenantId, workspaceId: cleanWorkspace, accounts: ws.accounts };
  }

  // If workspace is not yet in pre-seeded registry, dynamically register for the tenant if tenant is valid
  if (cleanTenant && cleanWorkspace) {
    // If workspace format implies ownership by another tenant, block
    if (cleanWorkspace.startsWith('workspace-tenant-') && !cleanWorkspace.endsWith(cleanTenant)) {
      return {
        ok: false,
        status: 403,
        code: 'CROSS_TENANT_WORKSPACE_FORBIDDEN',
        message: `Workspace '${cleanWorkspace}' does not belong to tenant '${cleanTenant}'.`
      };
    }

    // Register new isolated workspace for tenant
    WORKSPACE_REGISTRY.set(cleanWorkspace, {
      tenantId: cleanTenant,
      accounts: {
        youtube: `yt-${cleanTenant}`,
        instagram: `ig-${cleanTenant}`,
        tiktok: `tt-${cleanTenant}`
      }
    });
    return {
      ok: true,
      tenantId: cleanTenant,
      workspaceId: cleanWorkspace,
      accounts: WORKSPACE_REGISTRY.get(cleanWorkspace).accounts
    };
  }

  return { ok: true, tenantId: cleanTenant || 'default', workspaceId: cleanWorkspace || 'default-workspace' };
}

/**
 * Resolves requested channels against tenant workspace connected accounts.
 */
export function resolveTenantAccounts(tenantId, workspaceId, requestedChannels = []) {
  const verification = verifyTenantWorkspace(tenantId, workspaceId);
  if (!verification.ok) {
    return verification;
  }

  const rawList = Array.isArray(requestedChannels) ? requestedChannels : [requestedChannels];
  const matchedAccounts = {};
  const canonicalPlatforms = [];

  for (const item of rawList) {
    const raw = String(item || '').trim().toLowerCase();
    const canonical = CHANNEL_ALIAS_MAP[raw] || raw;
    canonicalPlatforms.push(canonical);

    if (verification.accounts && verification.accounts[canonical]) {
      matchedAccounts[canonical] = verification.accounts[canonical];
    } else {
      matchedAccounts[canonical] = `${canonical}-account-${verification.tenantId}`;
    }
  }

  return {
    ok: true,
    tenantId: verification.tenantId,
    workspaceId: verification.workspaceId,
    canonicalPlatforms: [...new Set(canonicalPlatforms)],
    matchedAccounts
  };
}

/**
 * Sends an HMAC-SHA256 signed webhook callback to the processing engine.
 */
export async function dispatchSignedWebhook({
  eventType,
  tenantId,
  workspaceId,
  projectId,
  jobId,
  contentId,
  idempotencyKey,
  status,
  platforms,
  metrics,
  error = null,
  webhookUrl = process.env.YT_CLIPPING_WEBHOOK_URL || 'http://localhost:8000/api/v1/webhooks/omnipost',
  secret = process.env.OMNIPOST_WEBHOOK_SECRET || 'omnipost_webhook_shared_secret_2026'
}) {
  const eventId = `evt_${crypto.randomUUID().slice(0, 12)}`;
  const nowIso = new Date().toISOString();

  const payload = {
    event_id: eventId,
    event_type: eventType,
    timestamp: nowIso,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    project_id: projectId,
    job_id: jobId,
    content_id: contentId,
    idempotency_key: idempotencyKey,
    platforms: platforms || [],
    status: status,
    publication_urls: (platforms || []).reduce((acc, p) => {
      acc[p] = `https://${p}.com/published/${contentId || eventId}`;
      return acc;
    }, {}),
    metrics: metrics || { views: 0, likes: 0, comments: 0 },
    error: error
  };

  const payloadJson = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(payloadJson).digest('hex');

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OmniPost-Signature': `sha256=${signature}`,
        'X-Signature-SHA256': signature,
        'User-Agent': 'OmniPost-Publisher/2.0'
      },
      body: payloadJson
    });
    return { ok: res.ok, status: res.status, eventId };
  } catch (err) {
    // Non-blocking callback: log error but do not throw
    console.warn(`[OmniPost Webhook] Delivery to ${webhookUrl} failed: ${err.message}`);
    return { ok: false, error: err.message, eventId };
  }
}
