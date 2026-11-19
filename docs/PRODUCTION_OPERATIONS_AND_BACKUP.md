# Production Operations, Incident Response & Backup Runbook

## 1. Environment & Credential Security

### Required Secrets (Never Commit to Source Control)
- **Web Studio (`yt-clipping-intelligence`)**:
  - `ENVIRONMENT=production` (enforces fail-closed auth: returns `503` if `WEB_STUDIO_API_KEY` is missing)
  - `WEB_STUDIO_API_KEY` (passed by clients via `X-API-Key` or `Authorization: Bearer <token>`)
  - `CORS_ALLOWED_ORIGINS` (comma-separated explicit HTTPS/local origins; wildcard `*` is forbidden)
  - `COMPLIANCE_PROFILE` (`REVIEW_REQUIRED`, `STRICT_LICENSED`, or `COMMENTARY_REVIEW`)
  - `LEGAL_OFFICER` (`true` by default; boolean switch checked via `is_legal_officer_enabled()` / `legal_officer_enabled()` in Python and `isLegalOfficerEnabled()` in OmniPost. When `false`, copyright/rights/creator/attribution/audio-risk/commentary gates are bypassed and logged honestly as `LEGAL_OFFICER_BYPASS` in `rights_audit_log` / `'UNVERIFIED_BYPASS'` in OmniPost without fabricating `VERIFIED` status, while technical security and reliability guards—`X-API-Key` auth, SSRF validation, SHA-256 verification, FFmpeg QA, `OUTCOME_UNKNOWN` replay protection, and disk-space checks—remain active)
  - `GEMINI_API_KEY` & `GEMINI_MODEL` (transmitted exclusively via HTTP header `x-goog-api-key`; never placed in query parameters or error telemetry)
  - `YOUTUBE_API_KEY`
- **OmniPost (`omnipost/web`)**:
  - `NODE_ENV=production`
  - `AUTOMATION_SECRET_KEY` (required for `/api/v2/ingest`, `/api/v2/rights/revoke`, `/api/v2/health/ops`, and `/api/v1/*`)
  - `CHAMBERS_ADMIN_SECRET_KEY` (privileged admin/vault role; distinct from `AUTOMATION_SECRET_KEY`)
  - `OMNIPOST_REQUIRE_RIGHTS_MANIFEST=true` (enforces rights verification across legacy v1/webhook publish routes)
  - `LEGAL_OFFICER` (`true` by default; must match Python setting when bypassing legal/rights checks across both services)

---

## 2. Operational Health & Monitoring Endpoints

- **YouTube Clipping Studio Health**:
  - `GET /api/v1/ops/health` (authenticated via `X-API-Key`): returns SQLite connection status, active/failed jobs, pending rights reviews, and environment/compliance profile metadata (all secrets masked).
- **OmniPost Operational Health**:
  - `GET /api/v2/health/ops` (authenticated via `x-api-key`): returns DB backend status, post counts, active revocations (`revokedCount`), staging directory count, and channel configuration inventory.
- **Gemini Usage & Rate-Limit Telemetry**:
  - Recorded in SQLite table `gemini_usage_log` (`capability`, `model`, `prompt_version`, `status`, `latency_ms`, `input_tokens`, `output_tokens`, `error_type`, `created_at`).

---

## 3. Rights Revocation & Takedown Incident Procedure

When a rights holder revokes permission, modifies a Creative Commons license, or submits a notice:

1. **Immediate Ledger Revocation (Python Engine)**:
   - Call `POST /api/v1/rights/revoke` with `{ "video_id": "<VIDEO_ID>", "reason": "<TICKET_OR_NOTICE_REF>", "actor": "<OPERATOR>" }` (or CLI `rights revoke`).
   - Optionally revoke the creator channel policy via `POST /api/v1/creators/revoke`.
   - `LocalRightsPolicy.revoke_rights()` records an immutable append-only row in `rights_audit_log`, transitions `rights_ledger.status` to `REVOKED`, logs affected assets in `revocation_impacts`, and prevents pipeline resumption (`reconcile_job_checkpoints`), rendering, `OmniPostPublisher.publish`, `DualModeAutopostPublisher.publish_clip`, and `retry_failed_job` from proceeding.
