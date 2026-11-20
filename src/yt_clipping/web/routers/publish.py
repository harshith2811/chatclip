"""
Multi-platform publishing, channel management, publish history, retries, and OmniPost webhook router.
"""

from __future__ import annotations
from typing import List, Dict, Optional, Any
import os
import glob
import json
import hmac
import hashlib
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status

from ...contracts.models import (
    RenderedClip,
    HighlightCandidate,
    ScoreBreakdown,
)
from ...contracts.interfaces import RightsPolicyViolationError
from ...rights.gate import LocalRightsPolicy
from ...discovery.attribution_engine import AttributionEngine, validate_attribution_package
from ...qa.verifier import MediaQualityVerifier
from ..schemas import PublishSubmitRequest
from ..state import (
    DATA_DIR,
    CLIPS_DIR,
    DB_PATH,
    youtube_auth,
    publisher,
    project_store,
    db_manager,
    get_active_compliance_profile,
    _compute_file_sha256,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Publish"])


@router.get("/api/v1/publish/channels")
def api_get_publish_channels() -> Dict[str, Any]:
    """Returns available publishing channels: Dedicated YouTube Channel and OmniPost Gateway."""
    yt_status = youtube_auth.get_public_status()
    omni_status = publisher.preflight_check()
    channels = youtube_auth.list_available_channels()
    return {
        "dedicated_youtube": yt_status,
        "omnipost_gateway": omni_status,
        "channels": channels,
        "ready": yt_status.get("connected", False) or omni_status.get("status") == "ready",
    }


@router.post("/api/v1/publish/submit")
def api_publish_submit(req: PublishSubmitRequest) -> Dict[str, Any]:
    """
    Submits a clip (or batch of clips) for publishing with strict rights clearance,
    QA gating, and mandatory human authorization verification.
    """
    # 1. Enforce explicit human approval
    if not req.approved_by_user:
        raise HTTPException(
            status_code=400,
            detail="Publishing rejected: Explicit human approval (approved_by_user=true) is mandatory.",
        )

    target_ids = req.clip_ids if req.clip_ids else ([req.clip_id] if req.clip_id else [])
    if not target_ids:
        raise HTTPException(status_code=400, detail="Either clip_id or clip_ids must be specified.")

    rights_policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    attr_engine = AttributionEngine(db_path=DB_PATH)
    qa_verifier = MediaQualityVerifier()
    active_profile = get_active_compliance_profile()

    receipts_list = []
    for cid in target_ids:
        # Resolve clip sidecar and media file
        sidecar = project_store.get_clip_sidecar(cid)
        clip_file = ""
        if sidecar and os.path.exists(sidecar.file_path):
            clip_file = sidecar.file_path
        else:
            for cand in glob.glob(os.path.join(CLIPS_DIR, f"*{cid}*.mp4")):
                if os.path.exists(cand) and os.path.getsize(cand) > 1024:
                    clip_file = cand
                    break

        if not clip_file:
            raise HTTPException(status_code=404, detail=f"Rendered clip media not found for id: {cid}")

        source_video_id = sidecar.video_id if sidecar else cid
        duration = sidecar.duration_seconds if sidecar else 30.0
        cand_data = sidecar.candidate_data if sidecar else {}
        final_title = req.title if (len(target_ids) == 1 and req.title) else (cand_data.get("hook_title") or req.title or f"Short #{cid}")
        final_desc = req.description or cand_data.get("suggested_description") or ""

        rendered_clip = RenderedClip(
            clip_id=cid,
            job_id=f"job_pub_{cid}",
            candidate_id=cid,
            file_path=clip_file,
            file_hash=_compute_file_sha256(clip_file),
            duration_seconds=duration,
            width=1080,
            height=1920,
            manifest_path="",
            rendered_at=datetime.now(timezone.utc).isoformat(),
        )

        candidate = HighlightCandidate(
            candidate_id=cid,
            video_id=source_video_id,
            start_seconds=sidecar.start_seconds if sidecar else 0.0,
            end_seconds=sidecar.end_seconds if sidecar else duration,
            duration_seconds=duration,
            score=sidecar.score if sidecar else 90.0,
            breakdown=ScoreBreakdown(hook_score=9.0, moment_score=9.0, coherence_score=9.0, pacing_score=9.0),
            hook_title=final_title,
            suggested_description=final_desc,
        )

        # Enforce REAL persisted rights & attribution (never fabricate OWNED/VERIFIED)
        real_manifest = rights_policy.check_rights(source_video_id)
        creator_name = real_manifest.owner_name or ""
        attr_pkg = attr_engine.format_attribution(
            video_id=source_video_id,
            creator_name=creator_name or "Unknown",
            channel_id=real_manifest.creator_id or None,
            license_type=real_manifest.basis.value,
            license_url=real_manifest.license_url,
        )
        attr_valid, attr_errors = validate_attribution_package(attr_pkg)
        try:
            rights = rights_policy.assert_can_publish(
                source_video_id,
                manifest=real_manifest,
                approved_by_user=bool(req.approved_by_user),
                attribution_validated=attr_valid,
                profile=active_profile,
            )
        except RightsPolicyViolationError as rexc:
            raise HTTPException(
                status_code=403,
                detail=f"Publishing blocked by rights/attribution gate: {rexc}. Attr errors: {attr_errors}",
            )

        # Enforce REAL media QA verification (never fabricate PASSED)
        qa = qa_verifier.verify_clip(rendered_clip, candidate)
        if qa.status == "FAILED":
            raise HTTPException(
                status_code=400,
                detail=f"Publishing blocked by QA failure for clip '{cid}': {qa.errors}",
            )

        rcpt = publisher.publish(
            rendered_clip=rendered_clip,
            candidate=candidate,
            rights_manifest=rights,
            qa_report=qa,
            dry_run=False,
            platforms=req.platforms,
            scheduled_time=req.scheduled_time,
            approved_by_user=bool(req.approved_by_user),
            title_override=final_title,
            description_override=final_desc or attr_pkg.full_description,
            tags=req.tags,
            channel_id=req.channel_id,
            thumbnail_path=req.thumbnail_path,
            publish_target=req.target,
        )
        receipts_list.append(rcpt)

    # Backwards compatibility: if single clip requested via req.clip_id without req.clip_ids
    if req.clip_id and not req.clip_ids:
        receipt = receipts_list[0]
        return {
            "success": receipt.status in ("DELIVERED", "SCHEDULED", "DUPLICATE_SKIPPED"),
            "receipt_id": receipt.receipt_id,
            "status": receipt.status,
            "target": receipt.target_mode,
            "timestamp": receipt.timestamp,
            "response": receipt.response_payload,
        }

    # Batch publication response
    all_ok = all(r.status in ("DELIVERED", "SCHEDULED", "DUPLICATE_SKIPPED") for r in receipts_list)
    return {
        "success": all_ok,
        "total_published": len(receipts_list),
        "target": req.target,
        "receipts": [
            {
                "receipt_id": r.receipt_id,
                "clip_id": r.clip_id,
                "status": r.status,
                "target": r.target_mode,
                "timestamp": r.timestamp,
                "response": r.response_payload,
            }
            for r in receipts_list
        ],
    }


@router.get("/api/v1/publish/history")
def api_get_publish_history(limit: int = 50) -> List[Dict[str, Any]]:
    """Returns past publishing handoffs, status, errors, and delivery receipts."""
    return publisher.list_publishing_history(limit=limit)


@router.post("/api/v1/publish/retry/{receipt_id}")
def api_retry_publish(receipt_id: str) -> Dict[str, Any]:
    """Safely retries a failed publishing job."""
    try:
        retried = publisher.retry_failed_job(receipt_id)
        return {
            "success": retried.status in ("DELIVERED", "SCHEDULED"),
            "receipt_id": retried.receipt_id,
            "status": retried.status,
            "response": retried.response_payload,
        }
    except Exception as e:
        logger.error(f"Retry failed for {receipt_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/v1/publish/status/{receipt_id}")
def api_get_publish_status(receipt_id: str) -> Dict[str, Any]:
    """Retrieves real-time status of a specific publishing delivery."""
    rcpt = publisher.get_receipt_by_id(receipt_id)
    if not rcpt:
        raise HTTPException(status_code=404, detail="Publishing receipt not found.")
    return {
        "receipt_id": rcpt.receipt_id,
        "clip_id": rcpt.clip_id,
        "status": rcpt.status,
        "target": rcpt.target_mode,
        "timestamp": rcpt.timestamp,
        "response": rcpt.response_payload,
    }


@router.post("/api/v1/webhooks/omnipost")
async def api_omnipost_webhook(request: Request) -> Dict[str, Any]:
    """
    Inbound Webhook Synchronization from OmniPost.
    Verifies HMAC-SHA256 signature, validates event payload, prevents replay,
    updates publishing receipts, and synchronizes status back to external creator project.
    """
    raw_body = await request.body()
    secret = os.getenv("OMNIPOST_WEBHOOK_SECRET", "omnipost_webhook_shared_secret_2026")

    sig_hdr = (
        request.headers.get("X-OmniPost-Signature")
        or request.headers.get("X-Signature-SHA256")
        or ""
    ).strip()

    if sig_hdr.startswith("sha256="):
        expected_sig = sig_hdr[7:]
    else:
        expected_sig = sig_hdr

    computed_sig = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not expected_sig or not hmac.compare_digest(computed_sig, expected_sig):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing webhook HMAC signature.",
        )

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid JSON payload: {e}")

    event_id = payload.get("event_id")
    event_type = payload.get("event_type")
    if not event_id or not event_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="event_id and event_type are required.")

    # Idempotency / Replay Prevention
    if db_manager.has_processed_webhook_event(event_id):
        return {"success": True, "event_id": event_id, "message": "Duplicate webhook event safely skipped."}

    tenant_id = payload.get("tenant_id")
    project_id = payload.get("project_id")
    job_id = payload.get("job_id")
    content_id = payload.get("content_id")
    idempotency_key = payload.get("idempotency_key")
    post_status = payload.get("status")

    # Update publishing_receipts
    conn = db_manager.get_connection()
    try:
        with conn:
            if idempotency_key:
                conn.execute(
                    """
                    UPDATE publishing_receipts
                    SET status = ?, response_payload_json = ?
                    WHERE idempotency_key = ?
                    """,
                    (post_status or event_type, json.dumps(payload), idempotency_key),
                )
            if content_id:
                conn.execute(
                    """
                    UPDATE publishing_receipts
                    SET status = ?, response_payload_json = ?
                    WHERE clip_id = ?
                    """,
                    (post_status or event_type, json.dumps(payload), content_id),
                )
    finally:
        conn.close()

    # Update external_ai_projects status
    if tenant_id and project_id:
        mapped_status = "PUBLISHED" if event_type == "POST_PUBLISHED" else (
            "SCHEDULED" if event_type == "POST_SCHEDULED" else (
                "FAILED" if event_type == "POST_FAILED" else (
                    "REVOKED" if event_type == "TAKEDOWN_ISSUED" else "UPDATED"
                )
            )
        )
        db_manager.update_external_ai_project(
            tenant_id=tenant_id,
            project_id=project_id,
            status=mapped_status,
            error_message=payload.get("error"),
        )

    # Record event in ledger
    db_manager.record_omnipost_webhook_event(
        event_id=event_id,
        event_type=event_type,
        tenant_id=tenant_id,
        project_id=project_id,
        job_id=job_id,
        content_id=content_id,
        payload=payload,
    )

    return {"success": True, "event_id": event_id, "processed": True}
