"""
YouTube Clipping Intelligence Platform - Modular Application Orchestrator & Studio REST API.
"""

from __future__ import annotations
from typing import List, Dict, Optional, Any, Callable
import os
import sys
import glob
import json
import shutil
import hashlib
import hmac
import logging
import threading
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Response, status
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Shared state, paths, singletons, and concurrency primitives
from .state import (
    BASE_DIR,
    DATA_DIR,
    CLIPS_DIR,
    PROJECTS_DIR,
    TEMP_DIR,
    CACHE_DIR,
    ASSETS_DIR,
    DB_PATH,
    STATIC_DIR,
    DOCS_DIR,
    DOCS_HTML_PATH,
    LANDING_HTML_PATH,
    DASHBOARD_HTML_PATH,
    metadata_service,
    caption_synthesizer,
    project_store,
    job_manager,
    batch_manager,
    youtube_auth,
    video_editor,
    flux_generator,
    publisher,
    db_manager,
    resource_governor,
    external_ingest_service,
    supoclip_adapter,
    _active_jobs_lock,
    active_render_jobs,
    active_preview_tasks,
    active_batch_sessions,
    STUDIO_SETTINGS,
    _compute_file_sha256,
    get_active_compliance_profile,
    _prune_active_render_jobs,
    _sanitize_clip_id,
    _assert_path_in_data_dir,
    _resolve_clip_path,
    _resolve_clip_file_path,
    _get_request_workspace_id,
    _parse_iso_datetime,
)

# Request & response validation schemas
from .schemas import (
    MetadataRequest,
    PreviewRequest,
    BatchStartRequest,
    RenderRequest,
    StreamToClipperRequest,
    FluxGenerateRequest,
    FluxBRollRequest,
    FluxAutoBRollRequest,
    FluxSettingsRequest,
    SavePosterRequest,
    FeedbackRequest,
    EditorFrameRequest,
    EditorExportClipSpec,
    EditorExportRequest,
    PublishSubmitRequest,
    RightsRegisterRequest,
    RightsRevokeRequest,
    CreatorApproveRequest,
    CreatorRevokeRequest,
    ExternalAIVideoIngestRequest,
    SupoClipScoreRequest,
    SupoClipPlanRequest,
    SupoClipRenderRequest,
    SupoClipTrimRequest,
    SupoClipSplitRequest,
    SupoClipMergeRequest,
)

# Auxiliary services and engine components (backward compatibility)
from ..cli.commands.pipeline import build_pipeline
from ..rights.gate import LocalRightsPolicy
from ..qa.verifier import validate_rendered_short, MediaQualityVerifier
from ..discovery.attribution_engine import AttributionEngine, CreatorPolicy, validate_attribution_package
from ..detection.solid_shorts import SolidShortsDecider
from ..detection.audio_energy import extract_pcm_from_file
from ..ingestion.external_ingest import IngestionError
from ..ingestion.ssrf_validator import SSRFValidationError, assert_safe_url
from ..orchestration.resource_governor import InsufficientStorageError
from ..contracts.interfaces import RightsPolicyViolationError
from ..contracts.models import RenderProfile, ComplianceProfile

# HTTP Partial Content streaming utility
from .streaming import stream_video_with_range

# Domain routers
from .routers import (
    health_router,
    video_router,
    clips_router,
    trending_router,
    editor_router,
    flux_router,
    publish_router,
    batch_router,
    rights_router,
    external_router,
    supoclip_router,
    auth_router,
    pages_router,
)

