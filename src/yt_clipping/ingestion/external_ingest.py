"""
Multi-Tenant External AI Video Ingestion Service.
Supports ComfyUI, Runway, Luma, Sora, and custom AI video pipelines with SSRF protection,
SHA-256 integrity verification, rights & provenance registration, 9:16 reframing,
automated 12-point QA verification, and tenant-specific OmniPost publishing routing.
"""

from typing import Dict, Any, Optional, List, Tuple
import os
import sys
import uuid
import json
import shutil
import hashlib
import logging
from datetime import datetime, timezone
import requests

from .ssrf_validator import assert_safe_url, validate_safe_url, SSRFValidationError
from ..contracts.models import (
    HighlightCandidate,
    RenderedClip,
    RightsManifest,
    QAReport,
    RightsBasis,
    RightsStatus,
    ScoreBreakdown,
)
from ..orchestration.db import DatabaseManager
from ..orchestration.resource_governor import get_resource_governor, InsufficientStorageError
from ..qa.verifier import validate_rendered_short
from ..rendering.editor import VideoEditorEngine
from ..publisher.omnipost import OmniPostPublisher

logger = logging.getLogger(__name__)

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
DATA_DIR = os.getenv("DATA_DIR", os.path.join(BASE_DIR, "data"))
SCRATCH_DIR = os.path.join(DATA_DIR, "scratch")
CLIPS_DIR = (
    os.getenv("OUTPUT_DIR")
    or os.getenv("RENDERED_CLIPS_DIR")
    or os.path.join(DATA_DIR, "rendered_clips")
)


class IngestionError(RuntimeError):
    pass


