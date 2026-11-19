import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import * as db from './db.js';
// Adapters are reached through the registry, which is the single source of
// truth for which channels exist and what each one needs.
import * as registry from './publishing/registry.js';
import * as preflight from './publishing/preflight.js';
import * as publishState from './publishing/state.js';
import { selectDue } from './publishing/schedule.js';
import * as authz from './auth.js';
import { createN8nClient, multipartBody } from './n8n-client.js';

// Multi-Tenant Workspace & Social Account Routing Registry
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

function verifyTenantWorkspace(tenantId, workspaceId) {
  const cleanTenant = String(tenantId || '').trim();
  const cleanWorkspace = String(workspaceId || '').trim();

  if (!cleanTenant && !cleanWorkspace) {
    return { ok: true, tenantId: 'default', workspaceId: 'default-workspace' };
  }

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

  if (cleanTenant && cleanWorkspace) {
    if (cleanWorkspace.startsWith('workspace-tenant-') && !cleanWorkspace.endsWith(cleanTenant)) {
      return {
        ok: false,
        status: 403,
        code: 'CROSS_TENANT_WORKSPACE_FORBIDDEN',
        message: `Workspace '${cleanWorkspace}' does not belong to tenant '${cleanTenant}'.`
      };
    }

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

function resolveTenantAccounts(tenantId, workspaceId, requestedChannels = []) {
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

async function dispatchSignedWebhook({
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
    console.warn(`[OmniPost Webhook] Delivery to ${webhookUrl} failed: ${err.message}`);
    return { ok: false, error: err.message, eventId };
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
// PORT is injected by hosts like Render and must win; WEB_PORT is the local
// docker-compose setting.
const PORT = process.env.PORT || process.env.WEB_PORT || 3300;

// Persistent Storage & Temporary Staging
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const MEDIA_UPLOADS_DIR = path.join(UPLOADS_DIR, 'media');
const STAGING_DIR = process.env.OMNIPOST_STAGING_DIR || (process.env.OMNIPOST_DATA_DIR ? path.join(process.env.OMNIPOST_DATA_DIR, 'staging') : path.join(os.tmpdir(), 'omnipost-upload-staging'));

// ---------------------------------------------------------------------------
// Rights Compliance, SSRF Defense & Idempotent V2 Ingest Helpers
// ---------------------------------------------------------------------------
const revokedAssetIds = new Set();
const ingestIdempotencyCache = new Map();

const VALID_COMPLIANCE_BASES = new Set([
  'OWNED',
  'EXPLICIT_PERMISSION',
  'CREATIVE_COMMONS',
  'VERIFIED_LICENSE',
  'COMMENTARY_TRANSFORM',
  'AI_GENERATED_ORIGINAL'
]);

function isLegalOfficerEnabled() {
  const raw = process.env.LEGAL_OFFICER;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return true;
  }
  return !['false', '0', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

function isPrivateOrReservedIp(ip) {
  if (!ip) return true;
  const clean = String(ip).trim().toLowerCase();
  const mappedV4 = clean.startsWith('::ffff:') ? clean.slice(7) : clean;
  if (net.isIPv4(mappedV4)) {
    const parts = mappedV4.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (clean === '::1' || clean === '::') return true;
  if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) return true;
  return false;
}

async function assertSafeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return { ok: true };
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, status: 400, code: 'INVALID_URL', message: 'Invalid external URL format.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, status: 400, code: 'SSRF_BLOCKED', message: `Disallowed URL scheme: ${parsed.protocol}` };
  }
  const host = (parsed.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === '0.0.0.0' || host === 'metadata.google.internal' || host === '169.254.169.254') {
    return { ok: false, status: 400, code: 'SSRF_BLOCKED', message: `Internal or loopback host rejected: ${host}` };
  }
  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      return { ok: false, status: 400, code: 'SSRF_BLOCKED', message: `Private or reserved IP address rejected: ${host}` };
    }
    return { ok: true };
  }
  try {
    const records = await dns.promises.lookup(host, { all: true });
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        return { ok: false, status: 400, code: 'SSRF_BLOCKED', message: `Hostname resolves to private/reserved IP (${rec.address})` };
      }
    }
  } catch {
    // Offline DNS lookup unavailable for non-literal domain; hostname checks above still apply.
  }
  return { ok: true };
}

function parseMaybeJson(val) {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return val;
  }
}

async function validateCompliancePayload(body, { requireAllFields = false } = {}) {
  const payload = body || {};
  const strictEnv = process.env.OMNIPOST_REQUIRE_RIGHTS_MANIFEST === 'true';
  const enforceStrict = requireAllFields || strictEnv;

  const rawManifest = parseMaybeJson(payload.rights_manifest ?? payload.rightsManifest);
  const rawAttr = parseMaybeJson(payload.attribution);
  const videoId = String(rawManifest?.video_id || rawManifest?.videoId || payload.video_id || payload.videoId || '').trim();
  const assetId = String(payload.asset_id || payload.assetId || rawManifest?.rights_id || '').trim();
  const contentId = String(payload.content_id || payload.contentId || '').trim();

  // Always enforce SSRF protection on external URLs even when LEGAL_OFFICER=false
  const candidateUrl = payload.mediaUrl || payload.public_media_url || payload.media_url || '';
  if (candidateUrl) {
    const ssrfCheck = await assertSafeExternalUrl(candidateUrl);
    if (!ssrfCheck.ok) return ssrfCheck;
  }

  const rawApproved = payload.approved_by_user ?? payload.approvedByUser;
  const approvedBool = rawApproved === true || rawApproved === 'true';

  if (!isLegalOfficerEnabled()) {
    return {
      ok: true,
      legalOfficerBypass: true,
      rightsManifest: rawManifest && typeof rawManifest === 'object' ? rawManifest : null,
      attribution: rawAttr,
      approvedByUser: approvedBool,
      videoId,
      assetId
    };
  }

  if ((videoId && revokedAssetIds.has(videoId)) || (assetId && revokedAssetIds.has(assetId)) || (contentId && revokedAssetIds.has(contentId))) {
    return { ok: false, status: 403, code: 'RIGHTS_REVOKED', message: 'Rights for this asset have been revoked.' };
  }

  if (rawApproved === false || rawApproved === 'false') {
    return { ok: false, status: 403, code: 'HUMAN_APPROVAL_REQUIRED', message: 'Explicit human approval (approved_by_user=true) is required.' };
  }

  if (rawManifest && typeof rawManifest === 'object') {
    const basis = String(rawManifest.basis || '').toUpperCase();
    const status = String(rawManifest.status || '').toUpperCase();
    if (basis === 'OPERATOR_ASSET') {
      return { ok: false, status: 403, code: 'INVALID_RIGHTS_BASIS', message: 'OPERATOR_ASSET is forbidden from bypassing rights verification.' };
    }
    if (status !== 'VERIFIED') {
      return { ok: false, status: 403, code: 'RIGHTS_NOT_VERIFIED', message: `Rights status '${status || 'UNKNOWN'}' is not VERIFIED.` };
    }
    if (!VALID_COMPLIANCE_BASES.has(basis)) {
      return { ok: false, status: 403, code: 'INVALID_RIGHTS_BASIS', message: `Unsupported rights basis '${basis}'.` };
    }
    const evidence = String(rawManifest.proof_reference || rawManifest.license_url || rawManifest.licenseUrl || '').trim();
    if (enforceStrict && !evidence) {
      return { ok: false, status: 403, code: 'MISSING_EVIDENCE', message: 'Verified rights manifest requires proof_reference or license_url.' };
    }
  } else if (enforceStrict) {
    return { ok: false, status: 403, code: 'MISSING_RIGHTS_MANIFEST', message: 'Rights manifest is required.' };
  }

  const attrText = typeof rawAttr === 'string' ? rawAttr.trim() : (rawAttr?.text || rawAttr?.creator_name || rawAttr?.source_url || '').trim();
  if (enforceStrict && !attrText) {
    return { ok: false, status: 403, code: 'MISSING_ATTRIBUTION', message: 'Attribution information is required.' };
  }

  return {
    ok: true,
    legalOfficerBypass: false,
    rightsManifest: rawManifest && typeof rawManifest === 'object' ? rawManifest : null,
    attribution: rawAttr,
    approvedByUser: approvedBool,
    videoId,
    assetId
  };
}

