"""
External AI video generation ingestion (ComfyUI, Runway, Luma, Sora) and tenant job router.
"""

from __future__ import annotations
from typing import Dict, Any
import sqlite3
import logging

from fastapi import APIRouter, HTTPException, Request, status

from ...ingestion.external_ingest import IngestionError
from ...ingestion.ssrf_validator import SSRFValidationError
from ...orchestration.resource_governor import InsufficientStorageError
from ..schemas import ExternalAIVideoIngestRequest
from ..state import (
    db_manager,
    external_ingest_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["External AI Video"])


def _authenticate_tenant(request: Request) -> Dict[str, Any]:
    """Authenticates tenant credentials and enforces fail-closed security."""
    raw_key = (
        request.headers.get("X-Tenant-Key")
        or request.headers.get("X-API-Key")
        or ""
    ).strip()
    if not raw_key:
        auth_hdr = (request.headers.get("Authorization") or "").strip()
        if auth_hdr.lower().startswith("bearer "):
            raw_key = auth_hdr[7:].strip()

    if not raw_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required: valid tenant API key must be provided in X-Tenant-Key or Authorization header.",
        )

    tenant = db_manager.get_tenant_by_api_key(raw_key)
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: invalid or inactive tenant credentials.",
        )
    return tenant


@router.post("/api/v1/external/ai-video/ingest")
async def api_external_ai_video_ingest(
    request: Request,
    payload: ExternalAIVideoIngestRequest,
) -> Dict[str, Any]:
    """
    Standardized Ingestion Bridge for External AI Video Generators (ComfyUI, Runway, Luma, Sora).
    Enforces strict tenant isolation, quota management, SSRF protection, SHA-256 verification,
    rights & provenance registration, 9:16 reframing, and OmniPost publishing handoff.
    """
    tenant = _authenticate_tenant(request)
    data = payload.model_dump()

    try:
        result = external_ingest_service.ingest_video(tenant=tenant, payload=data)
        return result
    except SSRFValidationError as ssrf_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ssrf_err))
    except InsufficientStorageError as stor_err:
        raise HTTPException(status_code=507, detail=str(stor_err))
    except IngestionError as ing_err:
        err_msg = str(ing_err)
        if "quota" in err_msg.lower() or "limit" in err_msg.lower():
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=err_msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err_msg)
    except ValueError as val_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(val_err))
    except Exception as exc:
        logger.error(f"[External AI Video Ingest] Unexpected error: {exc}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Ingestion failed: {exc}")


@router.get("/api/v1/external/ai-video/status/{job_id}")
async def api_external_ai_video_status(
    job_id: str,
    request: Request,
) -> Dict[str, Any]:
    """
    Returns processing status and tracking metadata for an ingested AI video job.
    Strictly enforces tenant ownership: Tenant A cannot inspect Tenant B's jobs.
    """
    tenant = _authenticate_tenant(request)
    tenant_id = tenant["tenant_id"]

    project = db_manager.get_external_ai_project_by_job_id(job_id=job_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' not found.")

    # Strict Tenant Boundary Enforcement
    if project.get("tenant_id") != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Tenant is not authorized to access this job.",
        )

    return {
        "job_id": project.get("job_id"),
        "project_id": project.get("project_id"),
        "tenant_id": project.get("tenant_id"),
        "status": project.get("status"),
        "source_engine": project.get("source_engine"),
        "file_hash": project.get("file_hash"),
        "rights_id": project.get("rights_id"),
        "omnipost_receipt_id": project.get("omnipost_receipt_id"),
        "output_clip_path": project.get("output_clip_path"),
        "error_message": project.get("error_message"),
        "created_at": project.get("created_at"),
        "updated_at": project.get("updated_at"),
    }


@router.get("/api/v1/external/ai-video/tenants")
async def api_list_ai_video_tenants(request: Request) -> Dict[str, Any]:
    """Lists registered tenants, daily render quotas, and active job limits for studio display."""
    conn = db_manager.get_connection()
    try:
        with conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT t.tenant_id, t.name, t.api_key, t.webhook_url, t.status,
                       q.daily_render_limit, q.current_daily_renders, q.max_concurrent_jobs, q.storage_quota_bytes
                FROM tenants t
                LEFT JOIN tenant_quotas q ON t.tenant_id = q.tenant_id
                ORDER BY t.created_at DESC
                """
            ).fetchall()
            tenants = [dict(r) for r in rows]
            for t in tenants:
                if t.get("api_key"):
                    t["api_key_masked"] = t["api_key"][:8] + "..." + t["api_key"][-4:]
            return {"success": True, "tenants": tenants}
    finally:
        conn.close()


@router.get("/api/v1/external/ai-video/jobs")
async def api_list_ai_video_jobs(request: Request) -> Dict[str, Any]:
    """Lists recent external AI video ingestion projects with real-time status."""
    conn = db_manager.get_connection()
    try:
        with conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT p.*, t.name as tenant_name
                FROM external_ai_projects p
                LEFT JOIN tenants t ON p.tenant_id = t.tenant_id
                ORDER BY p.created_at DESC LIMIT 50
                """
            ).fetchall()
            jobs = [dict(r) for r in rows]
            return {"success": True, "jobs": jobs}
    finally:
        conn.close()