2. **Downstream OmniPost Propagation**:
   - Call `POST /api/v2/rights/revoke` on OmniPost (`x-api-key` required) with `{ "video_id": "<VIDEO_ID>", "reason": "<NOTICE_REF>" }`.
   - Marks matching calendar records as `Rights Revoked` (`REVOKED`), invalidates cached idempotent `/api/v2/ingest` replays, and blocks `advanceCalendarEntry` / `POST /api/posts/:contentId/publish` / `POST /api/publish/batch` with HTTP `403`.
3. **Audit Inspection**:
   - Query `GET /api/v1/rights/audit` or CLI `rights audit` to verify chronological status transitions and actor attribution.

---

## 4. Handling `OUTCOME_UNKNOWN` Publication States

If a delivery attempt to OmniPost times out or fails with HTTP `502`/`503`/`504`, `OmniPostPublisher` transitions the receipt in `publishing_receipts` to `OUTCOME_UNKNOWN` with `reconciliation_required: true`.

- **Never automatically retry `OUTCOME_UNKNOWN` receipts** (`retry_failed_job` enforces a hard `PermissionError` guard).
- **Operator Reconciliation Steps**:
  1. Check OmniPost post status via `GET /api/webhook/status/:contentId` or dashboard calendar.
  2. Check target platform state (`platformStatuses` per channel).
  3. Only if confirmed absent on OmniPost and target channels, AND after re-verifying fresh `rights_ledger` status, issue a new supervised publication with a fresh review sign-off.

---

## 5. Backup & Restore Procedures

### Critical Stateful Artifacts
1. **Python Engine SQLite Database (`data/clipper_jobs.db` + `-wal` / `-shm`)**:
   Contains `jobs`, `rights_ledger`, `rights_audit_log`, `creator_registry`, `monitored_channels`, `asset_manifests`, `audio_risk_assessments`, `gemini_usage_log`, `commentary_drafts`, `revocation_impacts`, `high_risk_sources`, and `publishing_receipts`.
2. **Rendered Clips & Manifests (`data/rendered_clips/`)**:
   Rendered MP4 outputs and `.manifest.json` SHA-256 provenance files.
3. **OmniPost State & Media Uploads (`omnipost/web/data/`, `omnipost/web/uploads/media/`)**:
   Local SQLite/JSON calendar persistence and verified ingested media assets.

### Online Consistent Backup (Zero Downtime)
Use SQLite's online backup API rather than raw file copy while writers are active:
```powershell
python -c "import sqlite3; src=sqlite3.connect('data/clipper_jobs.db'); dst=sqlite3.connect('backups/clipper_jobs.backup.db'); src.backup(dst); dst.close(); src.close()"
```
Archive `backups/clipper_jobs.backup.db`, `data/rendered_clips/`, `omnipost/web/data/`, and `omnipost/web/uploads/media/` to encrypted off-host storage daily and prior to schema or service upgrades.

### Restore Verification Drill
1. Stop Studio API and OmniPost worker processes cleanly so WAL checkpoints flush.
2. Restore `clipper_jobs.db` (removing stale `-wal`/`-shm` files if restoring a clean `sqlite3.backup()` snapshot), OmniPost `data/`, and media directories.
3. Verify SQLite integrity & immutable trigger presence:
   ```powershell
   python -c "import sqlite3; c=sqlite3.connect('data/clipper_jobs.db'); print(c.execute('PRAGMA integrity_check').fetchone()); print([r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='trigger'\")])"
   ```
4. Verify `GET /api/v1/ops/health` and `GET /api/v2/health/ops` return HTTP `200` with expected counts before re-enabling publishing ticks.