function isPostRightsRevoked(post) {
  if (!post) return false;
  const ids = [
    post['Video ID'], post.video_id, post.videoId,
    post['Asset ID'], post.asset_id, post.assetId,
    post['Content ID'], post.content_id, post.contentId
  ].map(v => String(v || '').trim()).filter(Boolean);
  return ids.some(id => revokedAssetIds.has(id));
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const optionalSingleUpload = (req, res, next) => {
  const ctype = String(req.headers['content-type'] || '');
  if (ctype.includes('multipart/form-data')) {
    return upload.single('file')(req, res, next);
  }
  return next();
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(MEDIA_UPLOADS_DIR)) fs.mkdirSync(MEDIA_UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });

// Quiet warning tracker for offline n8n
let lastN8nOfflineNotice = 0;

/**
 * Normalises a base URL.
 */
function normaliseBase(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return (value.includes('.') && !/:\d+$/.test(value) ? 'https://' : 'http://') + value;
}

const N8N_INTERNAL_URL = normaliseBase(process.env.N8N_INTERNAL_URL) || 'http://n8n-automation:5678';
const N8N_PUBLIC_URL = normaliseBase(process.env.N8N_PUBLIC_URL || process.env.N8N_EXTERNAL_URL);

export function n8nCandidates() {
  return [...new Set([
    N8N_INTERNAL_URL,
    'http://127.0.0.1:5678',
    'http://localhost:5678',
    N8N_PUBLIC_URL
  ].filter(Boolean))];
}

// Security Headers: Block Search Engine Crawlers & Prevent Clickjacking
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Explicit Robots.txt: Instruct all search crawlers to never index this domain
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /\n');
});

/**
 * CORS allow-list.
 * Allows universal wiring from external websites, CMS frontends, and microservices.
 */