# Re-export route handler functions for full backward compatibility
from .routers.health import (
    api_health,
    api_ops_health,
    api_get_governor_status,
    api_trigger_storage_cleanup,
)
from .routers.video import (
    _find_closest_video_id,
    api_get_metadata,
    api_preview,
    _render_video_pipeline,
    _run_render_worker,
    api_render,
    api_render_status,
    api_get_job,
    api_cancel_job,
    api_stream_job_events,
    api_get_source_info,
    api_get_source_transcript,
)
from .routers.clips import (
    api_list_clips,
    api_regenerate_clip_caption,
    api_get_clip,
    api_download_clip,
    api_stream_clip_media,
    api_stream_clip_stream_alias,
    api_get_clip_poster,
    api_list_projects,
    api_get_project,
    api_delete_project,
    api_get_settings,
    api_update_settings,
)
from .routers.trending import (
    api_get_top10m_trending,
    api_get_trending_topics,
    api_get_trending_suggestions,
    _run_stream_to_clipper_worker,
    api_trending_stream_to_clipper,
)
from .routers.editor import (
    api_editor_preview_frame,
    api_editor_export,
    api_editor_waveform,
    api_save_poster,
    api_record_feedback,
    api_get_analytics_summary,
)
from .routers.flux import (
    api_flux_status,
    api_flux_generate,
    api_flux_broll_clip,
    api_flux_auto_broll,
    api_flux_settings,
)
from .routers.publish import (
    api_get_publish_channels,
    api_publish_submit,
    api_get_publish_history,
    api_retry_publish,
    api_get_publish_status,
    api_omnipost_webhook,
)
from .routers.batch import (
    _execute_batch_background,
    api_batch_start,
    api_batch_status,
    api_batch_cancel,
    api_batch_history,
)
from .routers.rights import (
    api_rights_register,
    api_rights_revoke,
    api_rights_audit,
    api_creators_approve,
    api_creators_revoke,
    api_creators_get,
    api_get_legal_officer,
    api_set_legal_officer,
)
from .routers.external import (
    _authenticate_tenant,
    api_external_ai_video_ingest,
    api_external_ai_video_status,
    api_list_ai_video_tenants,
    api_list_ai_video_jobs,
)
from .routers.supoclip import (
    api_supoclip_status,
    api_supoclip_workflows,
    api_supoclip_templates,
    api_supoclip_fonts,
    api_supoclip_score,
    api_supoclip_plan,
    api_supoclip_render,
    api_supoclip_trim,
    api_supoclip_split,
    api_supoclip_merge,
    api_supoclip_presets,
    api_supoclip_export_zip,
)
from .routers.auth import (
    api_get_google_auth_url,
    api_google_auth_callback,
    api_get_google_auth_status,
    api_google_disconnect,
)
from .routers.pages import (
    serve_docs,
    serve_docs_subpath,
    list_available_docs,
    get_doc_content,
    serve_dashboard,
    serve_studio,
    serve_login,
    serve_robots,
    serve_sitemap,
    serve_favicon,
    serve_og_image,
)

logger = logging.getLogger(__name__)

