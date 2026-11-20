"""
Centralized shared state, paths, singletons, locks, and core helpers for the Web Studio backend.
"""

from __future__ import annotations
from typing import List, Dict, Optional, Any
import os
import sys
import glob
import json
import shutil
import hashlib
import asyncio
import logging
import threading
import sqlite3
from datetime import datetime, timezone
from dataclasses import asdict

from fastapi import HTTPException

from ..config import AppConfig, is_legal_officer_enabled
from ..contracts.models import RenderProfile, ComplianceProfile
from ..contracts.interfaces import RightsPolicyViolationError
from ..discovery.video_metadata import VideoMetadataService, EnrichedVideoInfo, normalize_youtube_url
from ..scoring.caption_synthesizer import CaptionSynthesizer, ShortCaptionPackage, ClipIntelligence
from ..orchestration.project_store import ProjectStore, ProjectRecord, ClipSidecarRecord
from ..orchestration.batch_queue import BatchQueueManager, BatchSession, BatchStatus
from ..orchestration.job_manager import JobManager, RenderJobStatus, JobRecord
from ..orchestration.resource_manager import ResourceManager
from ..orchestration.resource_governor import get_resource_governor, InsufficientStorageError
from ..orchestration.db import DatabaseManager
from ..auth.google_oauth import DedicatedYouTubeAuth
from ..rendering.editor import VideoEditorEngine
from ..rendering.flux_generator import FluxImageGenerator
from ..publisher.omnipost import OmniPostPublisher
from ..ingestion.external_ingest import ExternalAIVideoIngestService, IngestionError
from ..supoclip import get_supoclip_adapter

logger = logging.getLogger(__name__)

# Base directories & paths
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
DATA_DIR = os.getenv("DATA_DIR", os.path.join(BASE_DIR, "data"))
CLIPS_DIR = (
    os.getenv("OUTPUT_DIR")
    or os.getenv("RENDERED_CLIPS_DIR")
    or os.getenv("CLIPS_DIR")
    or os.path.join(DATA_DIR, "rendered_clips")
)
PROJECTS_DIR = os.path.join(DATA_DIR, "projects")
TEMP_DIR = os.path.join(DATA_DIR, "temp")
CACHE_DIR = os.path.join(DATA_DIR, "cache", "metadata")
ASSETS_DIR = os.getenv("ASSETS_DIR") or os.path.join(DATA_DIR, "assets")
DB_PATH = os.path.join(DATA_DIR, "jobs.db")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
DOCS_DIR = os.path.abspath(os.path.join(BASE_DIR, "docs"))
DOCS_HTML_PATH = os.path.join(os.path.dirname(__file__), "docs.html")
LANDING_HTML_PATH = os.path.join(os.path.dirname(__file__), "landing.html")
DASHBOARD_HTML_PATH = os.path.join(os.path.dirname(__file__), "dashboard.html")

for d in (CLIPS_DIR, PROJECTS_DIR, TEMP_DIR, CACHE_DIR, ASSETS_DIR, STATIC_DIR):
    os.makedirs(d, exist_ok=True)

# Shared platform singleton services
metadata_service = VideoMetadataService(cache_dir=CACHE_DIR)
caption_synthesizer = CaptionSynthesizer()
project_store = ProjectStore(base_data_dir=DATA_DIR)
job_manager = JobManager(db_path=DB_PATH)
batch_manager = BatchQueueManager(storage_dir=DATA_DIR, db_path=DB_PATH)
youtube_auth = DedicatedYouTubeAuth()
video_editor = VideoEditorEngine(output_dir=CLIPS_DIR)
flux_generator = FluxImageGenerator()
publisher = OmniPostPublisher(db_path=DB_PATH, youtube_auth=youtube_auth)
db_manager = DatabaseManager(db_path=DB_PATH)
resource_governor = get_resource_governor()
external_ingest_service = ExternalAIVideoIngestService(
    db_path=DB_PATH,
    scratch_dir=os.path.join(DATA_DIR, "scratch"),
    clips_dir=CLIPS_DIR,
    publisher=publisher,
)
supoclip_adapter = get_supoclip_adapter()