const ALLOWED_ORIGINS = [
  process.env.APP_URL,
  process.env.RENDER_EXTERNAL_URL,
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3300',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3300',
  ...String(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_EXTRA_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
].filter(Boolean).map(o => o.replace(/\/+$/, ''));

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (isAllowedOrigin(origin)) return callback(null, true);
    console.warn(`[CORS] Refused origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true
}));

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve built React assets in production
app.use(express.static(path.join(__dirname, 'dist')));

// ---------------------------------------------------------------------------
// DEF-18: Secure Uploads Route Architecture
// 1. /uploads/media/* : Public whitelisted social media assets (zero-RAM publishing)
// 2. /uploads/*       : Protected client legal vault (auth or signed URL required)
// ---------------------------------------------------------------------------
const PUBLIC_MEDIA_EXTS = new Set([
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.wmv',
  '.jpg', '.jpeg', '.png', '.webp', '.gif'
]);

// 1. Public Media Subdirectory Handler
app.get('/uploads/media/:filename(*)', (req, res) => {
  const filename = req.params.filename;
  if (!filename) return res.status(404).json({ success: false, message: 'File not found' });

  const ext = path.extname(filename).toLowerCase();
  if (!PUBLIC_MEDIA_EXTS.has(ext)) {
    return res.status(403).json({ success: false, message: 'Access to this file type is forbidden' });
  }

  const safePath = path.resolve(MEDIA_UPLOADS_DIR, filename);
  const relative = path.relative(MEDIA_UPLOADS_DIR, safePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
    return res.status(404).json({ success: false, message: 'Media not found' });
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(safePath);
});

// 2. Protected Vault & General Uploads Handler
app.get('/uploads/:filepath(*)', async (req, res) => {
  const rawPath = req.params.filepath;
  if (!rawPath) return res.status(404).json({ success: false, message: 'File not found' });

  const safePath = path.resolve(UPLOADS_DIR, rawPath);
  const relative = path.relative(UPLOADS_DIR, safePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  // Check Option A: Signed URL query parameters
  const { sig, exp } = req.query;
  const isSigned = authz.verifyVaultSignedUrl(req.path, sig, exp, SESSION_KEY);

  // Check Option B: Authentication headers / session
  let identity;
  try {
    identity = await resolver.resolve(req);
  } catch (err) {
    identity = { roles: [] };
  }

  const roles = identity?.roles || [];
  const hasChambersRole = roles.includes('chambers');

  // Authorization check MUST precede any file system existence check
  // to prevent unauthenticated enumeration of confidential documents (CWE-203).
  if (!isSigned && !hasChambersRole) {
    const authenticated = roles.length > 0;
    return res.status(authenticated ? 403 : 401).json({
      success: false,
      code: authenticated ? 'FORBIDDEN' : 'UNAUTHORIZED',
      message: authenticated
        ? 'Access to chambers client documents requires the chambers role.'
        : 'Authentication or a valid signed document link is required.'
    });
  }

  // Only check filesystem AFTER requester is authorized
  if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(safePath);
});

// Authentication & Role-Based Access Control
const LEGACY_ADMIN_KEY = (process.env.ADMIN_SECRET_KEY || '').trim();
const CONFIGURED_CHAMBERS_KEY = (process.env.CHAMBERS_ADMIN_SECRET_KEY || LEGACY_ADMIN_KEY || '').trim();
const AUTOMATION_KEY = (process.env.AUTOMATION_SECRET_KEY || '').trim();

const isProduction = process.env.NODE_ENV === 'production';
const allowInsecureDevKeys = process.env.ALLOW_INSECURE_DEV_KEYS === 'true';

let CHAMBERS_KEY = CONFIGURED_CHAMBERS_KEY || null;
if (!CHAMBERS_KEY) {
  if (isProduction || !allowInsecureDevKeys) {
    CHAMBERS_KEY = null;
    if (isProduction) {
      console.warn('[Security] WARN: No CHAMBERS_ADMIN_SECRET_KEY configured in production. Chambers admin passkey access is DISABLED.');
    } else {
      console.info('[Security] INFO: No CHAMBERS_ADMIN_SECRET_KEY configured. Development fallback is disabled by default. Set ALLOW_INSECURE_DEV_KEYS=true to enable fallback key.');
    }
  } else {
    CHAMBERS_KEY = 'omnipost2026';
    console.warn('[Security] CRITICAL WARNING: ALLOW_INSECURE_DEV_KEYS is enabled. Using hardcoded fallback chambers key. NEVER use this configuration in production!');
  }
}

const ROLE_GRANTS = authz.ROLE_GRANTS;
const keyMatches = authz.keyMatches;

const supabaseVerifier = authz.supabaseJwtVerifier(db.supabase);
if (supabaseVerifier) {
  console.log('[Auth] Supabase Auth enabled - session JWTs accepted alongside passkeys.');
}

const SESSION_KEY = (CHAMBERS_KEY || AUTOMATION_KEY)
  ? authz.sessionSigningKey(CHAMBERS_KEY, AUTOMATION_KEY)
  : crypto.randomBytes(32);
const resolver = authz.createResolver({
  chambersKey: CHAMBERS_KEY,
  automationKey: AUTOMATION_KEY,
  verifySupabaseJwt: supabaseVerifier,
  supabaseVerifier,
  sessionKey: SESSION_KEY
});

async function rolesFor(req) {
  const result = await resolver.resolve(req);
  req.authIdentity = result;
  return result.roles;
}

function requireRole(role) {
  return async function roleGuard(req, res, next) {
    let identity = req.authIdentity;
    if (!identity) {
      try {
        identity = await resolver.resolve(req);
        req.authIdentity = identity;
      } catch (err) {
        console.error('[Auth] Guard failed closed:', err.message);
        return res.status(401).json({
          success: false,
          code: 'AUTH_FAILED',
          message: 'Authentication failed.'
        });
      }
    }

    const roles = identity.roles;
    if (roles.includes(role)) {
      return next();
    }

    const authenticated = roles.length > 0;
    return res.status(authenticated ? 403 : 401).json({
      success: false,
      code: authenticated ? 'FORBIDDEN' : 'UNAUTHORIZED',
      message: authenticated
        ? `This endpoint requires the ${role} role.`
        : 'A valid passkey or session token is required.'
    });
  };
}

const requireChambers = requireRole('chambers');
const requireAutomation = requireRole('automation');
const requireAdminAuth = requireChambers;

// Auth endpoints
app.post('/api/auth/login', (req, res) => {
  const { passcode } = req.body;
  if (!passcode) {
    return res.status(400).json({ success: false, message: 'Passcode is required' });
  }

  const entered = String(passcode).trim();
  const roles = authz.rolesForPasskey(entered, {
    chambersKey: CHAMBERS_KEY,
    chambersPasskey: CHAMBERS_KEY,
    automationKey: AUTOMATION_KEY,
    automationPasskey: AUTOMATION_KEY,
    editorKey: (process.env.EDITOR_SECRET_KEY || process.env.EDITOR_PASSKEY || '').trim(),
    editorPasskey: (process.env.EDITOR_SECRET_KEY || process.env.EDITOR_PASSKEY || '').trim(),
    viewerKey: (process.env.VIEWER_SECRET_KEY || process.env.VIEWER_PASSKEY || '').trim(),
    viewerPasskey: (process.env.VIEWER_SECRET_KEY || process.env.VIEWER_PASSKEY || '').trim()
  });

  if (!roles.length) {
    return res.status(401).json({
      success: false,
      message: 'Invalid access key. Please check your credentials.'
    });
  }

  const role = roles.includes('chambers')
    ? 'chambers'
    : roles.includes('editor')
      ? 'editor'
      : roles.includes('viewer')
        ? 'viewer'
        : 'automation';
  const token = authz.mintSessionToken(role, SESSION_KEY);

  return res.json({
    success: true,
    token,
    role,
    roles,
    message: 'Authentication successful'
  });
});

app.get('/api/auth/verify', requireAutomation, (req, res) => {
  res.json({
    success: true,
    authenticated: true,
    roles: req.authIdentity?.roles || []
  });
});

// Dynamic Platform & Brand Configuration Endpoint
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    appName: process.env.APP_NAME || 'OmniPost Automation Suite',
    appSubtitle: process.env.APP_SUBTITLE || 'Unified Multi-Platform Video & Social Automation',
    organizationName: process.env.APP_ORGANIZATION || 'Digital Media Publishing',
    logoUrl: process.env.APP_LOGO_URL || '',
    enableClientVault: false,
    quickTags: (process.env.DEFAULT_HASHTAGS || '#Video,#Trending,#ContentCreator,#SocialMedia,#Automation')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean),
    captionPlaceholder: process.env.CAPTION_PLACEHOLDER || 'Write compelling post copy, video description, call-to-action, and links...',
    sheetUrl: process.env.GOOGLE_SHEETS_URL || '',
    driveFolderUrl: process.env.GOOGLE_DRIVE_FOLDER_URL || '',
    timezone: process.env.TZ || 'Asia/Kolkata',
    supportedPlatforms: registry.ALL_PLATFORMS
  });
});

// ---------------------------------------------------------------------------
// Universal Inbound REST API (v1) - Wireable to ANY Website, CMS or Platform
// ---------------------------------------------------------------------------
app.post('/api/v1/publish', requireAutomation, async (req, res) => {
  try {
    const { title, caption, mediaUrl, mediaType, platforms, link } = req.body || {};
    if (!title && !caption) {
      return res.status(400).json({ success: false, message: 'Title or caption is required' });
    }

    const requestedPlatforms = Array.isArray(platforms) && platforms.length
      ? platforms
      : registry.ALL_PLATFORMS;

    const check = registry.validatePlatforms(requestedPlatforms);
    if (!check.valid) {
      return res.status(400).json({ success: false, message: check.error });
    }

    const contentId = 'P-' + String(Date.now()).slice(-8);
    const resolvedMediaType = mediaType || (/\.(mp4|mov|avi|webm|mkv|m4v)(\?.*)?$/i.test(mediaUrl || '') ? 'video' : (mediaUrl ? 'image' : 'text'));
    const newPost = {
      'Content ID': contentId,
      'content_id': contentId,
      'Title': (title || '').trim(),
      'Caption': (caption || '').trim(),
      'Platforms': check.platforms.join(','),
      'Scheduled DateTime': new Date().toISOString(),
      'Status': 'Approved for Posting',
      'Public Media URL': mediaUrl || '',
      'public_media_url': mediaUrl || '',
      'Media Type': resolvedMediaType,
      'media_type': resolvedMediaType,
      'mediaType': resolvedMediaType,
      'Link': link || '',
      'link': link || ''
    };

    await db.savePost(newPost);
    const result = await advanceCalendarEntry(contentId, 1);

    return res.json({
      success: true,
      contentId,
      status: result?.rollup || 'Queued',
      settled: Boolean(result?.settled),
      states: result?.states || {}
    });
  } catch (err) {
    console.error('[API v1 Publish] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/v1/schedule', requireAutomation, async (req, res) => {
  try {
    const { title, caption, mediaUrl, mediaType, platforms, scheduledDateTime, link } = req.body || {};
    if (!title && !caption) {
      return res.status(400).json({ success: false, message: 'Title or caption is required' });
    }

    const requestedPlatforms = Array.isArray(platforms) && platforms.length
      ? platforms
      : registry.ALL_PLATFORMS;

    const check = registry.validatePlatforms(requestedPlatforms);
    if (!check.valid) {
      return res.status(400).json({ success: false, message: check.error });
    }

    const contentId = 'P-' + String(Date.now()).slice(-8);
    const resolvedMediaType = mediaType || (/\.(mp4|mov|avi|webm|mkv|m4v)(\?.*)?$/i.test(mediaUrl || '') ? 'video' : (mediaUrl ? 'image' : 'text'));
    const newPost = {
      'Content ID': contentId,
      'content_id': contentId,
      'Title': (title || '').trim(),
      'Caption': (caption || '').trim(),
      'Platforms': check.platforms.join(','),
      'Scheduled DateTime': scheduledDateTime || new Date().toISOString(),
      'Status': 'Scheduled',
      'Public Media URL': mediaUrl || '',
      'public_media_url': mediaUrl || '',
      'Media Type': resolvedMediaType,
      'media_type': resolvedMediaType,
      'mediaType': resolvedMediaType,
      'Link': link || '',
      'link': link || ''
    };

    await db.savePost(newPost);

    return res.json({
      success: true,
      contentId,
      status: 'Scheduled',
      scheduledDateTime: newPost['Scheduled DateTime']
    });
  } catch (err) {
    console.error('[API v1 Schedule] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/v1/posts', requireAutomation, async (req, res) => {
  try {
    const posts = await db.getPosts();
    return res.json({ success: true, count: posts.length, posts });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/v1/channels', requireAutomation, (req, res) => {
  const channels = registry.channelInventory();
  return res.json({ success: true, channels });
});

// ---------------------------------------------------------------------------
// Universal Webhook Ingress (Zapier, Make, n8n, Python, Node, cURL)
// ---------------------------------------------------------------------------

// Self-documenting Webhook info endpoint
app.get(['/api/webhook/publish', '/api/webhook/info'], (req, res) => {
  const channels = registry.channelInventory();
  res.json({
    name: 'OmniPost Universal Webhook Ingress',
    description: 'Post or schedule social content from Zapier, Make, cURL, Python, or any webhook source.',
    endpoints: {
      publish: {
        method: 'POST',
        url: '/api/webhook/publish',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'YOUR_AUTOMATION_SECRET_KEY'
        },
        body: {
          title: 'Post Title (optional)',
          caption: 'Post caption text with #hashtags (required)',
          mediaUrl: 'https://example.com/video.mp4 (optional)',
          mediaType: 'video | image | text (optional, auto-detected)',
          platforms: ['youtube', 'instagram', 'linkedin', 'facebook', 'threads', 'pinterest'],
          publishNow: true
        }
      },
      schedule: {
        method: 'POST',
        url: '/api/webhook/schedule',
        body: {
          caption: 'Post caption',
          scheduledDateTime: '2026-11-01T15:00:00Z',
          platforms: ['linkedin']
        }
      },
      status: {
        method: 'GET',
        url: '/api/webhook/status/:contentId'
      }
    },
    supportedPlatforms: registry.ALL_PLATFORMS,
    configuredChannels: channels.filter(c => c.configured ?? c.connected).map(c => c.id)
  });
});

app.post('/api/webhook/publish', requireAutomation, async (req, res) => {
  try {
    const { title, caption, mediaUrl, mediaType, platforms, link, publishNow = true } = req.body || {};
    if (!title && !caption) {
      return res.status(400).json({ success: false, message: 'Title or caption is required' });
    }

    let targetPlatforms = Array.isArray(platforms) && platforms.length > 0
      ? platforms
      : (typeof platforms === 'string' && platforms.trim() ? platforms.split(',').map(s => s.trim()) : registry.ALL_PLATFORMS);

    const check = registry.validatePlatforms(targetPlatforms);
    if (!check.valid) {
      return res.status(400).json({ success: false, message: check.error });
    }

    const contentId = 'P-' + String(Date.now()).slice(-8);
    const resolvedMediaType = mediaType || (/\.(mp4|mov|avi|webm|mkv|m4v)(\?.*)?$/i.test(mediaUrl || '') ? 'video' : (mediaUrl ? 'image' : 'text'));

    const newPost = {
      'Content ID': contentId,
      'content_id': contentId,
      'Title': (title || '').trim(),
      'Caption': (caption || '').trim(),
      'Platforms': check.platforms.join(','),
      'Scheduled DateTime': new Date().toISOString(),
      'Status': publishNow ? 'Approved for Posting' : 'Scheduled',
      'Public Media URL': mediaUrl || '',
      'public_media_url': mediaUrl || '',
      'Media Type': resolvedMediaType,
      'media_type': resolvedMediaType,
      'mediaType': resolvedMediaType,
      'Link': link || '',
      'link': link || ''
    };

    await db.savePost(newPost);

    if (publishNow) {
      const result = await advanceCalendarEntry(contentId, 1);
      const states = result?.states || {};
      const results = Object.entries(states).map(([platform, s]) => ({
        platform,
        status: s.status,
        result: s.status === 'published' ? 'PUBLISHED' : (s.status === 'in_flight' ? 'PROCESSING' : 'FAILED'),
        permalink: s.publishedUrl || s.permalink || null,
        error: s.lastError || null
      }));

      const published = results.filter(r => r.status === 'published').length;
      const failed = results.filter(r => r.status === 'failed').length;
      const skipped = results.filter(r => r.status === 'skipped').length;

      return res.json({
        success: true,
        contentId,
        published: true,
        status: result?.rollup || 'Queued',
        settled: Boolean(result?.settled),
        results,
        summary: {
          published,
          failed,
          skipped,
          requested: results.length,
          text: `${published}/${results.length} published`
        }
      });
    } else {
      return res.status(201).json({
        success: true,
        contentId,
        scheduled: true,
        status: 'Scheduled',
        scheduledDateTime: newPost['Scheduled DateTime']
      });
    }
  } catch (err) {
    console.error('[Webhook Publish] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/webhook/schedule', requireAutomation, async (req, res) => {
  try {
    const { title, caption, mediaUrl, mediaType, platforms, scheduledDateTime, link } = req.body || {};
    if (!title && !caption) {
      return res.status(400).json({ success: false, message: 'Title or caption is required' });
    }

    let targetPlatforms = Array.isArray(platforms) && platforms.length > 0
      ? platforms
      : (typeof platforms === 'string' && platforms.trim() ? platforms.split(',').map(s => s.trim()) : registry.ALL_PLATFORMS);

    const check = registry.validatePlatforms(targetPlatforms);
    if (!check.valid) {
      return res.status(400).json({ success: false, message: check.error });
    }

    const contentId = 'P-' + String(Date.now()).slice(-8);
    const resolvedMediaType = mediaType || (/\.(mp4|mov|avi|webm|mkv|m4v)(\?.*)?$/i.test(mediaUrl || '') ? 'video' : (mediaUrl ? 'image' : 'text'));
    const scheduledIso = scheduledDateTime ? new Date(scheduledDateTime).toISOString() : new Date().toISOString();

    const newPost = {
      'Content ID': contentId,
      'content_id': contentId,
      'Title': (title || '').trim(),
      'Caption': (caption || '').trim(),
      'Platforms': check.platforms.join(','),
      'Scheduled DateTime': scheduledIso,
      'Status': 'Scheduled',
      'Public Media URL': mediaUrl || '',
      'public_media_url': mediaUrl || '',
      'Media Type': resolvedMediaType,
      'media_type': resolvedMediaType,
      'mediaType': resolvedMediaType,
      'Link': link || '',
      'link': link || ''
    };

    await db.savePost(newPost);

    return res.status(201).json({
      success: true,
      contentId,
      scheduled: true,
      status: 'Scheduled',
      scheduledDateTime: scheduledIso
    });
  } catch (err) {
    console.error('[Webhook Schedule] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/webhook/status/:contentId', requireAutomation, async (req, res) => {
  try {
    const { contentId } = req.params;
    const posts = await db.getPosts();
    const post = posts.find(p => (p['Content ID'] || p.content_id) === contentId);
    if (!post) {
      return res.status(404).json({ success: false, message: `Post ${contentId} not found` });
    }

    const stored = await db.getPublishState(contentId);
    return res.json({
      success: true,
      contentId,
      title: post.Title || post.title || '',
      status: post.Status || post.status || 'Unknown',
      platforms: post.Platforms || post.platforms || '',
      publishState: stored?.publish_state || post.publishState || 'idle',
      platformStatuses: stored?.platform_statuses || stored?.platformStatuses || {},
      lastAttemptAt: stored?.last_attempt_at || post.last_attempt_at || null
    });
  } catch (err) {
    console.error('[Webhook Status] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Multer Media Upload Filter & Streaming Disk Staging
// ---------------------------------------------------------------------------
const ALLOWED_MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.m4v', '.3gp', '.flv',
  '.jpg', '.jpeg', '.png', '.webp', '.gif'
]);

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.m4v', '.3gp', '.flv']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg', '.tiff']);

export function detectMediaType(file, fallback = 'video') {
  if (!file) return fallback;
  if (typeof file === 'string') {
    const cleanPath = file.split('?')[0].split('#')[0];
    const ext = path.extname(cleanPath).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    return fallback;
  }
  const name = file.originalname || file.name || file.filename || '';
  const cleanPath = name.split('?')[0].split('#')[0];
  const ext = path.extname(cleanPath).toLowerCase();
  const mime = (file.mimetype || file.contentType || '').toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext) || mime.startsWith('video/')) {
    return 'video';
  }
  if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith('image/')) {
    return 'image';
  }
  return fallback;
}

function mediaFileAllowed(req, file, cb) {
  const name = file.originalname || '';
  const cleanPath = name.split('?')[0].split('#')[0];
  const ext = path.extname(cleanPath).toLowerCase();
  const mime = file.mimetype || '';
  if (ALLOWED_MEDIA_EXTENSIONS.has(ext) || mime.startsWith('video/') || mime.startsWith('image/')) {
    return cb(null, true);
  }
  const err = new Error('Unsupported file type');
  err.code = 'UNSUPPORTED_FILE_TYPE';
  return cb(err);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(STAGING_DIR)) {
        fs.mkdirSync(STAGING_DIR, { recursive: true });
      }
      cb(null, STAGING_DIR);
    },
    filename: (req, file, cb) => {
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const fullPath = path.join(STAGING_DIR, filename);
      if (!req._stagedPaths) req._stagedPaths = [];
      req._stagedPaths.push(fullPath);
      if (!req._stagedFiles) req._stagedFiles = [];
      req._stagedFiles.push({ path: fullPath, filename });
      cb(null, filename);
    }
  }),
  defParamCharset: 'utf8',
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB for high-resolution video
    files: 5,
    fields: 30
  },
  fileFilter: mediaFileAllowed
});

export async function safeDiscardStaged(files, maxRetries = 8) {
  if (!files) return;

  const rawList = Array.isArray(files)
    ? files
    : (typeof files === 'string' || (typeof files === 'object' && files.path)
        ? [files]
        : (typeof files === 'object' && files !== null
            ? Object.values(files).flat().filter(Boolean)
            : []));

  const resolvedPaths = new Set();
  for (const item of rawList) {
    if (!item) continue;
    const p = typeof item === 'string' ? item : item.path;
    if (p && typeof p === 'string') {
      resolvedPaths.add(path.resolve(p));
    }
  }

  for (const filePath of resolvedPaths) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (!fs.existsSync(filePath)) {
          // If the file does not exist on disk, do not waste 2800ms across 8 retry attempts.
          // Allow at most one brief 50ms grace window on attempt 0 for in-flight open syscalls, then exit.
          if (attempt >= 1) break;
          await new Promise(r => setTimeout(r, 50));
          if (!fs.existsSync(filePath)) break;
        }
        await fs.promises.unlink(filePath);
        break;
      } catch (err) {
        if (err.code === 'ENOENT') break;
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        } else {
          console.warn(`[Upload Cleanup] Failed to unlink ${filePath} after ${maxRetries} attempts:`, err.message);
        }
      }
    }
  }
}

export function discardStaged(files) {
  safeDiscardStaged(files).catch(() => {});
}

export async function sweepStagingDir({ maxAgeMs = 30 * 60 * 1000, forceAll = false, forceImmediate = false } = {}) {
  try {
    if (!fs.existsSync(STAGING_DIR)) return 0;
    const entries = await fs.promises.readdir(STAGING_DIR);
    const now = Date.now();
    let purged = 0;

    for (const entry of entries) {
      const fullPath = path.join(STAGING_DIR, entry);
      try {
        const stat = await fs.promises.stat(fullPath);
        if (!stat.isFile()) continue;

        // Protect active in-flight files from premature unlinking during active read streams (ENOENT bug):
        // do not purge files whose creation / mtime is less than 5000ms ago unless forceImmediate: true is explicitly provided.
        const fileAgeMtime = now - stat.mtimeMs;
        const fileAgeBirth = stat.birthtimeMs ? (now - stat.birthtimeMs) : fileAgeMtime;
        const isFresh = fileAgeMtime < 5000 || fileAgeBirth < 5000;

        if (isFresh && !forceImmediate && !forceAll) {
          continue;
        }

        if (forceImmediate || forceAll || (now - stat.mtimeMs > maxAgeMs)) {
          await fs.promises.unlink(fullPath);
          purged++;
        }
      } catch (e) {
        // Ignored: file unlinked concurrently
      }
    }
    if (purged > 0) {
      console.log(`[Staging Sweeper] Purged ${purged} orphaned staged file(s).`);
    }
    return purged;
  } catch (err) {
    console.warn('[Staging Sweeper] Error sweeping staging directory:', err.message);
    return 0;
  }
}

// Cold-boot purge of orphaned staged files from prior crashes/restarts
sweepStagingDir({ forceAll: true }).catch(() => {});

// Background sweep for files older than 30 minutes every 15 minutes
const stagingSweepInterval = setInterval(() => {
  sweepStagingDir({ maxAgeMs: 30 * 60 * 1000 }).catch(() => {});
}, 15 * 60 * 1000);
stagingSweepInterval.unref?.();

// ---------------------------------------------------------------------------
// Public Media CDN Storage
// ---------------------------------------------------------------------------
const MEDIA_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'social-media-assets';

async function uploadToPublicStorage(filePath, originalName, contentType) {
  if (!db.supabase) {
    console.warn('[Storage] Supabase not configured — skipping public media upload.');
    return null;
  }
  const safeBase = (originalName || 'media')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 80);
  const storagePath = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeBase}`;

  const { error } = await db.supabase.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, fs.createReadStream(filePath), {
      contentType: contentType || 'application/octet-stream',
      duplex: 'half',
      upsert: false
    });
  if (error) {
    console.error('[Storage] Upload failed:', error.message);
    return null;
  }

  const { data: urlData } = db.supabase.storage
    .from(MEDIA_BUCKET)
    .getPublicUrl(storagePath);
  const publicUrl = urlData?.publicUrl || null;
  if (publicUrl) {
    console.log(`[Storage] Public media URL: ${publicUrl}`);
  }
  return publicUrl;
}