# FastAPI Application Factory
app = FastAPI(
    title="YouTube Clipping Intelligence Platform - Studio API",
    version="2.0.0",
    description="24/7 Autonomous AI video clipping, explainable short-form intelligence, and 9:16 vertical rendering engine",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

_PUBLIC_UNAUTH_PATHS = frozenset({
    "/",
    "/studio",
    "/login",
    "/docs",
    "/api/docs",
    "/api/openapi.json",
    "/api/redoc",
    "/robots.txt",
    "/sitemap.xml",
    "/favicon.svg",
    "/favicon.ico",
    "/og-image.svg",
    "/api/v1/health",
    "/api/v1/auth/google/callback",
})

_STUDIO_SESSION_COOKIE = "yt_studio_session"


@app.middleware("http")
async def enforce_studio_auth(request: Request, call_next):
    """Enforces API key authentication, tenant isolation, and session cookie bootstrapping."""
    path = request.url.path
    expected_key = (os.getenv("WEB_STUDIO_API_KEY") or "").strip()
    env_mode = (os.getenv("ENVIRONMENT") or "development").strip().lower()
    auth_required = (
        bool(expected_key)
        or env_mode in ("production", "staging")
        or os.getenv("STUDIO_AUTH_REQUIRED", "").lower() in ("1", "true", "yes")
    )
    public_local_media = not auth_required and (
        path.startswith("/clips/") or path.startswith("/assets/")
    )
    if (
        path in _PUBLIC_UNAUTH_PATHS
        or path.startswith("/static/")
        or public_local_media
        or path.startswith("/docs")
        or path.startswith("/api/v1/docs")
        or path.startswith("/api/docs")
        or path.startswith("/api/openapi.json")
        or path.startswith("/api/redoc")
        or path.startswith("/api/v1/external/ai-video/")
        or path == "/api/v1/webhooks/omnipost"
        or request.method == "OPTIONS"
    ):
        return await call_next(request)

    if path.startswith("/api/") or path.startswith("/clips/") or path.startswith("/assets/"):
        if expected_key:
            provided = (request.headers.get("X-API-Key") or "").strip()
            if not provided:
                auth_hdr = (request.headers.get("Authorization") or "").strip()
                if auth_hdr.lower().startswith("bearer "):
                    provided = auth_hdr[7:].strip()
            if not provided:
                provided = (request.cookies.get(_STUDIO_SESSION_COOKIE) or "").strip()
            if not provided or not hmac.compare_digest(provided, expected_key):
                return JSONResponse(status_code=401, content={"detail": "Unauthorized: valid API key required."})
        elif auth_required:
            return JSONResponse(status_code=503, content={"detail": "Studio auth misconfigured: WEB_STUDIO_API_KEY is required in production mode."})
        else:
            client_host = request.client.host if request.client else ""
            if client_host not in ("127.0.0.1", "::1", "localhost", "testclient"):
                return JSONResponse(status_code=401, content={"detail": "Unauthorized remote access without WEB_STUDIO_API_KEY."})

    response = await call_next(request)
    if expected_key and path.startswith("/api/"):
        forwarded_proto = (request.headers.get("X-Forwarded-Proto") or "").split(",", 1)[0].strip().lower()
        request_proto = forwarded_proto or request.url.scheme.lower()
        secure_override = (os.getenv("STUDIO_COOKIE_SECURE") or "").strip().lower()
        cookie_secure = (
            secure_override in ("1", "true", "yes")
            if secure_override
            else request_proto == "https"
        )
        response.set_cookie(
            key=_STUDIO_SESSION_COOKIE,
            value=expected_key,
            max_age=8 * 60 * 60,
            httponly=True,
            secure=cookie_secure,
            samesite="strict",
            path="/",
        )
    return response


# CORS Configuration
_cors_raw = os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000,http://127.0.0.1:3000,http://localhost:3050,http://127.0.0.1:3050,http://localhost:3600,http://127.0.0.1:3600,http://localhost:3107,http://127.0.0.1:3107",
)
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip() and o.strip() != "*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=bool(CORS_ALLOWED_ORIGINS),
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key", "Range"],
)

# Static mounts
app.mount("/clips", StaticFiles(directory=CLIPS_DIR), name="clips")
if os.path.exists(ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.exception_handler(404)
async def custom_404_handler(request: Request, exc: Exception):
    """Provides a designed HTML 404 response with navigation back to studio."""
    detail = getattr(exc, "detail", "Route not found")
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=404, content={"detail": detail})
    html_404 = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>404 - Studio Resource Not Found</title>
  <style>
    body { background: #08090d; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; letter-spacing: -0.025em; font-weight: 800; }
    p { color: #8492a6; margin-bottom: 1.5rem; font-size: 1rem; }
    a { background: #2563eb; color: #fff; text-decoration: none; padding: 0.65rem 1.25rem; border-radius: 6px; font-weight: 600; font-size: 0.875rem; }
  </style>
</head>
<body>
  <h1>404 - Page Not Found</h1>
  <p>The requested studio clip or page route does not exist.</p>
  <a href="/">Return to Studio Workspace</a>
</body>
</html>"""
    return HTMLResponse(content=html_404, status_code=404)


# Register all 13 domain routers
for domain_router in (
    health_router,
    video_router,
    clips_router,
    trending_router,
    editor_router,
    flux_router,
    publish_router,
    batch_router,
    rights_router,
    external_router,
    supoclip_router,
    auth_router,
    pages_router,
):
    app.include_router(domain_router)


def start_server(host: str = "0.0.0.0", port: int = 8000, reload: bool = False, **kwargs) -> None:
    """Entry point to launch the studio server via uvicorn."""
    import uvicorn
    uvicorn.run("yt_clipping.web.server:app", host=host, port=port, reload=reload, log_level="info", **kwargs)


if __name__ == "__main__":
    start_server()
