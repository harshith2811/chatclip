"""
Centralized SQLite Database Manager with WAL Mode and Schema Migrations.
Provides transactional storage for jobs, rights manifests, publishing receipts,
metric snapshots, API quota telemetry, and dead-letter queues.
"""

from typing import Optional, Dict, Any, List
import sqlite3
import os
import json
from datetime import datetime, timezone


class DatabaseManager:
    """
    Thread-safe SQLite manager using WAL mode, busy timeouts, and robust schema migrations.
    """

    def __init__(self, db_path: str = "data/jobs.db"):
        self.db_path = db_path
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        self.init_schema()

    def get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        try:
            conn.execute("PRAGMA mmap_size=268435456;")       # 256MB memory-mapped I/O
            conn.execute("PRAGMA cache_size=-64000;")         # 64MB page cache
            conn.execute("PRAGMA temp_store=MEMORY;")         # In-memory temporary tables
        except sqlite3.OperationalError:
            pass
        return conn

    def init_schema(self) -> None:
        conn = self.get_connection()
        try:
            with conn:
                # 1. Pipeline Jobs Table
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS jobs (
                        job_id TEXT PRIMARY KEY,
                        video_id TEXT NOT NULL,
                        current_stage TEXT NOT NULL,
                        status TEXT NOT NULL,
                        retry_count INTEGER DEFAULT 0,
                        max_retries INTEGER DEFAULT 3,
                        data_json TEXT NOT NULL,
                        error_message TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_video_id ON jobs(video_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);")

                # 2. Rights Ledger Table
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS rights_ledger (
                        rights_id TEXT PRIMARY KEY,
                        video_id TEXT NOT NULL UNIQUE,
                        basis TEXT NOT NULL,
                        status TEXT NOT NULL,
                        owner_name TEXT NOT NULL,
                        license_url TEXT,
                        proof_reference TEXT,
                        valid_until TEXT,
                        verified_at TEXT,
                        audit_notes TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_rights_video ON rights_ledger(video_id);")

                # 3. Publishing Receipts Table (Unique idempotency key prevents concurrent duplicate delivery)
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS publishing_receipts (
                        receipt_id TEXT PRIMARY KEY,
                        clip_id TEXT NOT NULL,
                        idempotency_key TEXT UNIQUE NOT NULL,
                        status TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        target_mode TEXT NOT NULL,
                        dry_run INTEGER NOT NULL,
                        response_payload_json TEXT
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_rcpt_idemp ON publishing_receipts(idempotency_key);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_rcpt_clip ON publishing_receipts(clip_id);")

                # 4. Metric Snapshots Table (Durable historical views, likes, comments)
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS metric_snapshots (
                        snapshot_id TEXT PRIMARY KEY,
                        video_id TEXT NOT NULL,
                        channel_id TEXT,
                        timestamp TEXT NOT NULL,
                        view_count INTEGER NOT NULL,
                        like_count INTEGER DEFAULT 0,
                        comment_count INTEGER DEFAULT 0,
                        calculated_velocity REAL DEFAULT 0.0,
                        source TEXT DEFAULT 'api'
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_snaps_vid_ts ON metric_snapshots(video_id, timestamp);")

                # 5. Monitored Channels Table
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS monitored_channels (
                        channel_id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        channel_url TEXT,
                        handle TEXT,
                        baseline_views REAL DEFAULT 10000.0,
                        active INTEGER DEFAULT 1,
                        last_polled_at TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )

                # 6. API Quota Log Table
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS api_quota_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        endpoint TEXT NOT NULL,
                        units_spent INTEGER NOT NULL,
                        timestamp TEXT NOT NULL,
                        success INTEGER DEFAULT 1,
                        details TEXT
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_quota_ts ON api_quota_log(timestamp);")

                # 7. Webhook Dead-Letter Queue (DLQ)
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS webhook_dlq (
                        item_id TEXT PRIMARY KEY,
                        clip_id TEXT NOT NULL,
                        payload_json TEXT NOT NULL,
                        target_url TEXT NOT NULL,
                        attempt_count INTEGER DEFAULT 0,
                        max_attempts INTEGER DEFAULT 4,
                        next_retry_at TEXT,
                        last_error TEXT,
                        status TEXT DEFAULT 'PENDING',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_dlq_status ON webhook_dlq(status, next_retry_at);")

                # 8. Discovered Uploads Table (Real-time Pinger & Scraper Ingestion)
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS discovered_uploads (
                        video_id TEXT PRIMARY KEY,
                        channel_id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        published_at TEXT NOT NULL,
                        discovered_at TEXT NOT NULL,
                        initial_views INTEGER DEFAULT 0,
                        latest_views INTEGER DEFAULT 0,
                        hourly_velocity REAL DEFAULT 0.0,
                        velocity_multiplier REAL DEFAULT 0.0,
                        virality_classification TEXT DEFAULT 'STEADY',
                        like_ratio REAL DEFAULT 0.0,
                        comment_ratio REAL DEFAULT 0.0,
                        status TEXT DEFAULT 'DISCOVERED',
                        attribution_text TEXT,
                        source_url TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(channel_id) REFERENCES monitored_channels(channel_id)
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_uploads_velocity ON discovered_uploads(velocity_multiplier DESC);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_uploads_status ON discovered_uploads(status);")

                # 9. Velocity Snapshots Table (Early-Hour Velocity Tracking)
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS velocity_snapshots (
                        snapshot_id TEXT PRIMARY KEY,
                        video_id TEXT NOT NULL,
                        timestamp TEXT NOT NULL,
                        age_hours REAL NOT NULL,
                        view_count INTEGER NOT NULL,
                        like_count INTEGER DEFAULT 0,
                        comment_count INTEGER DEFAULT 0,
                        hourly_velocity REAL NOT NULL,
                        velocity_multiplier REAL NOT NULL,
                        classification TEXT NOT NULL,
                        source TEXT DEFAULT 'rss_pinger'
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_vsnaps_vid_ts ON velocity_snapshots(video_id, timestamp);")

                # 10. Creator Permissions & Attribution Policies
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS creator_permissions (
                        channel_id TEXT PRIMARY KEY,
                        channel_name TEXT NOT NULL,
                        policy_type TEXT NOT NULL,
                        attribution_template TEXT,
                        allowed_commercial INTEGER DEFAULT 1,
                        disclaimer_required INTEGER DEFAULT 1,
                        notes TEXT,
                        updated_at TEXT NOT NULL
                    )
                    """
                )

                # Schema migration helper: ensure monitored_channels has policy and etag columns
                try:
                    conn.execute("ALTER TABLE monitored_channels ADD COLUMN clipping_policy TEXT DEFAULT 'REVIEW_REQUIRED'")
                except sqlite3.OperationalError:
                    pass
                try:
                    conn.execute("ALTER TABLE monitored_channels ADD COLUMN etag TEXT")
                except sqlite3.OperationalError:
                    pass
                try:
                    conn.execute("ALTER TABLE monitored_channels ADD COLUMN last_modified TEXT")
                except sqlite3.OperationalError:
                    pass
                try:
                    conn.execute("ALTER TABLE monitored_channels ADD COLUMN paused INTEGER DEFAULT 0")
                except sqlite3.OperationalError:
                    pass
                try:
                    conn.execute("ALTER TABLE monitored_channels ADD COLUMN attribution_template TEXT")
                except sqlite3.OperationalError:
                    pass

                # Ensure rights_ledger carries extended manifest fields
                for col_sql in (
                    "ALTER TABLE rights_ledger ADD COLUMN creator_id TEXT",
                    "ALTER TABLE rights_ledger ADD COLUMN license_id TEXT",
                    "ALTER TABLE rights_ledger ADD COLUMN evidence_type TEXT",
                    "ALTER TABLE rights_ledger ADD COLUMN verified_by TEXT",
                    "ALTER TABLE rights_ledger ADD COLUMN revoked_at TEXT",
                    "ALTER TABLE rights_ledger ADD COLUMN revoked_by TEXT",
                    "ALTER TABLE rights_ledger ADD COLUMN revocation_reason TEXT",
                    "ALTER TABLE rights_ledger ADD COLUMN compliance_profile TEXT DEFAULT 'STRICT_LICENSED'",
                    "ALTER TABLE rights_ledger ADD COLUMN attribution_requirements_json TEXT",
                ):
                    try:
                        conn.execute(col_sql)
                    except sqlite3.OperationalError:
                        pass

                # 11. Append-Only Immutable Rights & Governance Audit Log
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS rights_audit_log (
                        audit_id TEXT PRIMARY KEY,
                        video_id TEXT NOT NULL,
                        rights_id TEXT,
                        creator_id TEXT,
                        action TEXT NOT NULL,
                        previous_status TEXT,
                        new_status TEXT NOT NULL,
                        basis TEXT,
                        actor TEXT NOT NULL,
                        reason TEXT,
                        evidence_ref TEXT,
                        metadata_json TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_vid_ts ON rights_audit_log(video_id, created_at);")
                conn.execute(
                    """
                    CREATE TRIGGER IF NOT EXISTS prevent_audit_log_update
                    BEFORE UPDATE ON rights_audit_log
                    BEGIN
                        SELECT RAISE(ABORT, 'rights_audit_log is append-only');
                    END;
                    """
                )
                conn.execute(
                    """
                    CREATE TRIGGER IF NOT EXISTS prevent_audit_log_delete
                    BEFORE DELETE ON rights_audit_log
                    BEGIN
                        SELECT RAISE(ABORT, 'rights_audit_log is append-only');
                    END;
                    """
                )

                # 12. Explicit Creator Approval Registry (Evidence-backed, default-deny)
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS creator_registry (
                        creator_key TEXT PRIMARY KEY,
                        creator_id TEXT,
                        channel_id TEXT UNIQUE,
                        channel_name TEXT NOT NULL,
                        creator_handle TEXT,
                        handle TEXT,
                        policy TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
                        approval_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
                        approval_evidence TEXT DEFAULT '',
                        approved_by TEXT,
                        evidence_url TEXT,
                        permission_scope TEXT,
                        expires_at TEXT,
                        approved_at TEXT,
                        revoked_at TEXT,
                        revocation_reason TEXT,
                        responsible_operator TEXT,
                        notes TEXT DEFAULT '',
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                for col_sql in (
                    "ALTER TABLE creator_registry ADD COLUMN handle TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN creator_handle TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN approval_status TEXT DEFAULT 'UNVERIFIED'",
                    "ALTER TABLE creator_registry ADD COLUMN approval_evidence TEXT DEFAULT ''",
                    "ALTER TABLE creator_registry ADD COLUMN approved_by TEXT",
                ):
                    try:
                        conn.execute(col_sql)
                    except sqlite3.OperationalError:
                        pass
                conn.execute("CREATE INDEX IF NOT EXISTS idx_creator_reg_chan ON creator_registry(channel_id);")

                # 13. Canonical Asset Manifests Table
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS asset_manifests (
                        asset_id TEXT PRIMARY KEY,
                        source_id TEXT NOT NULL,
                        original_source_url TEXT,
                        creator_id TEXT,
                        rights_basis TEXT NOT NULL,
                        rights_status TEXT NOT NULL,
                        compliance_profile TEXT NOT NULL,
                        approval_status TEXT NOT NULL,
                        content_hash TEXT,
                        manifest_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_asset_source ON asset_manifests(source_id);")

                # 14. Audio Risk Assessments Table
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS audio_risk_assessments (
                        assessment_id TEXT PRIMARY KEY,
                        video_id TEXT NOT NULL,
                        clip_id TEXT,
                        match_status TEXT NOT NULL,
                        risk_level TEXT NOT NULL,
                        segments_json TEXT,
                        review_required INTEGER DEFAULT 1,
                        reviewed_by TEXT,
                        reviewed_at TEXT,
                        replacement_audio_path TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )

                # 15. Gemini AI Usage & Prompt Audit Log
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS gemini_usage_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        capability TEXT NOT NULL,
                        model TEXT NOT NULL,
                        prompt_version TEXT NOT NULL,
                        status TEXT NOT NULL,
                        latency_ms REAL DEFAULT 0.0,
                        input_tokens INTEGER DEFAULT 0,
                        output_tokens INTEGER DEFAULT 0,
                        error_type TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )

                # 16. Transformative Commentary Drafts & Human Review Queue
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS commentary_drafts (
                        draft_id TEXT PRIMARY KEY,
                        video_id TEXT NOT NULL,
                        clip_id TEXT,
                        claim_topic TEXT NOT NULL,
                        outline_json TEXT,
                        narration_script TEXT NOT NULL,
                        fact_check_notes TEXT,
                        quality_flags_json TEXT,
                        quality_passed INTEGER DEFAULT 0,
                        approval_status TEXT DEFAULT 'REVIEW_REQUIRED',
                        reviewer TEXT,
                        reviewed_at TEXT,
                        tts_audio_path TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )

                # 17. Rights Revocation Impact Tracker
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS revocation_impacts (
                        impact_id TEXT PRIMARY KEY,
                        video_id TEXT,
                        creator_id TEXT,
                        target_type TEXT NOT NULL,
                        target_id TEXT NOT NULL,
                        action_taken TEXT NOT NULL,
                        review_required INTEGER DEFAULT 1,
                        notes TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )

                # 18. High-Risk Source Organization Rules (Configurable)
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS high_risk_sources (
                        rule_id TEXT PRIMARY KEY,
                        organization_name TEXT NOT NULL,
                        category TEXT NOT NULL,
                        channel_id TEXT,
                        keyword_pattern TEXT,
                        risk_level TEXT NOT NULL DEFAULT 'HIGH',
                        default_action TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
                        notes TEXT,
                        active INTEGER DEFAULT 1,
                        created_at TEXT NOT NULL
                    )
                    """
                )

                # 19. Multi-Tenant AI Platform: Tenants Table
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS tenants (
                        tenant_id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        api_key TEXT UNIQUE NOT NULL,
                        webhook_url TEXT,
                        webhook_secret TEXT,
                        status TEXT DEFAULT 'ACTIVE',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_tenants_api_key ON tenants(api_key);")

                # 20. Multi-Tenant AI Platform: Tenant Processing Quotas
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS tenant_quotas (
                        tenant_id TEXT PRIMARY KEY,
                        daily_render_limit INTEGER DEFAULT 100,
                        current_daily_renders INTEGER DEFAULT 0,
                        max_concurrent_jobs INTEGER DEFAULT 2,
                        storage_quota_bytes INTEGER DEFAULT 10737418240,
                        used_storage_bytes INTEGER DEFAULT 0,
                        reset_date TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
                    )
                    """
                )

                # 21. Multi-Tenant AI Platform: External AI Ingestion Projects
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS external_ai_projects (
                        project_id TEXT NOT NULL,
                        tenant_id TEXT NOT NULL,
                        job_id TEXT NOT NULL,
                        source_engine TEXT NOT NULL,
                        prompt_metadata_json TEXT,
                        transcript_json TEXT,
                        target_aspect_ratio TEXT DEFAULT '9:16',
                        audio_treatment_json TEXT,
                        omnipost_routing_json TEXT,
                        status TEXT NOT NULL,
                        video_url TEXT NOT NULL,
                        local_video_path TEXT,
                        output_clip_path TEXT,
                        file_hash TEXT,
                        rights_id TEXT,
                        omnipost_receipt_id TEXT,
                        error_message TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (tenant_id, project_id),
                        FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_ext_proj_job ON external_ai_projects(job_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_ext_proj_status ON external_ai_projects(tenant_id, status);")

                # 22. OmniPost Webhook Event Replay Prevention
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS omnipost_webhook_events (
                        event_id TEXT PRIMARY KEY,
                        event_type TEXT NOT NULL,
                        tenant_id TEXT,
                        project_id TEXT,
                        job_id TEXT,
                        content_id TEXT,
                        payload_json TEXT NOT NULL,
                        processed_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_omni_wh_job ON omnipost_webhook_events(job_id);")

        finally:
            conn.close()

    def create_tenant(
        self,
        tenant_id: str,
        name: str,
        api_key: str,
        webhook_url: Optional[str] = None,
        webhook_secret: Optional[str] = None,
        daily_render_limit: int = 100,
        max_concurrent_jobs: int = 2,
        storage_quota_bytes: int = 10 * 1024 * 1024 * 1024,
    ) -> Dict[str, Any]:
        now_iso = datetime.now(timezone.utc).isoformat()
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        conn = self.get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO tenants (tenant_id, name, api_key, webhook_url, webhook_secret, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
                    ON CONFLICT(tenant_id) DO UPDATE SET
                        name=excluded.name,
                        api_key=excluded.api_key,
                        webhook_url=excluded.webhook_url,
                        webhook_secret=excluded.webhook_secret,
                        updated_at=excluded.updated_at
                    """,
                    (tenant_id, name, api_key, webhook_url, webhook_secret, now_iso, now_iso),
                )
                conn.execute(
                    """
                    INSERT INTO tenant_quotas (tenant_id, daily_render_limit, current_daily_renders, max_concurrent_jobs, storage_quota_bytes, used_storage_bytes, reset_date, updated_at)
                    VALUES (?, ?, 0, ?, ?, 0, ?, ?)
                    ON CONFLICT(tenant_id) DO UPDATE SET
                        daily_render_limit=excluded.daily_render_limit,
                        max_concurrent_jobs=excluded.max_concurrent_jobs,
                        storage_quota_bytes=excluded.storage_quota_bytes,
                        updated_at=excluded.updated_at
                    """,
                    (tenant_id, daily_render_limit, max_concurrent_jobs, storage_quota_bytes, today_str, now_iso),
                )
            return self.get_tenant(tenant_id) or {}
        finally:
            conn.close()

    def get_tenant_by_api_key(self, api_key: str) -> Optional[Dict[str, Any]]:
        if not api_key:
            return None
        conn = self.get_connection()
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT t.*, q.daily_render_limit, q.current_daily_renders, q.max_concurrent_jobs,
                       q.storage_quota_bytes, q.used_storage_bytes, q.reset_date
                FROM tenants t
                LEFT JOIN tenant_quotas q ON t.tenant_id = q.tenant_id
                WHERE t.api_key = ? AND t.status = 'ACTIVE'
                """,
                (api_key.strip(),),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_tenant(self, tenant_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT t.*, q.daily_render_limit, q.current_daily_renders, q.max_concurrent_jobs,
                       q.storage_quota_bytes, q.used_storage_bytes, q.reset_date
                FROM tenants t
                LEFT JOIN tenant_quotas q ON t.tenant_id = q.tenant_id
                WHERE t.tenant_id = ?
                """,
                (tenant_id,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def check_and_increment_tenant_quota(self, tenant_id: str) -> Dict[str, Any]:
        """
        Validates daily limit and active concurrency; increments daily renders if within quota.
        Returns dict: {"allowed": bool, "reason": Optional[str], "code": Optional[str]}
        """
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        now_iso = datetime.now(timezone.utc).isoformat()
        conn = self.get_connection()
        try:
            with conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT * FROM tenant_quotas WHERE tenant_id = ?",
                    (tenant_id,),
                ).fetchone()
                if not row:
                    return {"allowed": True, "reason": None}

                daily_limit = row["daily_render_limit"]
                current_renders = row["current_daily_renders"]
                reset_date = row["reset_date"]
                max_concurrent = row["max_concurrent_jobs"]

                if reset_date != today_str:
                    current_renders = 0
                    conn.execute(
                        "UPDATE tenant_quotas SET current_daily_renders = 0, reset_date = ?, updated_at = ? WHERE tenant_id = ?",
                        (today_str, now_iso, tenant_id),
                    )

                if current_renders >= daily_limit:
                    return {
                        "allowed": False,
                        "reason": f"Daily render quota of {daily_limit} exceeded for tenant '{tenant_id}'.",
                        "code": "DAILY_QUOTA_EXCEEDED",
                    }

                active_count = conn.execute(
                    "SELECT COUNT(*) FROM external_ai_projects WHERE tenant_id = ? AND status IN ('QUEUED', 'DOWNLOADING', 'PROCESSING', 'RENDERING', 'QA_VERIFYING', 'PUBLISHING')",
                    (tenant_id,),
                ).fetchone()[0]

                if active_count >= max_concurrent:
                    return {
                        "allowed": False,
                        "reason": f"Maximum concurrent jobs limit ({max_concurrent}) reached for tenant '{tenant_id}'.",
                        "code": "CONCURRENCY_QUOTA_EXCEEDED",
                    }

                conn.execute(
                    "UPDATE tenant_quotas SET current_daily_renders = current_daily_renders + 1, updated_at = ? WHERE tenant_id = ?",
                    (now_iso, tenant_id),
                )
                return {"allowed": True, "reason": None}
        finally:
            conn.close()

    def refund_tenant_quota(self, tenant_id: str) -> None:
        """Decrements daily render count if a job fails before completion."""
        conn = self.get_connection()
        try:
            with conn:
                conn.execute(
                    "UPDATE tenant_quotas SET current_daily_renders = MAX(0, current_daily_renders - 1) WHERE tenant_id = ?",
                    (tenant_id,),
                )
        finally:
            conn.close()

    def create_external_ai_project(
        self,
        project_id: str,
        tenant_id: str,
        job_id: str,
        source_engine: str,
        video_url: str,
        prompt_metadata: Optional[Dict[str, Any]] = None,
        transcript: Optional[List[Dict[str, Any]]] = None,
        target_aspect_ratio: str = "9:16",
        audio_treatment: Optional[Dict[str, Any]] = None,
        omnipost_routing: Optional[Dict[str, Any]] = None,
        file_hash: Optional[str] = None,
        rights_id: Optional[str] = None,
        local_video_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        now_iso = datetime.now(timezone.utc).isoformat()
        conn = self.get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO external_ai_projects (
                        project_id, tenant_id, job_id, source_engine, prompt_metadata_json,
                        transcript_json, target_aspect_ratio, audio_treatment_json,
                        omnipost_routing_json, status, video_url, local_video_path,
                        file_hash, rights_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(tenant_id, project_id) DO UPDATE SET
                        job_id=excluded.job_id,
                        source_engine=excluded.source_engine,
                        prompt_metadata_json=excluded.prompt_metadata_json,
                        transcript_json=excluded.transcript_json,
                        target_aspect_ratio=excluded.target_aspect_ratio,
                        audio_treatment_json=excluded.audio_treatment_json,
                        omnipost_routing_json=excluded.omnipost_routing_json,
                        status='QUEUED',
                        video_url=excluded.video_url,
                        local_video_path=excluded.local_video_path,
                        file_hash=excluded.file_hash,
                        rights_id=excluded.rights_id,
                        updated_at=excluded.updated_at
                    """,
                    (
                        project_id,
                        tenant_id,
                        job_id,
                        source_engine,
                        json.dumps(prompt_metadata) if prompt_metadata else None,
                        json.dumps(transcript) if transcript else None,
                        target_aspect_ratio,
                        json.dumps(audio_treatment) if audio_treatment else None,
                        json.dumps(omnipost_routing) if omnipost_routing else None,
                        video_url,
                        local_video_path,
                        file_hash,
                        rights_id,
                        now_iso,
                        now_iso,
                    ),
                )
            return self.get_external_ai_project(tenant_id, project_id) or {}
        finally:
            conn.close()

    def update_external_ai_project(
        self,
        tenant_id: str,
        project_id: str,
        status: Optional[str] = None,
        local_video_path: Optional[str] = None,
        output_clip_path: Optional[str] = None,
        file_hash: Optional[str] = None,
        rights_id: Optional[str] = None,
        omnipost_receipt_id: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        conn = self.get_connection()
        try:
            updates = ["updated_at = ?"]
            params = [now_iso]
            if status is not None:
                updates.append("status = ?")
                params.append(status)
            if local_video_path is not None:
                updates.append("local_video_path = ?")
                params.append(local_video_path)
            if output_clip_path is not None:
                updates.append("output_clip_path = ?")
                params.append(output_clip_path)
            if file_hash is not None:
                updates.append("file_hash = ?")
                params.append(file_hash)
            if rights_id is not None:
                updates.append("rights_id = ?")
                params.append(rights_id)
            if omnipost_receipt_id is not None:
                updates.append("omnipost_receipt_id = ?")
                params.append(omnipost_receipt_id)
            if error_message is not None:
                updates.append("error_message = ?")
                params.append(error_message)
            params.extend([tenant_id, project_id])
            sql = f"UPDATE external_ai_projects SET {', '.join(updates)} WHERE tenant_id = ? AND project_id = ?"
            with conn:
                conn.execute(sql, params)
        finally:
            conn.close()

    def get_external_ai_project(self, tenant_id: str, project_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM external_ai_projects WHERE tenant_id = ? AND project_id = ?",
                (tenant_id, project_id),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_external_ai_project_by_job_id(self, job_id: str, tenant_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            conn.row_factory = sqlite3.Row
            if tenant_id:
                row = conn.execute(
                    "SELECT * FROM external_ai_projects WHERE job_id = ? AND tenant_id = ?",
                    (job_id, tenant_id),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM external_ai_projects WHERE job_id = ?",
                    (job_id,),
                ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def has_processed_webhook_event(self, event_id: str) -> bool:
        if not event_id:
            return False
        conn = self.get_connection()
        try:
            row = conn.execute(
                "SELECT 1 FROM omnipost_webhook_events WHERE event_id = ?",
                (event_id,),
            ).fetchone()
            return bool(row)
        finally:
            conn.close()

    def record_omnipost_webhook_event(
        self,
        event_id: str,
        event_type: str,
        tenant_id: Optional[str],
        project_id: Optional[str],
        job_id: Optional[str],
        content_id: Optional[str],
        payload: Dict[str, Any],
    ) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        conn = self.get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO omnipost_webhook_events (
                        event_id, event_type, tenant_id, project_id, job_id, content_id, payload_json, processed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        event_id,
                        event_type,
                        tenant_id,
                        project_id,
                        job_id,
                        content_id,
                        json.dumps(payload),
                        now_iso,
                    ),
                )
        finally:
            conn.close()
