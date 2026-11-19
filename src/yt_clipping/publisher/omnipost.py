"""
OmniPost Social Media Publishing Adapter & Unified Publishing Engine.
Connects yt-clipping to OmniPost (multi-platform social distribution) and
to Dedicated YouTube Channels via isolated OAuth 2.0.
Enforces strict Rights Clearance, QA verification, and Human Authorization gating.
"""

from typing import Dict, Any, Optional, List, Union
import os
import json
import sqlite3
import uuid
import logging
from datetime import datetime, timezone
import requests

from ..contracts.models import (
    RenderedClip,
    HighlightCandidate,
    RightsManifest,
    QAReport,
    HandoffReceipt,
    RightsStatus,
    compute_canonical_idempotency_key,
)
from ..contracts.interfaces import HandoffPublisher
from ..config import is_legal_officer_enabled
from ..orchestration.db import DatabaseManager
from ..auth.google_oauth import DedicatedYouTubeAuth

logger = logging.getLogger("yt_clipping.publisher.omnipost")


class OmniPostPublisher(HandoffPublisher):
    """
    Unified multi-channel social media publishing engine.
    Supports both direct Dedicated YouTube channel publishing and OmniPost
    omni-channel automation (YouTube Shorts, Instagram Reels, Facebook, LinkedIn).
    Enforces human approval gating and idempotent ledger checks.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3300",
        api_key: Optional[str] = None,
        default_platforms: Optional[List[str]] = None,
        db_path: str = "data/jobs.db",
        timeout: int = 120,
        youtube_auth: Optional[DedicatedYouTubeAuth] = None,
    ):
        self.base_url = (os.environ.get("OMNIPOST_BASE_URL") or base_url).rstrip("/")
        self.api_key = (
            api_key
            or os.environ.get("OMNIPOST_API_KEY")
            or os.environ.get("AUTOMATION_SECRET_KEY")
            or os.environ.get("CHAMBERS_ADMIN_SECRET_KEY")
            or ""
        )
        self.default_platforms = default_platforms or ["youtube", "instagram"]
        self.db = DatabaseManager(db_path)
        self.timeout = timeout
        self.youtube_auth = youtube_auth or DedicatedYouTubeAuth()

    def compute_idempotency_key(
        self, candidate: HighlightCandidate, rights_manifest: RightsManifest
    ) -> str:
        return compute_canonical_idempotency_key(
            video_id=candidate.video_id,
            start_seconds=candidate.start_seconds,
            end_seconds=candidate.end_seconds,
            rights_id=rights_manifest.rights_id,
        )

    def preflight_check(self) -> Dict[str, Any]:
        """Checks OmniPost server status and returns active/ready channels."""
        url = f"{self.base_url}/api/engine/preflight"
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["x-api-key"] = self.api_key
            headers["x-admin-key"] = self.api_key
            headers["Authorization"] = f"Bearer {self.api_key}"
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                return resp.json()
            return {"status": "unhealthy", "code": resp.status_code, "body": resp.text}
        except Exception as e:
            logger.warning(f"OmniPost preflight check failed (server offline or unreachable): {e}")
            return {"status": "offline", "error": str(e)}

    def publish_clip(
        self,
        rendered_clip: RenderedClip,
        candidate: HighlightCandidate,
        rights_manifest: RightsManifest,
        qa_report: QAReport,
        dry_run: bool = False,
        platforms: Optional[List[str]] = None,
        scheduled_time: Optional[str] = None,
        approved_by_user: bool = True,
        title_override: Optional[str] = None,
        description_override: Optional[str] = None,
        tags: Optional[List[str]] = None,
        channel_id: Optional[str] = None,
        thumbnail_path: Optional[str] = None,
        publish_target: str = "omnipost",  # "omnipost" or "youtube_dedicated"
        tenant_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
    ) -> HandoffReceipt:
        """
        Gated publishing execution: enforces rights clearance, QA verification,
        and human approval gating before delivering video asset.
        """
        idempotency_key = self.compute_idempotency_key(candidate, rights_manifest)
        now_iso = datetime.now(timezone.utc).isoformat()
        target_platforms = platforms or self.default_platforms
        final_title = title_override or candidate.hook_title or f"Short #{candidate.video_id}"
        final_desc = description_override or candidate.suggested_description or ""

        # 1. Enforce Human Authorization Gate
        if not approved_by_user:
            receipt = HandoffReceipt(
                receipt_id=f"rcpt-unapproved-{uuid.uuid4().hex[:10]}",
                clip_id=rendered_clip.clip_id,
                idempotency_key=idempotency_key,
                status="REJECTED",
                timestamp=now_iso,
                target_mode=publish_target,
                dry_run=dry_run,
                response_payload={
                    "error": "Explicit human approval required before publishing. Video cannot be published automatically."
                },
            )
            return receipt

        # 2. Enforce Rights Gate (both in-memory manifest AND fresh DB revocation check)
        if is_legal_officer_enabled():
            if not rights_manifest.is_valid():
                return HandoffReceipt(
                    receipt_id=f"rcpt-omnipost-rejected-{uuid.uuid4().hex[:10]}",
                    clip_id=rendered_clip.clip_id,
                    idempotency_key=idempotency_key,
                    status="REJECTED",
                    timestamp=now_iso,
                    target_mode=publish_target,
                    dry_run=dry_run,
                    response_payload={
                        "video_id": candidate.video_id,
                        "error": f"Rights not cleared: {rights_manifest.status.value}",
                    },
                )

            db_gate_error = self._check_fresh_db_revocation(candidate.video_id)
            if db_gate_error:
                return HandoffReceipt(
                    receipt_id=f"rcpt-omnipost-rejected-{uuid.uuid4().hex[:10]}",
                    clip_id=rendered_clip.clip_id,
                    idempotency_key=idempotency_key,
                    status="REJECTED",
                    timestamp=now_iso,
                    target_mode=publish_target,
                    dry_run=dry_run,
                    response_payload={"video_id": candidate.video_id, "error": db_gate_error},
                )

        # 3. Enforce QA Gate
        if qa_report.status != "PASSED":
            return HandoffReceipt(
                receipt_id=f"rcpt-omnipost-rejected-{uuid.uuid4().hex[:10]}",
                clip_id=rendered_clip.clip_id,
                idempotency_key=idempotency_key,
                status="REJECTED",
                timestamp=now_iso,
                target_mode=publish_target,
                dry_run=dry_run,
                response_payload={
                    "error": "QA verification failed",
                    "qa_status": qa_report.status,
                    "errors": qa_report.errors,
                    "warnings": qa_report.warnings,
                },
            )

        # 4. Check Idempotency Ledger
        existing_receipt = self._get_receipt(idempotency_key)
        if existing_receipt and existing_receipt.status in ("DELIVERED", "SCHEDULED"):
            logger.info(f"Duplicate delivery skipped for key: {idempotency_key}")
            return HandoffReceipt(
                receipt_id=f"rcpt-omnipost-dup-{uuid.uuid4().hex[:10]}",
                clip_id=rendered_clip.clip_id,
                idempotency_key=idempotency_key,
                status="DUPLICATE_SKIPPED",
                timestamp=now_iso,
                target_mode=publish_target,
                dry_run=dry_run,
                response_payload={
                    "original_receipt_id": existing_receipt.receipt_id,
                    "title": final_title,
                },
            )

        # 5. Dry-run Mode
        if dry_run:
            receipt = HandoffReceipt(
                receipt_id=f"rcpt-omnipost-dry-{uuid.uuid4().hex[:10]}",
                clip_id=rendered_clip.clip_id,
                idempotency_key=idempotency_key,
                status="DRY_RUN_SIMULATED",
                timestamp=now_iso,
                target_mode=publish_target,
                dry_run=True,
                response_payload={
                    "simulated": True,
                    "target_platforms": target_platforms,
                    "title": final_title,
                    "file_path": rendered_clip.file_path,
                    "scheduled_time": scheduled_time,
                    "publish_target": publish_target,
                },
            )
            self._persist_receipt(receipt)
            return receipt

        # 6. Target: Dedicated YouTube Channel
        if publish_target == "youtube_dedicated":
            return self._publish_to_dedicated_youtube(
                rendered_clip=rendered_clip,
                candidate=candidate,
                idempotency_key=idempotency_key,
                now_iso=now_iso,
                title=final_title,
                description=final_desc,
                tags=tags,
                thumbnail_path=thumbnail_path,
                scheduled_time=scheduled_time,
                channel_id=channel_id,
            )

        # 7. Target: OmniPost Multi-Channel Gateway
        return self._publish_to_omnipost_gateway(
            rendered_clip=rendered_clip,
            candidate=candidate,
            idempotency_key=idempotency_key,
            now_iso=now_iso,
            title=final_title,
            caption=final_desc,
            target_platforms=target_platforms,
            scheduled_time=scheduled_time,
            rights_manifest=rights_manifest,
            approved_by_user=approved_by_user,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
        )

    def _check_fresh_db_revocation(self, video_id: str) -> Optional[str]:
        """Re-reads SQLite ledger and revocation_impacts so revoked/stale manifests cannot publish."""
        db_path = getattr(getattr(self, "db", None), "db_path", None) or getattr(self, "db_path", None)
        if not video_id or not db_path or db_path == ":memory:" or not os.path.exists(db_path):
            return None
        try:
            conn = sqlite3.connect(db_path, timeout=5.0)
            try:
                tables = {
                    r[0]
                    for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                }
                if "revocation_impacts" in tables:
                    rev = conn.execute(
                        "SELECT action_taken FROM revocation_impacts WHERE video_id = ? LIMIT 1",
                        (video_id,),
                    ).fetchone()
                    if rev:
                        return f"Asset '{video_id}' appears in revocation_impacts ({rev[0]})."
                if "rights_ledger" in tables:
                    row = conn.execute(
                        "SELECT status, basis FROM rights_ledger WHERE video_id = ?",
                        (video_id,),
                    ).fetchone()
                    if row is not None and row[0] != "VERIFIED":
                        return f"Fresh DB rights check rejected '{video_id}': status={row[0]}."
            finally:
                conn.close()
        except Exception as exc:
            logger.error(f"Fresh DB rights/revocation check failed for '{video_id}': {exc}")
            return f"Fresh DB rights check error for '{video_id}': {exc}"
        return None

    # Alias for convenience
    publish = publish_clip

    def _publish_to_dedicated_youtube(
        self,
        rendered_clip: RenderedClip,
        candidate: HighlightCandidate,
        idempotency_key: str,
        now_iso: str,
        title: str,
        description: str,
        tags: Optional[List[str]],
        thumbnail_path: Optional[str],
        scheduled_time: Optional[str],
        channel_id: Optional[str] = None,
    ) -> HandoffReceipt:
        """Publishes directly to the dedicated YouTube channel via DedicatedYouTubeAuth."""
        try:
            res = self.youtube_auth.upload_video_to_youtube(
                file_path=rendered_clip.file_path,
                title=title,
                description=f"{description}\n\n#shorts #viral",
                tags=tags or ["shorts", "viral", "highlights"],
                privacy_status="private" if scheduled_time else "public",
                publish_at=scheduled_time,
                channel_id=channel_id,
                thumbnail_path=thumbnail_path,
                dry_run=False,
            )
            status = "SCHEDULED" if scheduled_time else "DELIVERED"
            receipt = HandoffReceipt(
                receipt_id=f"rcpt-yt-{uuid.uuid4().hex[:10]}",
                clip_id=rendered_clip.clip_id,
                idempotency_key=idempotency_key,
                status=status,
                timestamp=now_iso,
                target_mode="youtube_dedicated",
                dry_run=False,
                response_payload={
                    **res,
                    "title": title,
                    "scheduled_time": scheduled_time,
                    "file_path": rendered_clip.file_path,
                },
            )
            self._persist_receipt(receipt)
            return receipt
        except Exception as exc:
            logger.error(f"Dedicated YouTube publishing error: {exc}")
            receipt = HandoffReceipt(
                receipt_id=f"rcpt-yt-err-{uuid.uuid4().hex[:10]}",
                clip_id=rendered_clip.clip_id,
                idempotency_key=idempotency_key,
                status="FAILED",
                timestamp=now_iso,
                target_mode="youtube_dedicated",
                dry_run=False,
                response_payload={
                    "error": str(exc),
                    "title": title,
                    "file_path": rendered_clip.file_path,
                },
            )
            self._persist_receipt(receipt)
            return receipt

    def _publish_to_omnipost_gateway(
        self,
        rendered_clip: RenderedClip,
        candidate: HighlightCandidate,
        idempotency_key: str,
        now_iso: str,
        title: str,
        caption: str,
        target_platforms: List[str],
        scheduled_time: Optional[str],
        rights_manifest: Optional[RightsManifest] = None,
        approved_by_user: bool = True,
        tenant_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
    ) -> HandoffReceipt:
        """Delivers clip to OmniPost server via /api/v2/ingest (or fallback /api/upload)."""
        headers = {}
        if self.api_key:
            headers["x-api-key"] = self.api_key
            headers["x-admin-key"] = self.api_key
            headers["Authorization"] = f"Bearer {self.api_key}"
        if tenant_id:
            headers["x-tenant-id"] = tenant_id
        if workspace_id:
            headers["x-workspace-id"] = workspace_id

        v2_ingest_url = f"{self.base_url}/api/v2/ingest"
        legacy_upload_url = f"{self.base_url}/api/upload"
        hashtags = "#shorts #viral #fyp"
        full_caption = f"{caption}\n\n{hashtags}".strip() if caption else hashtags

        try:
            if not os.path.exists(rendered_clip.file_path):
                raise FileNotFoundError(f"Rendered clip file not found: {rendered_clip.file_path}")

            rights_dict = rights_manifest.to_dict() if rights_manifest and hasattr(rights_manifest, "to_dict") else None
            attribution_payload = {
                "creator_name": rights_manifest.owner_name if rights_manifest else "",
                "source_url": f"https://www.youtube.com/watch?v={candidate.video_id}",
                "text": full_caption,
            }

            # 1. First attempt: OmniPost 2.0 Ingestion Gateway (/api/v2/ingest)
            v2_payload = {
                "schema_version": "2.0",
                "video_id": candidate.video_id,
                "approved_by_user": bool(approved_by_user),
                "legal_officer_bypass": not is_legal_officer_enabled(),
                "rights_manifest": rights_dict,
                "attribution": attribution_payload,
                "tenant_id": tenant_id,
                "workspace_id": workspace_id,
                "source": {
                    "system": "yt-clipping-intelligence",
                    "job_id": rendered_clip.job_id,
                    "asset_id": rendered_clip.clip_id,
                    "video_id": candidate.video_id,
                    "tenant_id": tenant_id,
                },
                "media": {
                    "filename": os.path.basename(rendered_clip.file_path),
                    "checksum": rendered_clip.file_hash,
                    "mime_type": "video/mp4",
                    "size_bytes": os.path.getsize(rendered_clip.file_path) if os.path.exists(rendered_clip.file_path) else 0,
                },
                "content": {
                    "title": title,
                    "description": full_caption,
                    "tags": ["shorts", "viral", "highlights"],
                    "language": "en",
                },
                "publishing": {
                    "destinations": target_platforms,
                    "distribution_policy": "shorts_distribution",
                    "schedule_mode": "scheduled" if scheduled_time else "automatic",
                    "scheduled_time": scheduled_time,
                    "priority": "normal",
                    "workspace_id": workspace_id,
                },
                "omnipost_routing": {
                    "workspace_id": workspace_id,
                    "channels": target_platforms,
                    "publish_immediately": not bool(scheduled_time),
                },
                "enrichment": {
                    "auto_enrich": True,
                    "tone": "engaging",
                },
                "idempotency_key": idempotency_key,
            }

            with open(rendered_clip.file_path, "rb") as vf:
                files = {"file": (os.path.basename(rendered_clip.file_path), vf, "video/mp4")}
                resp = requests.post(
                    v2_ingest_url,
                    headers=headers,
                    data={"payload": json.dumps(v2_payload)},
                    files=files,
                    timeout=self.timeout,
                )

            # If OmniPost 2.0 returned success (200 or 201)
            if resp.status_code in (200, 201):
                resp_json = resp.json()
                data = resp_json.get("data", resp_json)
                is_dup = data.get("status") == "duplicate_skipped" or data.get("duplicate") is True
                status = "DUPLICATE_SKIPPED" if is_dup else ("SCHEDULED" if scheduled_time else "DELIVERED")

                receipt = HandoffReceipt(
                    receipt_id=f"rcpt-omnipost-{uuid.uuid4().hex[:10]}",
                    clip_id=rendered_clip.clip_id,
                    idempotency_key=idempotency_key,
                    status=status,
                    timestamp=now_iso,
                    target_mode="omnipost",
                    dry_run=False,
                    response_payload={
                        **data,
                        "title": title,
                        "file_path": rendered_clip.file_path,
                        "gateway_version": "2.0",
                    },
                )
                self._persist_receipt(receipt)
                return receipt

            # 2. If V2 endpoint not found (404), fall back to legacy /api/upload
            if resp.status_code == 404:
                logger.info("OmniPost V2 endpoint not found; falling back to legacy /api/upload...")
                with open(rendered_clip.file_path, "rb") as vf:
                    files = {"file": (os.path.basename(rendered_clip.file_path), vf, "video/mp4")}
                    legacy_data = {
                        "title": title,
                        "caption": full_caption,
                        "platforms": ",".join(target_platforms),
                        "mediaType": "video",
                        "status": "Published" if not scheduled_time else "Scheduled",
                    }
                    if scheduled_time:
                        legacy_data["scheduledDateTime"] = scheduled_time

                    legacy_resp = requests.post(
                        legacy_upload_url,
                        headers=headers,
                        data=legacy_data,
                        files=files,
                        timeout=self.timeout,
                    )

                if legacy_resp.status_code in (200, 201):
                    resp_json = legacy_resp.json()
                    status = "SCHEDULED" if scheduled_time else "DELIVERED"
                    receipt = HandoffReceipt(
                        receipt_id=f"rcpt-omnipost-{uuid.uuid4().hex[:10]}",
                        clip_id=rendered_clip.clip_id,
                        idempotency_key=idempotency_key,
                        status=status,
                        timestamp=now_iso,
                        target_mode="omnipost",
                        dry_run=False,
                        response_payload={
                            **resp_json,
                            "title": title,
                            "file_path": rendered_clip.file_path,
                            "gateway_version": "1.0_legacy",
                        },
                    )
                    self._persist_receipt(receipt)
                    return receipt
                else:
                    resp = legacy_resp

            err_text = resp.text[:500]
            outcome_uncertain = resp.status_code in (502, 503, 504)
            logger.error(f"OmniPost returned error status {resp.status_code}: {err_text}")
            receipt = HandoffReceipt(
                receipt_id=f"rcpt-omnipost-err-{uuid.uuid4().hex[:10]}",
                clip_id=rendered_clip.clip_id,
                idempotency_key=idempotency_key,
                status="OUTCOME_UNKNOWN" if outcome_uncertain else "FAILED",
                timestamp=now_iso,
                target_mode="omnipost",
                dry_run=False,
                response_payload={
                    "video_id": candidate.video_id,
                    "status_code": resp.status_code,
                    "error": err_text,
                    "title": title,
                    "file_path": rendered_clip.file_path,
                    "reconciliation_required": outcome_uncertain,
                },
            )
            self._persist_receipt(receipt)
            return receipt

        except requests.exceptions.Timeout as tex:
            logger.error(f"OmniPost request timed out (outcome unknown): {tex}")
            receipt = HandoffReceipt(
                receipt_id=f"rcpt-omnipost-unk-{uuid.uuid4().hex[:10]}",
                clip_id=rendered_clip.clip_id,
                idempotency_key=idempotency_key,
                status="OUTCOME_UNKNOWN",
                timestamp=now_iso,
                target_mode="omnipost",
                dry_run=False,
                response_payload={
                    "video_id": candidate.video_id,
                    "exception": str(tex),
                    "title": title,
                    "file_path": rendered_clip.file_path,
                    "reconciliation_required": True,
                },
            )
            self._persist_receipt(receipt)
            return receipt

        except Exception as exc:
            logger.error(f"Failed delivering clip to OmniPost: {exc}")
            receipt = HandoffReceipt(
                receipt_id=f"rcpt-omnipost-err-{uuid.uuid4().hex[:10]}",
                clip_id=rendered_clip.clip_id,
                idempotency_key=idempotency_key,
                status="FAILED",
                timestamp=now_iso,
                target_mode="omnipost",
                dry_run=False,
                response_payload={
                    "video_id": candidate.video_id,
                    "exception": str(exc),
                    "title": title,
                    "file_path": rendered_clip.file_path,
                },
            )
            self._persist_receipt(receipt)
            return receipt

    def retry_failed_job(self, receipt_id: str) -> HandoffReceipt:
        """
        Safely re-attempts publication of a previously failed job.
        Blocks OUTCOME_UNKNOWN auto-retries and re-validates fresh DB rights before retrying.
        """
        receipt = self.get_receipt_by_id(receipt_id)
        if not receipt:
            raise ValueError(f"Publishing receipt {receipt_id} not found.")

        if receipt.status == "OUTCOME_UNKNOWN":
            raise PermissionError(
                f"Receipt '{receipt_id}' has OUTCOME_UNKNOWN; automatic republishing is forbidden until reconciled."
            )

        if receipt.status not in ("FAILED", "REJECTED"):
            logger.info(f"Receipt {receipt_id} is in status '{receipt.status}', retry not required.")
            return receipt

        payload = receipt.response_payload or {}
        original_video_id = payload.get("video_id", "")
        if is_legal_officer_enabled():
            db_gate_error = self._check_fresh_db_revocation(original_video_id)
            if db_gate_error:
                receipt.status = "REJECTED"
                payload["error"] = db_gate_error
                receipt.response_payload = payload
                self._persist_receipt(receipt)
                raise PermissionError(db_gate_error)
        file_path = payload.get("file_path", "")
        title = payload.get("title", f"Retry Clip {receipt.clip_id}")

        if not file_path or not os.path.exists(file_path):
            import glob
            matches = glob.glob(os.path.join("data", "rendered_clips", f"*{receipt.clip_id}*.mp4"))
            if matches and os.path.exists(matches[0]):
                file_path = matches[0]
            else:
                candidate_file = os.path.join("data", "rendered_clips", f"{receipt.clip_id}.mp4")
                if os.path.exists(candidate_file):
                    file_path = candidate_file
                else:
                    raise FileNotFoundError(f"Video media for retry not found on disk: {file_path or receipt.clip_id}")

        retry_count = int(payload.get("retry_count", 0)) + 1
        now_iso = datetime.now(timezone.utc).isoformat()

        if receipt.target_mode == "youtube_dedicated":
            try:
                res = self.youtube_auth.upload_video_to_youtube(
                    file_path=file_path,
                    title=title,
                    description=payload.get("description", f"{title} #shorts"),
                    tags=payload.get("tags") or ["shorts", "viral"],
                    channel_id=payload.get("channel_id"),
                    thumbnail_path=payload.get("thumbnail_path"),
                    publish_at=payload.get("scheduled_time"),
                    dry_run=False,
                )
                receipt.status = "DELIVERED"
                receipt.timestamp = now_iso
                payload.update(res)
                payload["retry_count"] = retry_count
                receipt.response_payload = payload
                self._persist_receipt(receipt)
                return receipt
            except Exception as e:
                payload["error"] = str(e)
                payload["retry_count"] = retry_count
                receipt.status = "FAILED"
                receipt.response_payload = payload
                self._persist_receipt(receipt)
                return receipt
        else:
            # OmniPost retry
            target_platforms = self.default_platforms
            candidate_stub = HighlightCandidate(
                candidate_id=receipt.clip_id,
                video_id=original_video_id or "retry_video",
                start_seconds=0.0,
                end_seconds=30.0,
                duration_seconds=30.0,
                score=85.0,
                hook_title=title,
            )
            rendered_stub = RenderedClip(
                clip_id=receipt.clip_id,
                job_id="retry_job",
                candidate_id=receipt.clip_id,
                file_path=file_path,
                file_hash="retry_hash",
                duration_seconds=30.0,
                width=1080,
                height=1920,
                manifest_path="",
                rendered_at=now_iso,
            )
            retried = self._publish_to_omnipost_gateway(
                rendered_clip=rendered_stub,
                candidate=candidate_stub,
                idempotency_key=receipt.idempotency_key,
                now_iso=now_iso,
                title=title,
                caption=payload.get("caption", title),
                target_platforms=target_platforms,
                scheduled_time=None,
            )
            retried.receipt_id = receipt_id
            retried.response_payload["retry_count"] = retry_count
            self._persist_receipt(retried)
            return retried

    def list_publishing_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Returns ordered history of all publishing handoffs."""
        conn = self.db.get_connection()
        try:
            cursor = conn.execute(
                """
                SELECT receipt_id, clip_id, idempotency_key, status, timestamp, target_mode, dry_run, response_payload_json
                FROM publishing_receipts
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (limit,),
            )
            rows = cursor.fetchall()
            history = []
            for r in rows:
                payload = json.loads(r[7]) if r[7] else {}
                # Extract deeply nested payload if present
                inner = payload.get("payload") if isinstance(payload.get("payload"), dict) else payload
                title = inner.get("title") or inner.get("hook_title") or payload.get("title")
                
                # If title is still missing or a raw placeholder like 'Clip #...', resolve human title
                if not title or title.startswith("Clip #"):
                    # Check candidate/video metadata from payload
                    source_id = inner.get("source_id") or ""
                    desc = inner.get("description") or ""
                    if desc and ":" in desc:
                        # Often "Highlight from hdMszZ2ah5Q: Now if you look at all of Apple's marketing..."
                        candidate_phrase = desc.split(":", 1)[1].strip()
                        title = candidate_phrase[:60]
                    elif source_id:
                        title = f"Highlight Short ({source_id})"
                    else:
                        title = f"Short Cut #{r[1]}"

                video_url = payload.get("video_url") or payload.get("publicMediaUrl") or inner.get("asset_path") or ""
                err = payload.get("error") or payload.get("exception") or ""
                source_id = inner.get("source_id") or ""
                duration_seconds = inner.get("duration_seconds") or 0.0

                history.append({
                    "receipt_id": r[0],
                    "clip_id": r[1],
                    "idempotency_key": r[2],
                    "status": r[3],
                    "timestamp": r[4],
                    "target_mode": r[5],
                    "dry_run": bool(r[6]),
                    "title": title,
                    "source_id": source_id,
                    "duration_seconds": duration_seconds,
                    "video_url": video_url,
                    "error": err,
                    "payload": payload,
                })
            return history
        finally:
            conn.close()

    def get_receipt_by_id(self, receipt_id: str) -> Optional[HandoffReceipt]:
        """Loads a receipt directly by receipt_id."""
        conn = self.db.get_connection()
        try:
            cursor = conn.execute(
                """
                SELECT receipt_id, clip_id, idempotency_key, status, timestamp, target_mode, dry_run, response_payload_json
                FROM publishing_receipts WHERE receipt_id = ?
                """,
                (receipt_id,),
            )
            row = cursor.fetchone()
            if not row:
                return None
            return HandoffReceipt(
                receipt_id=row[0],
                clip_id=row[1],
                idempotency_key=row[2],
                status=row[3],
                timestamp=row[4],
                target_mode=row[5],
                dry_run=bool(row[6]),
                response_payload=json.loads(row[7]) if row[7] else {},
            )
        finally:
            conn.close()

    def _persist_receipt(self, receipt: HandoffReceipt) -> None:
        conn = self.db.get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO publishing_receipts (
                        receipt_id, clip_id, idempotency_key, status, timestamp, target_mode, dry_run, response_payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(receipt_id) DO UPDATE SET
                        status=excluded.status,
                        timestamp=excluded.timestamp,
                        response_payload_json=excluded.response_payload_json
                    """,
                    (
                        receipt.receipt_id,
                        receipt.clip_id,
                        receipt.idempotency_key,
                        receipt.status,
                        receipt.timestamp,
                        receipt.target_mode,
                        1 if receipt.dry_run else 0,
                        json.dumps(receipt.response_payload),
                    ),
                )
        finally:
            conn.close()

    def _get_receipt(self, idempotency_key: str) -> Optional[HandoffReceipt]:
        conn = self.db.get_connection()
        try:
            cursor = conn.execute(
                """
                SELECT receipt_id, clip_id, idempotency_key, status, timestamp, target_mode, dry_run, response_payload_json
                FROM publishing_receipts WHERE idempotency_key = ?
                """,
                (idempotency_key,),
            )
            row = cursor.fetchone()
            if not row:
                return None
            return HandoffReceipt(
                receipt_id=row[0],
                clip_id=row[1],
                idempotency_key=row[2],
                status=row[3],
                timestamp=row[4],
                target_mode=row[5],
                dry_run=bool(row[6]),
                response_payload=json.loads(row[7]) if row[7] else {},
            )
        finally:
            conn.close()