const sendToN8n = createN8nClient({
  candidates: n8nCandidates,
  secret: process.env.N8N_WEBHOOK_SECRET || ''
});
if (!process.env.N8N_WEBHOOK_SECRET) {
  console.warn('[n8n] N8N_WEBHOOK_SECRET is not set - calls to authenticated n8n webhooks will be refused.');
}

// Health check API
app.get('/api/health', async (req, res) => {
  const shallow = req.query.shallow === '1' || req.query.shallow === 'true';
  const storage = shallow ? db.getBackendStatus() : await db.ensureProbed();
  res.json({
    status: 'ok',
    service: process.env.APP_NAME || 'OmniPost Social Automation',
    engine: 'Universal Social Publishing Engine',
    framework: 'React + Vite + Express',
    storage,
    timestamp: new Date().toISOString()
  });
});

// Fetch all posts from Google Sheet via n8n with local fallback (Protected)
app.get('/api/posts', requireAutomation, async (req, res) => {
  try {
    const data = await sendToN8n('/webhook/content-list', { method: 'GET' });
    if (data && data.posts && Array.isArray(data.posts) && data.posts.length > 0) {
      await db.savePosts(data.posts);
      return res.json({ posts: data.posts, source: 'live' });
    }
    const cachedPosts = await db.getPosts();
    return res.json({ posts: cachedPosts, source: 'cache-empty-sheet' });
  } catch (err) {
    const now = Date.now();
    if (now - lastN8nOfflineNotice > 60000) {
      console.warn('[Sheet Fetch] n8n offline or unreachable. Serving local posts cache:', err.message);
      lastN8nOfflineNotice = now;
    }
    const cachedPosts = await db.getPosts();
    return res.json({
      posts: cachedPosts,
      source: 'cache-offline-fallback',
      warning: 'Live spreadsheet currently offline'
    });
  }
});