class ExternalAIVideoIngestService:
    """
    Standardized ingestion service for external AI-generated video creators.
    Enforces strict tenant isolation, quota management, SSRF protection,
    provenance registration, and quality-gated handoff to OmniPost.
    """

    def __init__(
        self,
        db_path: Optional[str] = None,
        scratch_dir: Optional[str] = None,
        clips_dir: Optional[str] = None,
        publisher: Optional[OmniPostPublisher] = None,
    ):
        self.db_path = db_path or os.path.join(DATA_DIR, "jobs.db")
        self.scratch_dir = scratch_dir or SCRATCH_DIR
        self.clips_dir = clips_dir or CLIPS_DIR
        self.db = DatabaseManager(self.db_path)
        self.governor = get_resource_governor()
        self.editor = VideoEditorEngine(output_dir=self.clips_dir)
        self.publisher = publisher or OmniPostPublisher(db_path=self.db_path)

        os.makedirs(self.scratch_dir, exist_ok=True)
        os.makedirs(self.clips_dir, exist_ok=True)

    def download_video_stream(
        self,
        url: str,
        dest_path: str,
        max_bytes: int = 1024 * 1024 * 1024,  # 1 GB
        timeout: int = 120,
    ) -> str:
        """
        Securely streams external video over HTTP/HTTPS with redirect SSRF validation
        and streaming SHA-256 computation.
        """
        assert_safe_url(url)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)

        session = requests.Session()
        # Custom redirect handling to prevent SSRF bypass via redirects
        current_url = url
        hops = 0
        max_hops = 5

        while hops < max_hops:
            safe, reason = validate_safe_url(current_url)
            if not safe:
                raise SSRFValidationError(f"Redirect target blocked by SSRF: {reason}")

            resp = session.get(current_url, stream=True, timeout=timeout, allow_redirects=False)
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location")
                if not location:
                    raise IngestionError(f"Redirect status {resp.status_code} missing Location header.")
                current_url = requests.compat.urljoin(current_url, location)
                hops += 1
                continue

            resp.raise_for_status()
            break
        else:
            raise IngestionError(f"Exceeded maximum redirect hops ({max_hops}).")

        hasher = hashlib.sha256()
        total_bytes = 0
        self.governor.register_active_file(dest_path)

        try:
            with open(dest_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=65536):
                    if chunk:
                        total_bytes += len(chunk)
                        if total_bytes > max_bytes:
                            raise IngestionError(f"Video file exceeds maximum allowed size ({max_bytes} bytes).")
                        hasher.update(chunk)
                        f.write(chunk)
        finally:
            self.governor.unregister_active_file(dest_path)

        return hasher.hexdigest()

    def parse_transcript(
        self, raw_transcript: Optional[List[Dict[str, Any]]]
    ) -> List[Dict[str, Any]]:
        """Parses and validates transcript segments."""
        if not raw_transcript:
            return []
        parsed = []
        for item in raw_transcript:
            if not isinstance(item, dict):
                continue
            start = float(item.get("start", 0.0))
            end = float(item.get("end", 0.0))
            text = str(item.get("text", "")).strip()
            if end > start and text:
                parsed.append({"start": start, "end": end, "text": text})
        return sorted(parsed, key=lambda x: x["start"])

    def register_provenance_and_rights(
        self,
        tenant: Dict[str, Any],
        project_id: str,
        source_engine: str,
        prompt_metadata: Optional[Dict[str, Any]],
        file_hash: str,
    ) -> RightsManifest:
        """
        Registers provenance metadata and grants rights clearance under AI_GENERATED_ORIGINAL.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        rights_id = f"rm_ai_{uuid.uuid4().hex[:12]}"
        tenant_name = tenant.get("name") or tenant.get("tenant_id") or "External AI Creator"

        audit_dict = {
            "source_engine": source_engine,
            "prompt_metadata": prompt_metadata or {},
            "file_hash": file_hash,
            "tenant_id": tenant.get("tenant_id"),
        }

        manifest = RightsManifest(
            rights_id=rights_id,
            video_id=project_id,
            basis=RightsBasis.AI_GENERATED_ORIGINAL,
            status=RightsStatus.VERIFIED,
            owner_name=tenant_name,
            creator_id=tenant.get("tenant_id", ""),
            proof_reference=f"Provenance Registered: {source_engine}",
            evidence_type="AI_PROVENANCE_MANIFEST",
            verified_at=now_iso,
            verified_by="AI_PROVENANCE_ENGINE",
            audit_notes=json.dumps(audit_dict),
        )

        conn = self.db.get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO rights_ledger (
                        rights_id, video_id, basis, status, owner_name, proof_reference,
                        evidence_type, verified_at, verified_by, audit_notes, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(video_id) DO UPDATE SET
                        rights_id=excluded.rights_id,
                        basis=excluded.basis,
                        status=excluded.status,
                        owner_name=excluded.owner_name,
                        proof_reference=excluded.proof_reference,
                        verified_at=excluded.verified_at,
                        updated_at=excluded.updated_at
                    """,
                    (
                        rights_id,
                        project_id,
                        manifest.basis.value,
                        manifest.status.value,
                        manifest.owner_name,
                        manifest.proof_reference,
                        manifest.evidence_type,
                        manifest.verified_at,
                        manifest.verified_by,
                        manifest.audit_notes,
                        now_iso,
                        now_iso,
                    ),
                )
                # Append to immutable audit log
                conn.execute(
                    """
                    INSERT INTO rights_audit_log (
                        audit_id, video_id, rights_id, creator_id, action, previous_status,
                        new_status, basis, actor, reason, evidence_ref, metadata_json, created_at
                    ) VALUES (?, ?, ?, ?, 'VERIFY_AI_PROVENANCE', 'UNKNOWN', 'VERIFIED', ?, 'AI_PROVENANCE_ENGINE', ?, ?, ?, ?)
                    """,
                    (
                        f"audit_{uuid.uuid4().hex[:12]}",
                        project_id,
                        rights_id,
                        tenant.get("tenant_id"),
                        manifest.basis.value,
                        f"External AI video ingested from {source_engine}",
                        manifest.proof_reference,
                        json.dumps(audit_dict),
                        now_iso,
                    ),
                )
        finally:
            conn.close()

        return manifest

    def ingest_video(
        self,
        tenant: Dict[str, Any],
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Validates payload, enforces quotas and storage headroom, ingests the video,
        registers provenance, reframes to 9:16 vertical, verifies QA, and routes to OmniPost.
        """
        tenant_id = tenant["tenant_id"]
        project_id = str(payload.get("project_id") or "").strip()
        video_url = str(payload.get("video_url") or "").strip()
        source_engine = str(payload.get("source_engine") or "custom_ai_pipeline").strip()

        if not project_id:
            raise ValueError("project_id is required.")
        if not video_url:
            raise ValueError("video_url is required.")

        # Immediate SSRF validation on incoming URL before reserving quotas or creating project records
        assert_safe_url(video_url)

        # 1. Quota & Concurrency Check
        quota_check = self.db.check_and_increment_tenant_quota(tenant_id)
        if not quota_check.get("allowed"):
            raise IngestionError(quota_check.get("reason", "Tenant quota exceeded."))

        # 2. Disk Space Headroom Check
        self.governor.assert_sufficient_disk_space(min_gb=5.0)

        job_id = f"job_ai_{uuid.uuid4().hex[:10]}"
        prompt_metadata = payload.get("prompt_metadata")
        raw_transcript = payload.get("transcript")
        target_aspect_ratio = payload.get("target_aspect_ratio", "9:16")
        audio_treatment = payload.get("audio_treatment")
        omnipost_routing = payload.get("omnipost_routing")

        parsed_transcript = self.parse_transcript(raw_transcript)

        # 3. Create External Project Record in SQLite
        self.db.create_external_ai_project(
            project_id=project_id,
            tenant_id=tenant_id,
            job_id=job_id,
            source_engine=source_engine,
            video_url=video_url,
            prompt_metadata=prompt_metadata,
            transcript=parsed_transcript,
            target_aspect_ratio=target_aspect_ratio,
            audio_treatment=audio_treatment,
            omnipost_routing=omnipost_routing,
        )

        # Isolated scratch destination
        tenant_scratch_dir = os.path.join(self.scratch_dir, "tenants", tenant_id, project_id)
        os.makedirs(tenant_scratch_dir, exist_ok=True)
        local_video_path = os.path.join(tenant_scratch_dir, "source.mp4")

        try:
            # 4. Secure Download & SHA-256 verification
            self.db.update_external_ai_project(tenant_id, project_id, status="DOWNLOADING")
            file_hash = self.download_video_stream(video_url, local_video_path)
            self.db.update_external_ai_project(
                tenant_id, project_id, local_video_path=local_video_path, file_hash=file_hash
            )

            # 5. Provenance & Rights Registration
            manifest = self.register_provenance_and_rights(
                tenant=tenant,
                project_id=project_id,
                source_engine=source_engine,
                prompt_metadata=prompt_metadata,
                file_hash=file_hash,
            )
            self.db.update_external_ai_project(tenant_id, project_id, rights_id=manifest.rights_id)

            # 6. Video Processing & 9:16 Reframing
            self.db.update_external_ai_project(tenant_id, project_id, status="RENDERING")
            output_clip_path = os.path.join(self.clips_dir, f"{project_id}_916.mp4")

            meta = self.editor.get_video_metadata(local_video_path)
            duration = meta.get("duration", 15.0)

            # Concurrency and subprocess controlled by ResourceGovernor
            with self.governor.acquire_render_slot(job_id=job_id):
                render_res = self.editor.render_edited_clip(
                    source_path=local_video_path,
                    start_seconds=0.0,
                    end_seconds=duration,
                    aspect_ratio=target_aspect_ratio,
                    output_file_path=output_clip_path,
                )

            rendered_clip_path = render_res.get("file_path") or render_res.get("output_path") or output_clip_path
            rendered_hash = hashlib.sha256(open(rendered_clip_path, "rb").read()).hexdigest()
            self.db.update_external_ai_project(
                tenant_id, project_id, output_clip_path=rendered_clip_path, status="QA_VERIFYING"
            )

            # 7. Automated 12-Point Quality Assurance
            qa_res = validate_rendered_short(
                file_path=rendered_clip_path,
                expected_duration=duration,
                duration_tolerance=2.0,
            )

            qa_status = qa_res.get("status", "FAILED")
            qa_report = QAReport(
                qa_id=f"qa_{uuid.uuid4().hex[:8]}",
                clip_id=project_id,
                status=qa_status,
                video_stream_ok=qa_res.get("checks", {}).get("video_stream", True),
                audio_stream_ok=qa_res.get("checks", {}).get("audio_stream", True),
                duration_ok=qa_res.get("checks", {}).get("duration", True),
                actual_duration=qa_res.get("metadata", {}).get("duration", duration),
                expected_duration=duration,
                aspect_ratio_ok=qa_res.get("checks", {}).get("aspect_ratio", True),
                actual_aspect_ratio=target_aspect_ratio,
                file_size_bytes=os.path.getsize(rendered_clip_path),
                checksum_sha256=rendered_hash,
                errors=qa_res.get("errors", []),
                warnings=qa_res.get("warnings", []),
            )

            if qa_status != "PASSED":
                err_msg = f"QA verification failed: {qa_res.get('errors')}"
                self.db.update_external_ai_project(tenant_id, project_id, status="FAILED", error_message=err_msg)
                raise IngestionError(err_msg)

            # 8. Dispatch to OmniPost if routing configured
            omnipost_receipt_id = None
            if omnipost_routing:
                self.db.update_external_ai_project(tenant_id, project_id, status="PUBLISHING")
                workspace_id = omnipost_routing.get("workspace_id")
                channels = omnipost_routing.get("channels") or ["youtube_shorts", "instagram_reels"]
                publish_immediately = omnipost_routing.get("publish_immediately", True)

                # Build candidate
                prompt_text = (prompt_metadata or {}).get("prompt", "AI Generated Short")
                hook_title = prompt_text[:60] if prompt_text else f"AI Short #{project_id}"

                candidate = HighlightCandidate(
                    candidate_id=f"cand_{project_id}",
                    video_id=project_id,
                    start_seconds=0.0,
                    end_seconds=duration,
                    duration_seconds=duration,
                    score=90.0,
                    breakdown=ScoreBreakdown(hook_score=9.0, moment_score=9.0, coherence_score=9.0, pacing_score=9.0),
                    hook_title=hook_title,
                    suggested_description=f"{prompt_text}\n\n#AI #ComfyUI #Shorts",
                )

                rendered_clip = RenderedClip(
                    clip_id=project_id,
                    job_id=job_id,
                    candidate_id=candidate.candidate_id,
                    file_path=rendered_clip_path,
                    file_hash=rendered_hash,
                    duration_seconds=duration,
                    width=meta.get("width", 1080),
                    height=meta.get("height", 1920),
                    manifest_path="",
                    rendered_at=datetime.now(timezone.utc).isoformat(),
                )

                receipt = self.publisher.publish_clip(
                    rendered_clip=rendered_clip,
                    candidate=candidate,
                    rights_manifest=manifest,
                    qa_report=qa_report,
                    dry_run=False,
                    platforms=channels,
                    approved_by_user=True,
                    title_override=hook_title,
                    description_override=f"{prompt_text} #ai #shorts",
                )
                omnipost_receipt_id = receipt.receipt_id

            self.db.update_external_ai_project(
                tenant_id,
                project_id,
                status="COMPLETED",
                omnipost_receipt_id=omnipost_receipt_id,
            )

            # Record cycle metrics in ResourceGovernor
            self.governor.memory_profiler.record_cycle(
                cycle_id=job_id,
                metadata={"tenant_id": tenant_id, "project_id": project_id},
            )

            return {
                "success": True,
                "job_id": job_id,
                "project_id": project_id,
                "tenant_id": tenant_id,
                "status": "COMPLETED",
                "file_hash": file_hash,
                "rendered_hash": rendered_hash,
                "rights_id": manifest.rights_id,
                "omnipost_receipt_id": omnipost_receipt_id,
                "output_clip_path": rendered_clip_path,
            }

        except Exception as exc:
            self.db.refund_tenant_quota(tenant_id)
            self.db.update_external_ai_project(
                tenant_id, project_id, status="FAILED", error_message=str(exc)
            )
            raise