# Shared mutable state and concurrency control
_active_jobs_lock = threading.RLock()
active_render_jobs: Dict[str, Dict[str, Any]] = {}
active_preview_tasks: Dict[str, Any] = {}
active_batch_sessions: Dict[str, Any] = {}

# Studio configuration settings
STUDIO_SETTINGS: Dict[str, Any] = {
    "gemini_model": os.getenv("GEMINI_MODEL") or os.getenv("GEMINI_PRIMARY_MODEL", "gemini-2.5-flash"),
    "compliance_profile": os.getenv("COMPLIANCE_PROFILE", ComplianceProfile.REVIEW_REQUIRED.value),
    "layout_mode": "active_speaker",
    "subtitle_preset": "hormozi",
    "gpu_acceleration": True,
    "enable_polish": True,
    "enable_outro": True,
    "attribution_template": "Original video and content by: {channel_title}",
    "fair_use_disclaimer": (
        "This Short contains edited material from the original source for commentary, "
        "educational discussion, or discovery. All underlying rights remain with their respective owners. "
        "Attribution is provided for identification. Contact our team for rights-related inquiries or removal requests."
    ),
    "contact_email": "rights@yourdomain.com",
}


def _compute_file_sha256(file_path: str) -> str:
    """Computes SHA-256 hash of a file for integrity and deduplication."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def get_active_compliance_profile() -> ComplianceProfile:
    """Retrieves active compliance profile with graceful fallback."""
    raw = str(
        STUDIO_SETTINGS.get("compliance_profile")
        or os.getenv("COMPLIANCE_PROFILE")
        or ComplianceProfile.REVIEW_REQUIRED.value
    )
    try:
        return ComplianceProfile(raw)
    except ValueError:
        return ComplianceProfile.REVIEW_REQUIRED


def _prune_active_render_jobs(max_entries: int = 100) -> None:
    """
    Prunes finished jobs from in-memory tracking to prevent continuous memory growth.
    Strictly protects in-progress/queued jobs from eviction to prevent 404 lookups.
    """
    with _active_jobs_lock:
        if len(active_render_jobs) <= max_entries:
            return
        terminal_statuses = {"COMPLETED", "FAILED", "CANCELLED", "VALIDATION_FAILED"}
        terminal_keys = [
            k for k, v in active_render_jobs.items()
            if (v.get("status") or "").upper() in terminal_statuses
        ]
        excess = len(active_render_jobs) - max_entries
        for k in terminal_keys[:excess]:
            active_render_jobs.pop(k, None)


def _sanitize_clip_id(clip_id: str) -> str:
    """Sanitizes clip ID to prevent path traversal."""
    clean = os.path.basename(clip_id.strip()).replace("/", "").replace("\\", "")
    if not clean or ".." in clip_id:
        raise HTTPException(status_code=400, detail="Invalid clip identifier.")
    return clean


def _get_server_attr(attr_name: str, default: Any = None) -> Any:
    for mod_name in ("src.yt_clipping.web.server", "yt_clipping.web.server"):
        mod = sys.modules.get(mod_name)
        if mod and hasattr(mod, attr_name):
            val = getattr(mod, attr_name)
            if val is not default:
                return val
    return default


def _assert_path_in_data_dir(file_path: str) -> str:
    """Asserts that a given file path is strictly contained within authorized data roots."""
    resolved = os.path.realpath(os.path.abspath(file_path))
    cur_data_dir = _get_server_attr("DATA_DIR", DATA_DIR)
    cur_clips_dir = _get_server_attr("CLIPS_DIR", CLIPS_DIR)

    allowed_roots = [
        os.path.realpath(os.path.abspath(cur_data_dir)),
        os.path.realpath(os.path.abspath(cur_clips_dir)),
        os.path.realpath(os.path.abspath(os.path.join(BASE_DIR, "clips"))),
        os.path.realpath(os.path.abspath(flux_generator.output_dir)),
    ]
    if os.getenv("PYTEST_CURRENT_TEST"):
        import tempfile
        allowed_roots.append(os.path.realpath(os.path.abspath(tempfile.gettempdir())))

    def is_within(root: str) -> bool:
        try:
            return os.path.commonpath((resolved, root)) == root
        except ValueError:
            return False

    if not any(is_within(root) for root in allowed_roots):
        raise HTTPException(status_code=403, detail="Access forbidden: Path outside permitted data directory.")
    return resolved


def _resolve_clip_path(input_path: str) -> str:
    """Robustly resolves a video file path from a full path, filename, or clip_id."""
    if os.path.exists(input_path) and os.path.isfile(input_path):
        return input_path

    clean_id = _sanitize_clip_id(input_path)
    base = os.path.basename(input_path)

    # 1. Check ASSETS_DIR for source video matching
    for asset_cand in [
        os.path.join(ASSETS_DIR, f"{clean_id}.mp4"),
        os.path.join(ASSETS_DIR, f"{clean_id}_slice.mp4"),
        os.path.join(ASSETS_DIR, base),
        os.path.join(ASSETS_DIR, f"{base}.mp4"),
    ]:
        if os.path.exists(asset_cand) and os.path.isfile(asset_cand) and os.path.getsize(asset_cand) > 1024:
            return asset_cand

    # 2. Check ProjectStore sidecar
    sidecar = project_store.get_clip_sidecar(clean_id)
    if sidecar and sidecar.file_path and os.path.exists(sidecar.file_path):
        return sidecar.file_path

    # 3. Check direct filename in CLIPS_DIR
    cand = os.path.join(CLIPS_DIR, base)
    if os.path.exists(cand):
        return cand
    if not cand.endswith(".mp4"):
        cand_mp4 = f"{cand}.mp4"
        if os.path.exists(cand_mp4):
            return cand_mp4

    # 4. Search pattern in CLIPS_DIR
    matches = glob.glob(os.path.join(CLIPS_DIR, f"*{clean_id}*.mp4"))
    for m in matches:
        if os.path.exists(m) and os.path.getsize(m) > 0:
            return m

    # 5. Search pattern in ASSETS_DIR
    asset_matches = glob.glob(os.path.join(ASSETS_DIR, f"*{clean_id}*.mp4"))
    for am in asset_matches:
        if os.path.exists(am) and os.path.getsize(am) > 0:
            return am

    # 6. Check project-specific clip folders
    proj_matches = glob.glob(os.path.join(project_store.projects_dir, "*", "clips", f"*{clean_id}*.mp4"))
    for pm in proj_matches:
        if os.path.exists(pm) and os.path.getsize(pm) > 0:
            return pm

    # 7. Fallback for job-{vid}-{cand}-{hash}
    parts = clean_id.split("-")
    if len(parts) >= 2 and parts[0] == "job":
        vid = parts[1]
        matches_vid = glob.glob(os.path.join(CLIPS_DIR, f"*{vid}*.mp4")) or glob.glob(
            os.path.join(project_store.projects_dir, "*", "clips", f"*{vid}*.mp4")
        )
        for mv in matches_vid:
            if os.path.exists(mv) and os.path.getsize(mv) > 0:
                return mv

    raise HTTPException(status_code=404, detail=f"Source video not found: {input_path}")


_resolve_clip_file_path = _resolve_clip_path


def _get_request_workspace_id(request: Any = None) -> str:
    """Extracts tenant workspace ID from request headers or returns default workspace."""
    if request is not None and hasattr(request, "headers"):
        ws = request.headers.get("X-Workspace-ID") or request.headers.get("X-Tenant-ID")
        if ws:
            return str(ws).strip()
    return "default_workspace"


def _parse_iso_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    """Safely parses ISO datetime string into UTC datetime object."""
    if not dt_str:
        return None
    try:
        clean = dt_str.replace("Z", "+00:00")
        return datetime.fromisoformat(clean)
    except Exception:
        return None