// Channel configuration inventory
app.get('/api/channels', requireAutomation, (req, res) => {
  try {
    const channels = registry.channelInventory();
    res.json({
      channels,
      missingSummary: registry.missingSummary(),
      configuredCount: channels.filter(c => c.configured ?? c.connected).length,
      totalCount: channels.length
    });
  } catch (err) {
    console.error('[Channels] Failed to get inventory:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Engine preflight check
app.get('/api/engine/preflight', requireAutomation, async (req, res) => {
  try {
    const result = await preflight.runPreflight({ db, sendToN8n });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Preflight] Failed:', err.message);
    return res.status(200).json({
      success: false,
      signal: 'NOT_GREEN',
      armed: false,
      error: err.message,
      checkedAt: new Date().toISOString()
    });
  }
});

// Concurrency control for publishing execution (DEF-03)
// Prevents concurrent workers or cron ticks from double-publishing the same content ID.
const CLAIM_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
const inFlightClaims = new Map(); // contentId -> epoch ms

export function claimPostProcess(contentId, ttlMs = CLAIM_TTL_MS) {
  if (!contentId) return false;
  const now = Date.now();
  if (inFlightClaims.has(contentId)) {
    const claimedAt = inFlightClaims.get(contentId);
    if (now - claimedAt < ttlMs) {
      return false; // Still actively claimed
    }
    console.warn(`[Concurrency] Claim lock for ${contentId} timed out after ${ttlMs}ms. Reclaiming.`);
  }
  inFlightClaims.set(contentId, now);
  return true;
}

export function releasePostProcess(contentId) {
  if (!contentId) return;
  inFlightClaims.delete(contentId);
}

export function getInFlightClaims() {
  return new Map(inFlightClaims);
}

/**
 * Advances one calendar entry through the publishing state machine with atomic claiming (DEF-03).
 */
export async function advanceCalendarEntry(contentId, passes = 1) {
  if (!contentId) return null;

  // 1. In-process claim lock check (DEF-03)
  if (!claimPostProcess(contentId)) {
    console.warn(`[Concurrency] Post ${contentId} is already in-flight in this process. Skipping.`);
    return { contentId, skipped: true, reason: 'Already in-flight (process lock)' };
  }

  try {
    const posts = await db.getPosts();
    const row = posts.find(p => (p['Content ID'] || p.content_id) === contentId);
    if (!row) return null;

    const stored = await db.getPublishState(contentId);
    const pubState = String(stored?.publish_state || row.publishState || row.publish_state || '').trim().toLowerCase();

    // 2. Terminal state guard: Never re-publish completed or terminal failed posts
    if (pubState === 'completed' || pubState === 'published') {
      return { contentId, skipped: true, reason: 'Already published' };
    }
    if (pubState === 'failed') {
      return { contentId, skipped: true, reason: 'Already failed' };
    }

    // 3. Database state guard: Check if another worker/process claimed it recently
    if (pubState === 'in_flight') {
      const lastAttempt = stored?.last_attempt_at || row.last_attempt_at || row.lastAttemptAt;
      const lastAttemptTime = lastAttempt ? new Date(lastAttempt).getTime() : 0;
      if (Date.now() - lastAttemptTime < CLAIM_TTL_MS) {
        console.warn(`[Concurrency] Post ${contentId} is in-flight in database (claimed at ${lastAttempt}). Skipping.`);
        return { contentId, skipped: true, reason: 'Already in-flight (database state)' };
      }
      console.warn(`[Concurrency] In-flight state in database for ${contentId} expired (${lastAttempt}). Proceeding with reclaim.`);
    }

    const states = publishState.readPlatformStates({
      Platforms: row.Platforms || row.platforms,
      platform_statuses: stored?.platform_statuses || stored?.platformStatuses || {}
    });

    // 4. Atomic state transition in database BEFORE triggering external network calls
    await db.savePublishState(contentId, states, {
      publishState: 'in_flight',
      status: 'Publishing'
    });

    // 5. Accurate mediaType resolution
    const mediaUrl = row['Public Media URL'] || row.public_media_url || row.mediaUrl || row.publicMediaUrl || '';
    const rawMediaType = row.media_type || row['Media Type'] || row.mediaType;
    const isVideoExt = /\.(mp4|mov|avi|webm|mkv|m4v)(\?.*)?$/i.test(mediaUrl);
    const mediaType = rawMediaType || (isVideoExt ? 'video' : (mediaUrl ? 'image' : 'text'));
    const link = row.Link || row.link || '';

    // 6. Build platform drivers and execute state machine
    const drivers = registry.buildAllDrivers({
      caption: row.Caption || row.caption || row.Title || row.title || '',
      title: row.Title || row.title || '',
      mediaUrl,
      mediaType,
      link
    }, registry.ALL_PLATFORMS, process.env, fetch, sendToN8n);

    let next = states;
    for (let i = 0; i < passes; i++) {
      next = await publishState.advancePost(next, drivers);
      if (publishState.isSettled(next)) break;
    }

    // 7. Transition to final or pending state
    const settled = publishState.isSettled(next);
    const allDone = Object.values(next).length > 0 && Object.values(next).every(s => publishState.isPlatformPublished(s));
    await db.savePublishState(contentId, next, {
      publishState: settled ? (allDone ? 'completed' : 'failed') : 'pending',
      status: publishState.rollupStatus(next),
      failureKind: Object.values(next).find(s => s.failureKind)?.failureKind || null
    });

    return { contentId, states: next, settled, rollup: publishState.rollupStatus(next) };
  } finally {
    // 8. Always release the in-process lock
    releasePostProcess(contentId);
  }
}

// Batch multi-channel publish
app.post('/api/publish/batch', requireAutomation, async (req, res) => {
  try {
    const { contentId, platforms } = req.body || {};
    if (!contentId) {
      return res.status(400).json({ success: false, message: 'contentId is required' });
    }

    if (!claimPostProcess(contentId)) {
      return res.status(409).json({ success: false, message: `Post ${contentId} is currently in-flight` });
    }

    try {
      const requested = Array.isArray(platforms) && platforms.length
        ? platforms
        : registry.ALL_PLATFORMS;
      const check = registry.validatePlatforms(requested);
      if (!check.valid) {
        return res.status(400).json({ success: false, message: check.error });
      }

      const posts = await db.getPosts();
      const row = posts.find(p => (p['Content ID'] || p.content_id) === contentId);
      if (!row) {
        return res.status(404).json({ success: false, message: `No calendar entry ${contentId}` });
      }

      const stored = await db.getPublishState(contentId);
      const existing = stored?.platform_statuses || stored?.platformStatuses || {};

      const mediaUrl = row['Public Media URL'] || row.public_media_url || row.mediaUrl || row.publicMediaUrl || '';
      const rawMediaType = row.media_type || row['Media Type'] || row.mediaType;
      const isVideoExt = /\.(mp4|mov|avi|webm|mkv|m4v)(\?.*)?$/i.test(mediaUrl);
      const mediaType = rawMediaType || (isVideoExt ? 'video' : (mediaUrl ? 'image' : 'text'));
      const link = row.Link || row.link || '';

      const post = {
        caption: row.Caption || row.caption || row.Title || row.title || '',
        title: row.Title || row.title || '',
        mediaUrl,
        mediaType,
        link
      };

      const drivers = registry.buildAllDrivers(post, check.platforms, process.env, fetch, sendToN8n);
      const states = {};
      const outcome = [];

      for (const platform of check.platforms) {
        const prior = existing[platform];
        if (prior && publishState.isPlatformPublished(prior)) {
          states[platform] = prior;
          outcome.push({ platform, result: 'SKIPPED_ALREADY_PUBLISHED', state: prior });
          continue;
        }

        if (!registry.isConfigured(platform)) {
          const missing = registry.missingKeys(platform);
          const skipped = {
            state: 'unconfigured',
            status: 'failed',
            publishedAt: null,
            error: `Channel not configured (missing ${missing.join(', ')})`,
            failureKind: 'PERMANENT',
            nextAttemptAt: null,
            attempts: 0
          };
          states[platform] = skipped;
          outcome.push({ platform, result: 'SKIPPED_UNCONFIGURED', missing, state: skipped });
          continue;
        }

        const start = prior || publishState.emptyPlatformState(platform);
        const next = await publishState.advance(start, drivers[platform]);
        states[platform] = next;

        if (publishState.isPlatformPublished(next)) {
          outcome.push({ platform, result: 'PUBLISHED', state: next });
        } else if (publishState.isPlatformFailed(next)) {
          outcome.push({ platform, result: 'FAILED', state: next });
        } else {
          outcome.push({ platform, result: 'PENDING', state: next });
        }
      }

      const merged = { ...existing, ...states };
      const settled = publishState.isSettled(merged);
      const allDone = Object.values(merged).length > 0 && Object.values(merged).every(s => publishState.isPlatformPublished(s));

      await db.savePublishState(contentId, merged, {
        publishState: settled ? (allDone ? 'completed' : 'failed') : 'pending',
        status: publishState.rollupStatus(merged)
      });

      const published = outcome.filter(o => o.result === 'PUBLISHED').length;
      const failed = outcome.filter(o => o.result === 'FAILED').length;
      const skipped = outcome.filter(o => o.result.startsWith('SKIPPED')).length;

      const summaryObj = {
        published,
        failed,
        skipped,
        requested: check.platforms.length,
        text: `${published} published, ${failed} failed, ${skipped} skipped`,
        toString() { return this.text; }
      };

      return res.json({
        success: true,
        contentId,
        summary: summaryObj,
        rollup: publishState.rollupStatus(merged),
        settled,
        outcome,
        platformStatuses: merged
      });
    } finally {
      releasePostProcess(contentId);
    }
  } catch (err) {
    console.error('[Publish batch] Failed:', err.message);
    return res.status(500).json({ success: false, message: 'Publish batch failed.' });
  }
});

// Check status of a single content publish
app.get('/api/publish/status/:contentId', requireAutomation, async (req, res) => {
  try {
    const stored = await db.getPublishState(req.params.contentId);
    if (!stored) {
      return res.status(404).json({ success: false, message: 'No publishing state found' });
    }
    return res.json({ success: true, ...stored });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Single-click publish from card
app.post('/api/posts/:contentId/publish', requireAutomation, async (req, res) => {
  try {
    const posts = await db.getPosts();
    const post = (posts || []).find(p => (p['Content ID'] || p.content_id) === req.params.contentId);
    if (post && isPostRightsRevoked(post)) {
      return res.status(403).json({ success: false, code: 'RIGHTS_REVOKED', message: 'Rights for this asset have been revoked.' });
    }
    const result = await advanceCalendarEntry(req.params.contentId, 1);
    if (!result) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    if (result.skipped) {
      return res.status(409).json({ success: false, message: result.reason || 'Post is currently in-flight' });
    }
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Scheduler tick
app.post('/api/publish/tick', requireAutomation, async (req, res) => {
  try {
    const posts = await db.getPosts();
    const due = selectDue(posts);

    const advanced = [];
    const skipped = [];
    for (const row of due) {
      const contentId = row['Content ID'] || row.content_id;
      const r = await advanceCalendarEntry(contentId, 1);
      if (r && !r.skipped) {
        advanced.push({ contentId: r.contentId, rollup: r.rollup, settled: r.settled });
      } else if (r?.skipped) {
        skipped.push({ contentId, reason: r.reason });
      }
    }
    return res.json({ success: true, examined: due.length, advanced, skipped });
  } catch (err) {
    console.error('[Publish tick] Failed:', err.message);
    return res.status(500).json({ success: false, message: 'Publish tick failed.' });
  }
});

// Upload media & schedule post (Protected)
app.post('/api/upload', requireAutomation, upload.single('file'), async (req, res) => {
  let cleanupPromise = null;
  const executeCleanup = () => {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        try {
          const filesToDiscard = [
            ...(req.file ? [req.file] : []),
            ...(req._stagedPaths || []),
            ...(req._stagedFiles || [])
          ];
          if (filesToDiscard.length > 0) {
            await safeDiscardStaged(filesToDiscard);
          }
        } catch (err) {
          console.warn('[Upload Cleanup] executeCleanup error:', err.message);
        }
      })();
    }
    return cleanupPromise;
  };

  let clientAborted = false;
  const onAbort = () => {
    clientAborted = true;
    executeCleanup().catch(() => {});
  };

  if (req.file || req._stagedPaths) {
    res.on('finish', () => executeCleanup().catch(() => {}));
    res.on('close', () => {
      if (!res.writableEnded) onAbort();
      else executeCleanup().catch(() => {});
    });
    req.on('aborted', onAbort);
    req.on('error', onAbort);
  }

  const isClientDisconnected = () => {
    return clientAborted || res.destroyed || !req.socket || req.socket.destroyed;
  };

  try {
    if (!req.file) {
      await executeCleanup();
      return res.status(400).json({
        success: false,
        error: 'No media file provided. Please attach an image or video.'
      });
    }

    const {
      title,
      caption,
      platforms,
      scheduledDateTime,
      status
    } = req.body;

    if (!title || !title.trim()) {
      await executeCleanup();
      return res.status(400).json({
        success: false,
        error: 'Post title is required.'
      });
    }

    const detectedMediaType = (req.body && (req.body.mediaType || req.body.media_type)) || detectMediaType(req.file);

    // Abort guard: prevent unneeded network ops if client has already disconnected
    if (isClientDisconnected()) {
      console.warn('[Upload] Client disconnected before public storage upload.');
      await executeCleanup();
      return;
    }

    const defaultExt = detectedMediaType === 'video' ? 'mp4' : 'jpg';
    const defaultMime = detectedMediaType === 'video' ? 'video/mp4' : 'image/jpeg';

    const publicMediaUrl = await uploadToPublicStorage(
      req.file.path,
      req.file.originalname || `upload_${Date.now()}.${defaultExt}`,
      req.file.mimetype || defaultMime
    );

    if (isClientDisconnected()) {
      console.warn('[Upload] Client disconnected before n8n webhook.');
      await executeCleanup();
      return;
    }

    const body = multipartBody({
      title: title.trim(),
      caption: caption ? caption.trim() : '',
      platforms: platforms || 'instagram,facebook,youtube',
      scheduledDateTime: scheduledDateTime || new Date().toISOString(),
      status: status || 'Pending Review',
      mediaType: detectedMediaType,
      media_type: detectedMediaType,
      ...(publicMediaUrl ? { publicMediaUrl, public_media_url: publicMediaUrl } : {})
    }, [{
      field: 'data',
      path: req.file.path,
      filename: req.file.originalname || `upload_${Date.now()}.${defaultExt}`,
      contentType: req.file.mimetype || defaultMime,
      size: req.file.size
    }]);

    try {
      const result = await sendToN8n('/webhook/content-upload', {
        method: 'POST',
        body,
        timeout: 120000
      });
      const responsePayload = (typeof result === 'object' && result !== null) ? result : { success: true };
      await executeCleanup();
      return res.json({
        ...responsePayload,
        mediaType: detectedMediaType,
        media_type: detectedMediaType,
        ...(publicMediaUrl ? { publicMediaUrl, public_media_url: publicMediaUrl } : {})
      });
    } catch (n8nErr) {
      if (isClientDisconnected()) {
        console.warn('[Upload] Client disconnected during n8n transmission.');
        await executeCleanup();
        return;
      }
      console.warn('[Upload Media] n8n offline, queuing post in local calendar:', n8nErr.message);
      const newPostId = 'W-' + String(Date.now()).slice(-6);
      const newLocalPost = {
        'Content ID': newPostId,
        'Title': title.trim(),
        'Caption': caption ? caption.trim() : '',
        'Platforms': platforms || 'instagram,facebook,youtube',
        'Scheduled DateTime': scheduledDateTime || new Date().toISOString(),
        'Status': status || 'Pending Review',
        'Retry Count': 0,
        'Posted At': '',
        'Error': '',
        'Drive File ID': 'queued_local_' + Date.now(),
        'Public Media URL': publicMediaUrl || '',
        'public_media_url': publicMediaUrl || '',
        'publicMediaUrl': publicMediaUrl || '',
        'Media Type': detectedMediaType,
        'media_type': detectedMediaType,
        'mediaType': detectedMediaType,
        'Instagram Status': 'Queued (n8n Standby)',
        'Facebook Status': 'Queued (n8n Standby)',
        'YouTube Status': 'Queued (n8n Standby)',
        'LinkedIn Status': 'Queued (n8n Standby)',
        'Pinterest Status': (platforms || '').includes('pinterest') ? 'Queued (n8n Standby)' : 'Skipped',
        'Threads Status': 'Queued (n8n Standby)'
      };
      await db.savePost(newLocalPost);
      await executeCleanup();
      return res.json({
        success: true,
        offline: true,
        contentId: newPostId,
        mediaType: detectedMediaType,
        media_type: detectedMediaType,
        publicMediaUrl: publicMediaUrl || '',
        public_media_url: publicMediaUrl || '',
        message: 'Post queued in Publishing Content Calendar. Will synchronize to channels once n8n is active.'
      });
    }
  } catch (err) {
    console.error('Upload error:', err.message);
    await executeCleanup();
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: err.response?.data?.message || err.message,
        message: 'Failed to process upload and update Content Calendar.'
      });
    }
  }
});

// Upload and routing errors middleware
app.use(async (err, req, res, next) => {
  const staged = [
    ...(req.file ? [req.file] : []),
    ...(Array.isArray(req.files) ? req.files : (req.files ? Object.values(req.files).flat().filter(Boolean) : [])),
    ...(req._stagedPaths || []),
    ...(req._stagedFiles || [])
  ];
  if (staged.length > 0) {
    try {
      await safeDiscardStaged(staged);
    } catch (cleanupErr) {
      console.warn('[Upload Cleanup] Error in error middleware:', cleanupErr.message);
    }
  }

  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      code: err.code,
      message: tooLarge
        ? 'Uploaded media file exceeds the 500 MB limit.'
        : 'The upload could not be processed. Please try again.'
    });
  }
  if (err && err.code === 'UNSUPPORTED_FILE_TYPE') {
    return res.status(415).json({
      success: false,
      code: err.code,
      message: 'Only supported image and video formats (PNG, JPG, WebP, GIF, MP4, MOV, WebM) can be uploaded.'
    });
  }
  if (err && err.message === 'Request aborted') {
    console.warn(`[Upload] Client aborted ${req.method} ${req.path}`);
    return;
  }
  return next(err);
});

// ---------------------------------------------------------------------------
// OmniPost V2 Ingestion, Rights Revocation & Multi-Tenant Routing
// ---------------------------------------------------------------------------
app.post('/api/v2/ingest', requireAutomation, optionalSingleUpload, async (req, res) => {
  const cleanupFiles = async () => {
    const staged = [
      ...(req.file ? [req.file] : []),
      ...(req._stagedPaths || []),
      ...(req._stagedFiles || [])
    ];
    if (staged.length > 0) {
      await safeDiscardStaged(staged).catch(() => {});
    }
  };

  try {
    const rawBody = req.body || {};
    const parsedEnvelope = parseMaybeJson(rawBody.payload);
    const body = (parsedEnvelope && typeof parsedEnvelope === 'object')
      ? { ...rawBody, ...parsedEnvelope }
      : rawBody;
    const idemKey = String(req.headers['x-idempotency-key'] || body.idempotency_key || body.idempotencyKey || '').trim();

    if (body.file_path || body.local_path) {
      await cleanupFiles();
      return res.status(400).json({
        success: false,
        code: 'UNSAFE_PATH_PARAMETER',
        message: 'Arbitrary server file_path / local_path references are rejected.'
      });
    }

    const compliance = await validateCompliancePayload(body, { requireAllFields: true });
    if (!compliance.ok) {
      await cleanupFiles();
      return res.status(compliance.status).json({
        success: false,
        code: compliance.code,
        message: compliance.message
      });
    }

    const tenantId = String(body.tenant_id || body.tenantId || body.source?.tenant_id || req.headers['x-tenant-id'] || '').trim();
    const workspaceId = String(body.workspace_id || body.workspaceId || body.omnipost_routing?.workspace_id || body.publishing?.workspace_id || req.headers['x-workspace-id'] || '').trim();
    if (tenantId || workspaceId) {
      const tenantCheck = verifyTenantWorkspace(tenantId, workspaceId);
      if (!tenantCheck.ok) {
        await cleanupFiles();
        return res.status(tenantCheck.status || 403).json({
          success: false,
          code: tenantCheck.code || 'CROSS_TENANT_WORKSPACE_FORBIDDEN',
          message: tenantCheck.message
        });
      }
    }

    if (idemKey && ingestIdempotencyCache.has(idemKey)) {
      const prior = ingestIdempotencyCache.get(idemKey);
      if (isPostRightsRevoked({ 'Video ID': prior.videoId, 'Asset ID': prior.assetId, 'Content ID': prior.contentId })) {
        await cleanupFiles();
        return res.status(403).json({
          success: false,
          code: 'RIGHTS_REVOKED',
          message: 'Previously ingested asset has since had its rights revoked.'
        });
      }
      await cleanupFiles();
      return res.status(200).json({ ...prior, deduplicated: true });
    }

    const assetManifest = parseMaybeJson(body.asset_manifest ?? body.assetManifest) || {};
    const expectedHash = String(
      body.expected_sha256 || body.file_hash || assetManifest.file_hash || body.media?.checksum || ''
    ).trim().toLowerCase();
    let computedSha256 = '';
    let storedMediaUrl = String(body.mediaUrl || body.public_media_url || body.media_url || '').trim();

    if (req.file) {
      computedSha256 = await sha256File(req.file.path);
      if (expectedHash && expectedHash !== computedSha256) {
        await cleanupFiles();
        return res.status(422).json({
          success: false,
          code: 'CHECKSUM_MISMATCH',
          message: `Uploaded file SHA-256 (${computedSha256}) does not match expected hash (${expectedHash}).`
        });
      }
      const rawName = path.basename(req.file.originalname || `ingest_${Date.now()}.mp4`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeName = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${rawName}`;
      const destPath = path.resolve(MEDIA_UPLOADS_DIR, safeName);
      const rel = path.relative(MEDIA_UPLOADS_DIR, destPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        await cleanupFiles();
        return res.status(403).json({ success: false, code: 'PATH_TRAVERSAL_BLOCKED', message: 'Invalid filename path.' });
      }
      if (!fs.existsSync(MEDIA_UPLOADS_DIR)) fs.mkdirSync(MEDIA_UPLOADS_DIR, { recursive: true });
      await fs.promises.copyFile(req.file.path, destPath);
      await cleanupFiles();
      if (!storedMediaUrl) {
        storedMediaUrl = `/uploads/media/${safeName}`;
      }
    }

    const rawPlatforms = parseMaybeJson(body.platforms ?? body.publishing?.destinations);
    const requestedPlatforms = Array.isArray(rawPlatforms) && rawPlatforms.length > 0
      ? rawPlatforms
      : (typeof rawPlatforms === 'string' && rawPlatforms.trim() ? rawPlatforms.split(',').map(s => s.trim()) : ['youtube']);

    const resolvedAccounts = resolveTenantAccounts(tenantId, workspaceId, requestedPlatforms);
    const platformsToValidate = resolvedAccounts.canonicalPlatforms ? resolvedAccounts.canonicalPlatforms.filter(p => registry.ALL_PLATFORMS.includes(p)) : requestedPlatforms;
    const finalPlatformsList = platformsToValidate.length > 0 ? platformsToValidate : ['youtube'];

    const check = registry.validatePlatforms(finalPlatformsList);
    if (!check.valid) {
      await cleanupFiles();
      return res.status(400).json({ success: false, code: 'INVALID_PLATFORMS', message: check.error });
    }

    const publishNow = body.publishNow === true || body.publishNow === 'true';
    const contentId = 'V2-' + crypto.randomUUID().slice(0, 10);
    const attrObj = compliance.attribution;
    const attrSummary = typeof attrObj === 'string' ? attrObj : (attrObj?.text || attrObj?.creator_name || attrObj?.source_url || '');
    const title = String(body.title || body.content?.title || assetManifest.title || `Verified Clip ${compliance.videoId || contentId}`).trim();
    const caption = String(body.caption || body.content?.description || attrSummary).trim();
    const resolvedMediaType = String(body.mediaType || body.media_type || (req.file ? detectMediaType(req.file) : 'video'));

    const resolvedRightsStatus = compliance.legalOfficerBypass
      ? (String(compliance.rightsManifest?.status || '').toUpperCase() || 'UNVERIFIED_BYPASS')
      : 'VERIFIED';

    const postRecord = {
      'Content ID': contentId,
      'content_id': contentId,
      'Video ID': compliance.videoId || '',
      'video_id': compliance.videoId || '',
      'Asset ID': compliance.assetId || '',
      'asset_id': compliance.assetId || '',
      'Title': title,
      'Caption': caption,
      'Platforms': check.platforms.join(','),
      'Scheduled DateTime': body.scheduledDateTime || new Date().toISOString(),
      'Status': publishNow ? 'Approved for Posting' : 'Pending Review',
      'Public Media URL': storedMediaUrl,
      'public_media_url': storedMediaUrl,
      'Media Type': resolvedMediaType,
      'media_type': resolvedMediaType,
      'Rights Status': resolvedRightsStatus,
      'Rights Basis': String(compliance.rightsManifest?.basis || '').toUpperCase(),
      'Attribution': attrSummary,
      'Content Hash': computedSha256 || expectedHash,
      'Idempotency Key': idemKey,
      'Tenant ID': tenantId || 'default',
      'Workspace ID': workspaceId || 'default-workspace',
      'Ingest Source': 'v2'
    };

    await db.savePost(postRecord);

    let publishResult = null;
    if (publishNow) {
      publishResult = await advanceCalendarEntry(contentId, 1);
    }

    const finalStatus = publishResult?.rollup || postRecord.Status;
    const eventType = publishNow
      ? (finalStatus === 'Posted' || finalStatus === 'Partially Posted' ? 'POST_PUBLISHED' : 'POST_FAILED')
      : 'POST_SCHEDULED';

    dispatchSignedWebhook({
      eventType,
      tenantId: tenantId || 'default',
      workspaceId: workspaceId || 'default-workspace',
      projectId: body.project_id || body.projectId || compliance.videoId,
      jobId: body.job_id || body.jobId || body.source?.job_id,
      contentId,
      idempotencyKey: idemKey,
      status: finalStatus,
      platforms: check.platforms,
      error: finalStatus === 'Failed' ? 'One or more channels failed during dispatch.' : null
    }).catch(() => {});

    const responseBody = {
      success: true,
      contentId,
      videoId: compliance.videoId,
      assetId: compliance.assetId,
      status: finalStatus,
      rightsStatus: resolvedRightsStatus,
      legalOfficer: isLegalOfficerEnabled(),
      sha256: computedSha256 || expectedHash || null,
      idempotencyKey: idemKey || null,
      mediaUrl: storedMediaUrl || null
    };
    if (idemKey) {
      ingestIdempotencyCache.set(idemKey, responseBody);
    }
    return res.status(201).json(responseBody);
  } catch (err) {
    await cleanupFiles();
    console.error('[API v2 Ingest] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/v2/rights/revoke', requireAutomation, async (req, res) => {
  try {
    const { video_id, videoId, asset_id, assetId, content_id, contentId, reason } = req.body || {};
    const targetIds = [video_id, videoId, asset_id, assetId, content_id, contentId]
      .map(v => String(v || '').trim())
      .filter(Boolean);
    if (targetIds.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one video_id, asset_id, or content_id is required.' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ success: false, message: 'Revocation reason is required.' });
    }
    targetIds.forEach(id => revokedAssetIds.add(id));

    const posts = await db.getPosts();
    let affectedPosts = 0;
    for (const p of posts) {
      const pIds = [p['Content ID'], p.content_id, p['Video ID'], p.video_id, p['Asset ID'], p.asset_id]
        .map(v => String(v || '').trim())
        .filter(Boolean);
      if (pIds.some(id => revokedAssetIds.has(id))) {
        p['Status'] = 'Rights Revoked';
        p['Rights Status'] = 'REVOKED';
        p['Revocation Reason'] = String(reason).trim();
        await db.savePost(p);
        affectedPosts += 1;
      }
    }

    for (const tid of targetIds) {
      dispatchSignedWebhook({
        eventType: 'TAKEDOWN_ISSUED',
        tenantId: 'default',
        workspaceId: 'default-workspace',
        projectId: tid,
        jobId: tid,
        contentId: tid,
        status: 'REVOKED',
        error: `Takedown issued: ${reason}`
      }).catch(() => {});
    }

    return res.json({
      success: true,
      revoked: true,
      targetIds,
      affectedPosts,
      revokedAt: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/v2/health/ops', requireAutomation, async (req, res) => {
  try {
    const storage = db.getBackendStatus();
    const posts = await db.getPosts();
    let stagedCount = 0;
    try {
      if (fs.existsSync(STAGING_DIR)) {
        stagedCount = fs.readdirSync(STAGING_DIR).length;
      }
    } catch {
      stagedCount = 0;
    }
    return res.json({
      status: 'ok',
      legalOfficer: isLegalOfficerEnabled(),
      storage,
      postsCount: posts.length,
      revokedCount: revokedAssetIds.size,
      stagedUploadsCount: stagedCount,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

const isTestRunner = Boolean(process.env.NODE_TEST_CONTEXT || (process.argv[1] && process.argv[1].includes('test')));
let server = null;

if (!isTestRunner) {
  server = app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 OmniPost Universal Social Automation & Publishing Engine`);
    console.log(`🌐 Server running at: http://localhost:${PORT}`);
    console.log(`=======================================================`);
  });

  // Graceful shutdown
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] ${signal} received - draining connections.`);
    if (server) server.close(() => process.exit(0));
    server?.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 10000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { app, server, STAGING_DIR, revokedAssetIds, isLegalOfficerEnabled, verifyTenantWorkspace, resolveTenantAccounts, dispatchSignedWebhook };
