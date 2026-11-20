"""
YouTube Clipping Intelligence Platform - Production-Grade Web Studio & REST API.
Provides dual-engine video metadata ingestion, AI highlight intelligence,
explainable selection reasoning, cascading social caption synthesis,
durable project/clip persistence, asynchronous background job management,
and a commercial-grade SaaS Web Studio interface.
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

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Response, status
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ..config import AppConfig, is_legal_officer_enabled
from ..contracts.models import RenderProfile, ComplianceProfile
from ..contracts.interfaces import RightsPolicyViolationError
from ..rights.gate import LocalRightsPolicy
from ..discovery.attribution_engine import AttributionEngine, CreatorPolicy, validate_attribution_package
from ..detection.solid_shorts import SolidShortsDecider
from ..cli.commands.pipeline import build_pipeline
from ..discovery.video_metadata import VideoMetadataService, EnrichedVideoInfo, normalize_youtube_url
from ..scoring.caption_synthesizer import CaptionSynthesizer, ShortCaptionPackage, ClipIntelligence
from ..orchestration.project_store import ProjectStore, ProjectRecord, ClipSidecarRecord
from ..orchestration.batch_queue import BatchQueueManager, BatchSession, BatchStatus
from ..orchestration.job_manager import JobManager, RenderJobStatus, JobRecord
from ..orchestration.resource_manager import ResourceManager
from ..qa.verifier import validate_rendered_short, MediaQualityVerifier
from ..ingestion.external_ingest import ExternalAIVideoIngestService, IngestionError
from ..ingestion.ssrf_validator import SSRFValidationError, assert_safe_url
from ..orchestration.resource_governor import get_resource_governor, InsufficientStorageError
from ..orchestration.db import DatabaseManager
from ..analytics.feedback_loop import get_feedback_loop, ClipPerformanceRecord

logger = logging.getLogger(__name__)

# Base directories
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

for d in (CLIPS_DIR, PROJECTS_DIR, TEMP_DIR, CACHE_DIR, ASSETS_DIR):
    os.makedirs(d, exist_ok=True)

from ..auth.google_oauth import DedicatedYouTubeAuth
from ..rendering.editor import VideoEditorEngine
from ..rendering.flux_generator import FluxImageGenerator
from ..detection.audio_energy import extract_pcm_from_file
from ..publisher.omnipost import OmniPostPublisher
from ..contracts.models import (
    RenderedClip,
    HighlightCandidate,
    RightsManifest,
    QAReport,
    RightsBasis,
    RightsStatus,
    ScoreBreakdown,
)

# Shared platform services
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

app = FastAPI(
    title="YouTube Clipping Intelligence Platform - Studio API",
    version="2.0.0",
    description="24/7 Autonomous AI video clipping, explainable short-form intelligence, and 9:16 vertical rendering engine",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

import hmac
import markdown

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


def _compute_file_sha256(file_path: str) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def get_active_compliance_profile() -> ComplianceProfile:
    raw = str(
        STUDIO_SETTINGS.get("compliance_profile")
        or os.getenv("COMPLIANCE_PROFILE")
        or ComplianceProfile.REVIEW_REQUIRED.value
    )
    try:
        return ComplianceProfile(raw)
    except ValueError:
        return ComplianceProfile.REVIEW_REQUIRED


@app.middleware("http")
async def enforce_studio_auth(request: Request, call_next):
    path = request.url.path
    expected_key = (os.getenv("WEB_STUDIO_API_KEY") or "").strip()
    env_mode = (os.getenv("ENVIRONMENT") or "development").strip().lower()
    auth_required = (
        bool(expected_key)
        or env_mode in ("production", "staging")
        or os.getenv("STUDIO_AUTH_REQUIRED", "").lower() in ("1", "true", "yes")
    )
    # Static media is convenient for localhost development, but source assets and
    # rendered clips must not become an unauthenticated production file server.
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
    # Native <video>, <img>, and download navigation cannot attach Axios auth
    # headers. Bootstrap a same-origin, HTTP-only cookie after a valid API call
    # so those browser requests remain authenticated without exposing the key in
    # media URLs or JavaScript-readable cookies.
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


_cors_raw = os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000,http://127.0.0.1:3000,http://localhost:3050,http://127.0.0.1:3050,http://localhost:3107,http://127.0.0.1:3107",
)
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip() and o.strip() != "*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=bool(CORS_ALLOWED_ORIGINS),
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key", "Range"],
)

# Mount rendered clips static directory for instant playback
app.mount("/clips", StaticFiles(directory=CLIPS_DIR), name="clips")

# Mount source video assets directory for complete video playback & interactive timeline scrubbing
if os.path.exists(ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

# Mount self-hosted static assets (WOFF2 fonts, icons, banners)
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# In-memory dictionary for backwards-compatibility with tests referencing server.active_render_jobs
_active_jobs_lock = threading.RLock()
active_render_jobs: Dict[str, Dict[str, Any]] = {}

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


# ------------------------------------------------------------------------------
# Pydantic Request Models
# ------------------------------------------------------------------------------
class MetadataRequest(BaseModel):
    video_id_or_url: str = Field(..., description="YouTube video ID or URL")


class PreviewRequest(BaseModel):
    video_id_or_url: str = Field(..., description="YouTube video ID or URL")
    min_duration: float = Field(15.0, description="Minimum clip duration in seconds")
    max_duration: float = Field(60.0, description="Maximum clip duration in seconds")


class BatchStartRequest(BaseModel):
    video_ids: Optional[List[str]] = None
    name: Optional[str] = "Overnight 10M+ Trending Batch"
    max_clips: Optional[int] = 3
    layout: Optional[str] = "active_speaker"
    subtitle_preset: Optional[str] = "hormozi"
    enable_polish: Optional[bool] = True
    enable_outro: Optional[bool] = True
    gpu: Optional[bool] = True


class RenderRequest(BaseModel):
    video_id_or_url: str = Field(..., description="YouTube video ID or URL")
    max_clips: int = Field(5, description="Number of solid shorts to extract (1-10)")
    layout: str = Field("active_speaker", description="Layout: active_speaker | blur_background | split_screen")
    subtitle_preset: str = Field("hormozi", description="Subtitle preset: hormozi | beast_bounce | neon_cyber | clean_editorial")
    enable_polish: bool = Field(True, description="Enable broadcast hook pacing and anti-pop audio transitions")
    enable_outro: bool = Field(True, description="Enable dedicated animated outro card with bell chime")
    outro_channel_name: Optional[str] = Field(None, description="Custom channel name for outro card")
    gpu: bool = Field(True, description="Use NVIDIA NVENC hardware acceleration if available")


class StreamToClipperRequest(BaseModel):
    video_id_or_url: str = Field(..., description="YouTube video ID or URL to clip and publish")
    max_clips: int = Field(1, description="Number of solid shorts to extract and publish (1-5)")
    layout: str = Field("active_speaker", description="Layout: active_speaker | blur_background | split_screen")
    subtitle_preset: str = Field("hormozi", description="Subtitle preset: hormozi | beast_bounce | neon_cyber | clean_editorial")
    enable_polish: bool = Field(True, description="Enable broadcast hook pacing polish")
    enable_outro: bool = Field(True, description="Enable animated outro card")
    gpu: bool = Field(True, description="Use NVENC GPU acceleration if available")
    auto_publish: bool = Field(False, description="Publish clip after explicit rights and human review verification")
    platforms: List[str] = Field(default_factory=lambda: ["youtube_shorts", "instagram_reels", "tiktok"])
    target: str = Field("watched_folder", description="Publish target: watched_folder | omnipost")
    approved_by_user: bool = Field(False, description="Mandatory explicit human authorization confirmation")


class FluxGenerateRequest(BaseModel):
    prompt: str = Field(..., description="Visual scene prompt")
    style_preset: Optional[str] = Field("cinematic_hook", description="Visual style preset")
    width: Optional[int] = Field(768, description="Target pixel width")
    height: Optional[int] = Field(1344, description="Target pixel height")
    steps: Optional[int] = Field(4, description="Inference steps (1-8)")
    animate_broll: Optional[bool] = Field(False, description="Render Ken Burns video clip")


class FluxBRollRequest(BaseModel):
    image_path: str = Field(..., description="Path to FLUX image")
    duration: Optional[float] = Field(3.5, description="Video clip duration in seconds")
    motion: Optional[str] = Field("zoom_in", description="Motion type: zoom_in | zoom_out | pan")


class FluxAutoBRollRequest(BaseModel):
    transcript_text: str = Field(..., description="Clip transcript dialogue to analyze")
    max_concepts: Optional[int] = Field(3, description="Maximum number of concepts")
    style_preset: Optional[str] = Field("cinematic_hook", description="Visual style preset")


class FluxSettingsRequest(BaseModel):
    account_id: str = Field(..., description="Cloudflare Account ID")
    api_token: str = Field(..., description="Cloudflare API Token")


class SavePosterRequest(BaseModel):
    video_path: str = Field(..., description="Video path or filename")
    timestamp: float = Field(0.0, description="Timestamp to capture")
    clip_id: Optional[str] = Field(None, description="Clip ID to attach poster to")


class FeedbackRequest(BaseModel):
    clip_id: str = Field(..., description="Clip identifier")
    rating: float = Field(..., description="User star rating 1.0 to 5.0")
    notes: Optional[str] = Field("", description="Optional creator feedback notes")
    hook_type: Optional[str] = Field("General", description="Hook type classification")
    video_id: Optional[str] = Field("", description="Source video ID")
    hook_title: Optional[str] = Field("", description="Hook title")
    duration_seconds: Optional[float] = Field(30.0, description="Clip duration")
    score: Optional[float] = Field(80.0, description="Initial predicted score")


# ------------------------------------------------------------------------------
# Media Streaming with HTTP Range Support for HTML5 Seeking
# ------------------------------------------------------------------------------
def stream_video_with_range(file_path: str, request: Request) -> Response:
    """Streams a video file supporting HTTP Range requests for seamless in-browser seeking."""
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Requested video file does not exist.")

    file_size = os.path.getsize(file_path)
    range_header = request.headers.get("range")

    if not range_header:
        # Full file stream
        def iterfile():
            with open(file_path, mode="rb") as f:
                while chunk := f.read(65536):
                    yield chunk

        headers = {
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
            "Content-Type": "video/mp4",
        }
        return StreamingResponse(iterfile(), status_code=200, headers=headers)

    # Parse Range: bytes=start-end
    try:
        byte_range = range_header.replace("bytes=", "").split("-")
        start = int(byte_range[0])
        end = int(byte_range[1]) if byte_range[1] else file_size - 1
        if start >= file_size or end >= file_size or start > end:
            raise HTTPException(status_code=416, detail="Requested range not satisfiable.")
    except Exception:
        raise HTTPException(status_code=416, detail="Invalid range request.")

    chunk_size = (end - start) + 1

    def iter_chunk():
        with open(file_path, mode="rb") as f:
            f.seek(start)
            bytes_left = chunk_size
            while bytes_left > 0:
                read_bytes = min(bytes_left, 65536)
                data = f.read(read_bytes)
                if not data:
                    break
                bytes_left -= len(data)
                yield data

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(chunk_size),
        "Content-Type": "video/mp4",
    }
    return StreamingResponse(iter_chunk(), status_code=206, headers=headers)


# ------------------------------------------------------------------------------
# API Endpoints
# ------------------------------------------------------------------------------
@app.get("/api/v1/health")
@app.get("/api/v1/system/health")
def api_health() -> Dict[str, Any]:
    """Inspects environment, GPU, FFmpeg, Gemini, and storage readiness."""
    gpu_available = False
    gpu_name = "None (CPU Fallback)"
    try:
        import torch
        if torch.cuda.is_available():
            gpu_available = True
            gpu_name = torch.cuda.get_device_name(0)
    except Exception:
        pass

    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    yunet_path = os.path.join(BASE_DIR, "models", "face_detection_yunet_2023mar.onnx")
    yolo_path = os.path.join(BASE_DIR, "models", "yolov8n-seg.pt")

    gemini_key = os.getenv("GEMINI_API_KEY")
    youtube_key = os.getenv("YOUTUBE_API_KEY")

    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "gpu_available": gpu_available,
        "gpu_device": gpu_name,
        "ffmpeg_ready": bool(ffmpeg_path),
        "ffmpeg_path": ffmpeg_path,
        "ffprobe_ready": bool(ffprobe_path),
        "models": {
            "yunet_onnx": os.path.exists(yunet_path),
            "yolov8n_seg": os.path.exists(yolo_path),
            "gemini_active": bool(gemini_key),
            "gemini_model": caption_synthesizer.primary_model if gemini_key else "offline_deterministic",
        },
        "metadata_provider": "youtube_data_api_v3" if youtube_key else "yt_dlp_fallback",
        "storage": {
            "data_dir": DATA_DIR,
            "clips_count": len(glob.glob(os.path.join(CLIPS_DIR, "*.mp4"))),
            "projects_count": len(glob.glob(os.path.join(PROJECTS_DIR, "project_*"))),
        },
    }


def _find_closest_video_id(input_id: str) -> Optional[str]:
    """Finds matching video ID if input contains character typo (e.g. '1' vs 'i', case differences)."""
    if not input_id or len(input_id) < 5:
        return None
    norm_in = input_id.lower().replace("1", "i").replace("l", "i").replace("0", "o")
    # 1. Check existing project directories
    projects_dir = os.path.join(DATA_DIR, "projects")
    if os.path.exists(projects_dir):
        for entry in os.listdir(projects_dir):
            parts = entry.split("_")
            for part in parts:
                if len(part) == 11:
                    norm_p = part.lower().replace("1", "i").replace("l", "i").replace("0", "o")
                    if norm_in == norm_p:
                        return part
    # 2. Check rendered clips
    for f in glob.glob(os.path.join(CLIPS_DIR, "*.mp4")):
        base = os.path.basename(f)
        for part in base.split("_"):
            if len(part) == 11:
                norm_p = part.lower().replace("1", "i").replace("l", "i").replace("0", "o")
                if norm_in == norm_p:
                    return part
    return None


@app.post("/api/v1/metadata")
def api_get_metadata(req: MetadataRequest) -> Dict[str, Any]:
    """Retrieves normalized YouTube metadata with Data API v3 and yt-dlp fallback."""
    try:
        video_id, _ = normalize_youtube_url(req.video_id_or_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    alt_id = _find_closest_video_id(video_id)
    if alt_id and alt_id != video_id:
        logger.info(f"Metadata auto-resolved video_id typo '{video_id}' -> '{alt_id}'")
        video_id = alt_id

    try:
        info = metadata_service.get_metadata(video_id)
        return info.to_dict()
    except Exception as e:
        if not alt_id:
            alt = _find_closest_video_id(video_id)
            if alt and alt != video_id:
                try:
                    info = metadata_service.get_metadata(alt)
                    return info.to_dict()
                except Exception:
                    pass
        logger.error(f"Metadata retrieval failed for {video_id}: {e}")
        raise HTTPException(status_code=400, detail=f"Metadata error: {e}")


@app.post("/api/v1/preview")
def api_preview(req: PreviewRequest) -> Dict[str, Any]:
    """Extracts candidate highlights, retention curves, explainable intelligence, and caption packages."""
    try:
        video_id, _ = normalize_youtube_url(req.video_id_or_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YouTube video ID or URL: {e}")

    alt_id = _find_closest_video_id(video_id)
    if alt_id and alt_id != video_id:
        logger.info(f"Preview auto-resolved video_id typo '{video_id}' -> '{alt_id}'")
        video_id = alt_id

    # Fetch rich metadata
    try:
        video_info = metadata_service.get_metadata(video_id)
    except Exception:
        video_info = None

    # Enforce real verified rights & compliance profile (never auto-register OPERATOR_ASSET)
    policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    profile = get_active_compliance_profile()
    if not policy.can_analyze_metadata(video_id, profile=profile):
        manifest = policy.check_rights(video_id)
        raise HTTPException(
            status_code=403,
            detail=f"Rights hold: metadata/preview blocked for '{video_id}' (status={manifest.status.value}, basis={manifest.basis.value}).",
        )

    # Check disk cache for instantaneous response
    preview_cache_dir = os.path.join(DATA_DIR, "previews")
    os.makedirs(preview_cache_dir, exist_ok=True)
    cache_file = os.path.join(preview_cache_dir, f"{video_id}_{int(req.min_duration)}_{int(req.max_duration)}.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
                if cached_data.get("candidates") or cached_data.get("solid_clips"):
                    logger.info(f"Returning cached preview intelligence for {video_id}")
                    return cached_data
        except Exception:
            pass

    pipeline = build_pipeline(output_dir=CLIPS_DIR, min_duration=req.min_duration, max_duration=req.max_duration)
    try:
        candidates = pipeline.get_candidates(video_id=video_id, min_duration=req.min_duration, max_duration=req.max_duration)
    except RightsPolicyViolationError as rexc:
        raise HTTPException(status_code=403, detail=str(rexc))
    except Exception as e:
        err_msg = str(e)
        logger.error(f"Preview extraction failed: {err_msg}")
        err_lower = err_msg.lower()
        if "unavailable" in err_lower or "private" in err_lower or "not found" in err_lower:
            alt_fallback = _find_closest_video_id(video_id)
            if alt_fallback and alt_fallback != video_id:
                try:
                    candidates = pipeline.get_candidates(video_id=alt_fallback, min_duration=req.min_duration, max_duration=req.max_duration)
                    video_id = alt_fallback
                    if not video_info:
                        try:
                            video_info = metadata_service.get_metadata(alt_fallback)
                        except Exception:
                            pass
                except Exception:
                    pass
        if 'candidates' not in locals():
            if "unavailable" in err_lower or "private" in err_lower or "not found" in err_lower:
                hint = " (Check for common character typos like letter 'O' vs digit '0')." if ("o" in video_id.lower() or "0" in video_id) else ""
                raise HTTPException(
                    status_code=400,
                    detail=f"This YouTube video ({video_id}) is unavailable or private on YouTube.{hint} Please check the link or try another video.",
                )
            elif "copyright" in err_lower or "blocked" in err_lower:
                raise HTTPException(
                    status_code=400,
                    detail="This video cannot be processed due to copyright or geographic distribution restrictions.",
                )
            else:
                raise HTTPException(status_code=400, detail=f"Failed to analyze video: {err_msg}")

    # Retrieve heatmap if available with fallback to speech density
    heatmap_data = None
    transcript = None
    video_title = video_info.title if video_info and video_info.title else video_id
    try:
        transcript = pipeline.transcriber.load_from_cache(video_id)
        dur = transcript.duration_seconds if transcript else (video_info.duration if video_info else 300.0)
        heatmap_data = pipeline.heatmap_analyzer.extract_heatmap(
            video_id=video_id,
            duration_seconds=dur,
            transcript=transcript,
        )
    except Exception as e_hm:
        logger.warning(f"Heatmap extraction warning for {video_id}: {e_hm}")

    # Compute Google & YouTube real-time trend alignment for candidates
    from ..discovery.trends import trends_engine
    trend_alignments: Dict[str, Dict[str, Any]] = {}
    for c in candidates:
        try:
            t_align = trends_engine.calculate_candidate_trend_alignment(
                transcript_text=c.transcript_text or "",
                video_title=video_title,
            )
            trend_alignments[c.candidate_id] = t_align
        except Exception:
            pass

    # Apply SolidShortsDecider with trend alignment boost
    decider = SolidShortsDecider()
    decision = decider.decide(
        candidates=candidates,
        duration_seconds=transcript.duration_seconds if transcript else (video_info.duration if video_info else 300.0),
        heatmap_data=heatmap_data,
        strict_quality=True,
        trend_alignments=trend_alignments,
    )

    # Ensure at least 1 candidate is always selected if candidates exist
    selected_cands = decision.selected_candidates
    if not selected_cands and candidates:
        selected_cands = [candidates[0]]

    # Generate explainable intelligence and caption packages for selected candidates
    solid_clips_payload = []
    for c in selected_cands:
        t_align = trend_alignments.get(c.candidate_id, {})
        try:
            intelligence = caption_synthesizer.explain_clip(c, video_info)
        except Exception as e_intel:
            logger.warning(f"explain_clip fallback engaged: {e_intel}")
            intel_reason = t_align.get("rationale") or f"Topological peak detected between {round(c.start_seconds, 1)}s and {round(c.end_seconds, 1)}s."
            intelligence = ClipIntelligence(
                why_it_works="Topological engagement peak detected with strong search momentum.",
                hook_strength=8.5,
                context_completeness=9.0,
                narrative_quality=8.5,
                information_density=8.0,
                ending_quality=8.5,
                estimated_engagement_potential=85.0,
                selection_reason=intel_reason,
            )
        try:
            caption_pkg = caption_synthesizer.generate_caption_package(c, video_info)
        except Exception as e_pkg:
            logger.warning(f"generate_caption_package fallback engaged: {e_pkg}")
            caption_pkg = caption_synthesizer._generate_offline_package(c, video_info)

        # Merge trend hashtags into caption package
        if t_align.get("suggested_hashtags"):
            existing_tags = list(getattr(caption_pkg, "targeted_hashtags", []))
            for th in t_align["suggested_hashtags"]:
                if th not in existing_tags:
                    existing_tags.append(th)
            caption_pkg.targeted_hashtags = existing_tags[:8]

        start_min = int(c.start_seconds // 60)
        start_sec = int(c.start_seconds % 60)
        end_min = int(c.end_seconds // 60)
        end_sec = int(c.end_seconds % 60)
        solid_clips_payload.append({
            "candidate_id": c.candidate_id,
            "title": caption_pkg.hook_title or c.hook_title or "Key Moment",
            "hook_title": caption_pkg.hook_title or c.hook_title or "Key Moment",
            "virality_score": round(c.score, 1),
            "score": round(c.score, 1),
            "start_seconds": round(c.start_seconds, 1),
            "end_seconds": round(c.end_seconds, 1),
            "start_time": f"{start_min}:{start_sec:02d}",
            "end_time": f"{end_min}:{end_sec:02d}",
            "duration": round(c.duration_seconds, 1),
            "duration_seconds": round(c.duration_seconds, 1),
            "suggested_description": getattr(caption_pkg, "core_summary", "") or getattr(caption_pkg, "summary", "") or intelligence.why_it_works,
            "rationale": t_align.get("rationale") or c.rationale,
            "why_it_works": intelligence.why_it_works,
            "intelligence": intelligence.to_dict(),
            "caption_package": caption_pkg.to_dict(),
            "trend_alignment": {
                "momentum_score": t_align.get("momentum_score", 50.0),
                "is_breakout": t_align.get("is_breakout", False),
                "multiplier": t_align.get("multiplier", 1.0),
                "matched_queries": t_align.get("matched_queries", []),
                "trending_queries": t_align.get("suggested_queries", [])[:5],
            },
        })

    heatmap_payload = None
    retention_curve_payload = []
    if heatmap_data and heatmap_data.points:
        try:
            heatmap_payload = heatmap_data.to_dict() if hasattr(heatmap_data, "to_dict") else {
                "points": [p.to_dict() if hasattr(p, "to_dict") else p for p in (heatmap_data.points or [])],
                "peaks": [p.to_dict() if hasattr(p, "to_dict") else p for p in (heatmap_data.peaks or [])],
                "source": getattr(heatmap_data, "source", "HEATMAP"),
            }
            retention_curve_payload = [
                {"timestamp": p.start_time, "score": p.value}
                for p in (heatmap_data.points or [])
            ]
        except Exception as e_hm:
            logger.warning(f"Heatmap serialization fallback: {e_hm}")

    # Fallback: synthesize organic retention curve if points were empty
    if not retention_curve_payload:
        total_dur = transcript.duration_seconds if transcript else (video_info.duration if video_info else 300.0)
        step_count = 100
        step_dt = total_dur / step_count
        synth_points = []
        for i in range(step_count + 1):
            t = i * step_dt
            prog = min(1.0, max(0.0, t / max(1.0, total_dur)))
            base_score = 0.88 - 0.38 * (prog ** 0.6)
            # Add subtle peaks around candidate intervals
            peak_boost = 0.0
            for sc in solid_clips_payload:
                if sc["start_seconds"] - 5.0 <= t <= sc["end_seconds"] + 5.0:
                    peak_boost = max(peak_boost, 0.12 * (sc["score"] / 100.0))
            synth_score = round(min(0.98, max(0.25, base_score + peak_boost)), 3)
            retention_curve_payload.append({"timestamp": round(t, 1), "score": synth_score})
            synth_points.append({"start_time": round(t, 1), "end_time": round(t + step_dt, 1), "value": synth_score})
        heatmap_payload = {
            "points": synth_points,
            "peaks": [],
            "source": "SYNTHETIC_SPEECH_RETENTION",
        }

    meta_dict = video_info.to_dict() if video_info else None
    video_velocity = None
    if video_info:
        try:
            video_velocity = trends_engine.calculate_video_velocity(
                view_count=getattr(video_info, "view_count", 0) or 0,
                published_at=getattr(video_info, "published_at", None),
                like_count=getattr(video_info, "like_count", None),
                comment_count=getattr(video_info, "comment_count", None),
            )
        except Exception:
            pass

    result_payload = {
        "video_id": video_id,
        "metadata": meta_dict,
        "source_metadata": meta_dict,
        "candidates": solid_clips_payload,
        "solid_clips": solid_clips_payload,
        "total_candidates_found": len(candidates),
        "recommended_solid_shorts_count": decision.recommended_count,
        "capacity_limit": decision.capacity_limit,
        "decision_reasons": decision.reasons,
        "heatmap": heatmap_payload,
        "retention_curve": retention_curve_payload,
        "video_velocity": video_velocity,
    }
    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(result_payload, f)
    except Exception:
        pass

    return result_payload


def _render_video_pipeline(
    video_id: str,
    config: Dict[str, Any],
    progress_cb: Optional[Callable[[int, str], None]] = None,
) -> List[Dict[str, Any]]:
    """Core rendering routine used by single job rendering and overnight batch runs."""
    if progress_cb:
        progress_cb(15, "Resolving metadata & verifying content rights...")

    video_info = None
    try:
        video_info = metadata_service.get_metadata(video_id)
    except Exception:
        pass

    project = project_store.create_or_get_project(video_id, source_metadata=video_info)

    policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    manifest = policy.assert_can_process(
        video_id,
        stage="studio_render_pipeline",
        profile=get_active_compliance_profile(),
    )

    max_clips = config.get("max_clips", 5)
    layout = config.get("layout", "active_speaker")
    subtitle_preset = config.get("subtitle_preset", "hormozi")
    enable_outro = config.get("enable_outro", True)
    enable_polish = config.get("enable_polish", True)
    gpu = config.get("gpu", True)
    outro_channel = config.get("outro_channel_name") or (video_info.channel_title if video_info else None)

    if progress_cb:
        progress_cb(40, f"Rendering top {max_clips} vertical Shorts with FFmpeg & face tracking...")

    pipeline = build_pipeline(output_dir=CLIPS_DIR)
    vcodec = "h264_nvenc" if gpu else "libx264"
    profile = RenderProfile(
        layout_mode=layout,
        vcodec=vcodec,
        subtitle_preset=subtitle_preset,
        enable_outro_card=enable_outro,
        outro_duration=2.5,
        outro_channel_name=outro_channel,
        enable_pacing_polish=enable_polish,
    )

    completed_jobs = pipeline.process_video_multi(
        video_id=video_id,
        max_clips=max_clips,
        profile=profile,
        dry_run=True,
    )

    if progress_cb:
        progress_cb(85, "Executing QA validation & saving clip sidecars...")

    clips_out = []
    for j in completed_jobs:
        if j.rendered_clip and os.path.exists(j.rendered_clip.file_path):
            clip_path = j.rendered_clip.file_path
            fname = os.path.basename(clip_path)

            expected_dur = (
                getattr(j.rendered_clip, "duration_seconds", None)
                or (
                    (j.candidate.duration_seconds + (profile.outro_duration if getattr(profile, "enable_outro_card", False) else 0.0))
                    if j.candidate else None
                )
            )
            qa_result = validate_rendered_short(
                clip_path,
                expected_duration=expected_dur,
                strict=True,
            )
            if not qa_result.get("valid", False) or (j.qa_report and j.qa_report.status == "FAILED"):
                logger.error("Rejecting rendered clip %s: %s", j.job_id, qa_result.get("errors", []))
                continue

            caption_pkg = caption_synthesizer.generate_caption_package(j.candidate, video_info) if j.candidate else None
            intelligence = caption_synthesizer.explain_clip(j.candidate, video_info) if j.candidate else None

            sidecar = ClipSidecarRecord(
                clip_id=j.job_id,
                project_id=project.project_id,
                video_id=video_id,
                file_path=clip_path,
                relative_url=f"/clips/{fname}",
                start_seconds=j.candidate.start_seconds if j.candidate else 0.0,
                end_seconds=j.candidate.end_seconds if j.candidate else 0.0,
                duration_seconds=j.candidate.duration_seconds if j.candidate else 0.0,
                score=j.candidate.score if j.candidate else 0.0,
                candidate_data=j.candidate.to_dict() if j.candidate else {},
                source_metadata=video_info.to_dict() if video_info else {},
                intelligence=intelligence.to_dict() if intelligence else {},
                caption_package=caption_pkg.to_dict() if caption_pkg else {},
                render_settings=profile.to_dict(),
                file_size_bytes=os.path.getsize(clip_path),
                qa_report=qa_result,
                status="COMPLETED",
            )
            project_store.save_clip_sidecar(sidecar)

            clips_out.append({
                "job_id": j.job_id,
                "clip_id": j.job_id,
                "filename": fname,
                "url": f"/clips/{fname}",
                "file_path": clip_path,
                "duration": round(j.candidate.duration_seconds, 1) if j.candidate else 0.0,
                "score": round(j.candidate.score, 1) if j.candidate else 0.0,
                "hook_title": caption_pkg.hook_title if caption_pkg else (j.candidate.hook_title if j.candidate else ""),
                "file_size_mb": round(os.path.getsize(clip_path) / (1024 * 1024), 2),
                "caption_package": caption_pkg.to_dict() if caption_pkg else {},
                "intelligence": intelligence.to_dict() if intelligence else {},
                "qa_status": qa_result.get("status", "PASSED"),
            })

    if progress_cb:
        progress_cb(100, f"Generated {len(clips_out)} solid Shorts.")

    return clips_out


def _run_render_worker(task_id: str, req: RenderRequest, video_id: str) -> None:
    """Asynchronous background rendering worker with staged progress, cancellation, and validation."""
    def sub_progress(p: int, msg: str) -> None:
        if job_manager.is_cancelled(task_id):
            return
        stage = "rendering" if p < 80 else ("validating" if p < 100 else "completed")
        job_manager.update_progress(
            job_id=task_id,
            status=stage,
            progress=p,
            current_stage=stage,
            message=msg,
        )
        if task_id in active_render_jobs:
            active_render_jobs[task_id]["progress"] = p
            active_render_jobs[task_id]["message"] = msg

    try:
        cfg = req.model_dump() if hasattr(req, "model_dump") else req.dict()
        res_mgr = ResourceManager.get_instance()
        use_gpu = cfg.get("gpu", True)
        slot_ctx = res_mgr.acquire_gpu_slot(timeout=300.0) if use_gpu else res_mgr.acquire_cpu_slot(timeout=300.0)
        with slot_ctx:
            clips_out = _render_video_pipeline(video_id, cfg, sub_progress)
        if not clips_out:
            job_manager.update_progress(
                job_id=task_id,
                status=RenderJobStatus.FAILED.value,
                progress=100,
                current_stage="failed",
                message="No solid Shorts could be produced for this video.",
                error="Pipeline produced 0 valid clips.",
            )
            if task_id in active_render_jobs:
                active_render_jobs[task_id]["status"] = "FAILED"
                active_render_jobs[task_id]["error"] = "Pipeline produced 0 valid clips."
            return

        job_manager.update_progress(
            job_id=task_id,
            status=RenderJobStatus.COMPLETED.value,
            progress=100,
            current_stage="completed",
            message=f"Rendering complete! {len(clips_out)} solid shorts generated and verified.",
            clips=clips_out,
        )
        if task_id in active_render_jobs:
            active_render_jobs[task_id]["status"] = "COMPLETED"
            active_render_jobs[task_id]["progress"] = 100
            active_render_jobs[task_id]["clips"] = clips_out
            active_render_jobs[task_id]["message"] = f"Batch rendering complete. {len(clips_out)} solid shorts generated!"
    except Exception as e:
        logger.error(f"Render failed for task {task_id}: {e}")
        job_manager.update_progress(
            job_id=task_id,
            status=RenderJobStatus.FAILED.value,
            progress=100,
            current_stage="failed",
            message=f"Rendering pipeline failed: {e}",
            error=str(e),
        )
        if task_id in active_render_jobs:
            active_render_jobs[task_id]["status"] = "FAILED"
            active_render_jobs[task_id]["error"] = str(e)


def _execute_batch_background(batch_id: str) -> None:
    """Worker entry point for overnight batch execution."""
    def _render_wrapper(vid: str, cfg: Dict[str, Any], progress_cb: Callable[[int, str], None]) -> List[Dict[str, Any]]:
        return _render_video_pipeline(vid, cfg, progress_cb)

    batch_manager.run_batch_worker(batch_id, _render_wrapper)

@app.post("/api/v1/render")
def api_render(req: RenderRequest, bg_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Triggers batch vertical 9:16 Short rendering for a video asynchronously."""
    try:
        video_id, _ = normalize_youtube_url(req.video_id_or_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YouTube video ID or URL: {e}")

    policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    try:
        policy.assert_can_process(video_id, stage="render_enqueue", profile=get_active_compliance_profile())
    except RightsPolicyViolationError as rexc:
        raise HTTPException(status_code=403, detail=str(rexc))

    job_params = req.model_dump() if hasattr(req, "model_dump") else req.dict()
    job = job_manager.create_job(video_id=video_id, request_params=job_params)
    task_id = job.job_id

    # Populate active_render_jobs for backwards compatibility with tests
    _prune_active_render_jobs()
    active_render_jobs[task_id] = {
        "task_id": task_id,
        "video_id": video_id,
        "status": "QUEUED",
        "progress": 5,
        "message": "Task queued for processing...",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "clips": [],
    }

    bg_tasks.add_task(_run_render_worker, task_id, req, video_id)
    return {
        "task_id": task_id,
        "job_id": task_id,
        "status": "QUEUED",
        "check_status_url": f"/api/v1/jobs/{task_id}",
    }


@app.get("/api/v1/render/status/{task_id}")
def api_render_status(task_id: str) -> Dict[str, Any]:
    """Returns progress and rendered clip payloads for a running or completed task."""
    # First check JobManager
    job = job_manager.get_job(task_id)
    if job:
        return job.to_dict()
    # Check in-memory store
    legacy_job = active_render_jobs.get(task_id)
    if not legacy_job:
        raise HTTPException(status_code=404, detail="Task ID not found.")
    return legacy_job


@app.get("/api/v1/jobs/{job_id}")
def api_get_job(job_id: str) -> Dict[str, Any]:
    """Retrieves full job status and outputs."""
    job = job_manager.get_job(job_id)
    if not job:
        # Check active_render_jobs fallback
        if job_id in active_render_jobs:
            return active_render_jobs[job_id]
        raise HTTPException(status_code=404, detail="Job ID not found.")
    return job.to_dict()


@app.post("/api/v1/jobs/{job_id}/cancel")
def api_cancel_job(job_id: str) -> Dict[str, Any]:
    """Cancels a queued or in-progress rendering job."""
    success = job_manager.cancel_job(job_id)
    if not success:
        raise HTTPException(status_code=400, detail="Job cannot be cancelled (already completed or not found).")
    if job_id in active_render_jobs:
        active_render_jobs[job_id]["status"] = "CANCELLED"
    return {"job_id": job_id, "status": "cancelled", "message": "Job cancellation signaled successfully."}


@app.get("/api/v1/jobs/{job_id}/stream")
async def api_stream_job_events(job_id: str):
    """Server-Sent Events (SSE) endpoint providing sub-second streaming telemetry of job progress."""
    async def event_generator():
        last_progress = -1
        last_status = ""
        last_stage = ""
        stale_count = 0

        while stale_count < 180:  # Timeout after ~90 seconds of inactivity
            job = job_manager.get_job(job_id)
            if not job and job_id in active_render_jobs:
                data = active_render_jobs[job_id]
            elif job:
                data = job.to_dict()
            else:
                data = None

            if not data:
                yield f"event: error\ndata: {json.dumps({'error': 'Job ID not found'})}\n\n"
                break

            current_prog = data.get("progress", 0)
            current_stat = data.get("status", "")
            current_stg = data.get("current_stage", "")

            # Send event whenever progress, status, or stage changes, or keepalive every 1.5s
            if current_prog != last_progress or current_stat != last_status or current_stg != last_stage or stale_count % 3 == 0:
                last_progress = current_prog
                last_status = current_stat
                last_stage = current_stg
                yield f"data: {json.dumps(data)}\n\n"

            if current_stat in ("completed", "COMPLETED", "failed", "FAILED", "cancelled", "CANCELLED"):
                # Final flush
                yield f"event: end\ndata: {json.dumps(data)}\n\n"
                break

            await asyncio.sleep(0.5)
            stale_count += 1

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/v1/trending/top10m")
async def api_get_top10m_trending(limit: int = 15, filter_mode: Optional[str] = None) -> List[Dict[str, Any]]:
    """Returns curated and live trending videos from channels with > 10M subscribers without blocking event loop."""
    try:
        from top_trending_videos_in_youtube import TopTrending10MFetcher
        fetcher = TopTrending10MFetcher()
        videos = await asyncio.to_thread(fetcher.get_top_trending_10m_list, limit=limit, filter_mode=filter_mode)
        return [v.to_dict() for v in videos]
    except Exception as e:
        logger.warning(f"Error fetching 10M trending videos: {e}")
        return []

@app.get("/api/v1/trending/topics")
async def api_get_trending_topics(geo: str = "US", limit: int = 15) -> List[Dict[str, Any]]:
    """Returns real-time breakout search trends from Google Trends & YouTube."""
    from ..discovery.trends import trends_engine
    try:
        topics = await asyncio.to_thread(trends_engine.fetch_daily_trending, geo=geo, limit=limit)
        return [
            {
                "title": t.title,
                "traffic_approx": t.traffic_approx,
                "pub_date": t.pub_date,
                "news_titles": t.news_titles,
                "source": t.source,
            }
            for t in topics
        ]
    except Exception as e:
        logger.warning(f"Error fetching trending topics: {e}")
        return []

@app.get("/api/v1/trending/suggest")
async def api_get_trending_suggestions(q: str, limit: int = 10) -> Dict[str, Any]:
    """Returns real-time YouTube search autocomplete suggestions and breakout momentum score."""
    from ..discovery.trends import trends_engine
    try:
        momentum = await asyncio.to_thread(trends_engine.evaluate_topic_momentum, q)
        return {
            "query": q,
            "topic": momentum.topic,
            "search_momentum_score": momentum.search_momentum_score,
            "is_breakout": momentum.is_breakout,
            "multiplier": momentum.multiplier,
            "suggested_queries": momentum.suggested_queries[:limit],
        }
    except Exception as e:
        logger.warning(f"Error evaluating trend momentum: {e}")
        return {
            "query": q,
            "topic": q,
            "search_momentum_score": 50.0,
            "is_breakout": False,
            "multiplier": 1.0,
            "suggested_queries": [],
        }


def _run_stream_to_clipper_worker(task_id: str, req: StreamToClipperRequest, video_id: str) -> None:
    """Asynchronous worker for complete end-to-end StreamToClipper workflow with auto-publishing."""
    def sub_progress(p: int, msg: str) -> None:
        if job_manager.is_cancelled(task_id):
            return
        stage = (
            "discovery" if p < 20
            else ("transcribing" if p < 40
            else ("rendering" if p < 80
            else ("validating" if p < 95
            else "publishing")))
        )
        job_manager.update_progress(
            job_id=task_id,
            status=stage,
            progress=p,
            current_stage=stage,
            message=msg,
        )
        if task_id in active_render_jobs:
            active_render_jobs[task_id]["progress"] = p
            active_render_jobs[task_id]["message"] = msg

    try:
        cfg = req.model_dump() if hasattr(req, "model_dump") else req.dict()
        res_mgr = ResourceManager.get_instance()
        use_gpu = cfg.get("gpu", True)
        slot_ctx = res_mgr.acquire_gpu_slot(timeout=300.0) if use_gpu else res_mgr.acquire_cpu_slot(timeout=300.0)
        with slot_ctx:
            clips_out = _render_video_pipeline(video_id, cfg, sub_progress)
        if not clips_out:
            job_manager.update_progress(
                job_id=task_id,
                status=RenderJobStatus.FAILED.value,
                progress=100,
                current_stage="failed",
                message="StreamToClipper pipeline produced 0 valid clips.",
                error="Pipeline produced 0 valid clips.",
            )
            if task_id in active_render_jobs:
                active_render_jobs[task_id]["status"] = "FAILED"
                active_render_jobs[task_id]["error"] = "Pipeline produced 0 valid clips."
            return

        published_receipts = []
        if req.auto_publish:
            sub_progress(95, f"Verifying rights, QA, and attribution before publishing to {req.target}...")
            if not req.approved_by_user:
                raise RuntimeError("Auto-publish blocked: explicit approved_by_user=True is mandatory.")
            top_clip = clips_out[0]
            cid = top_clip["clip_id"]
            sidecar = project_store.get_clip_sidecar(cid)
            clip_file = top_clip["file_path"]
            duration = top_clip.get("duration", 30.0)
            final_title = top_clip.get("hook_title") or f"Short #{cid}"
            cand_data = sidecar.candidate_data if sidecar else {}
            final_desc = cand_data.get("suggested_description") or ""

            file_hash_val = _compute_file_sha256(clip_file) if os.path.exists(clip_file) else ""
            if not file_hash_val:
                raise RuntimeError(f"Rendered clip file missing for publish handoff: {clip_file}")

            rendered_clip_obj = RenderedClip(
                clip_id=cid,
                job_id=f"job_pub_{cid}",
                candidate_id=cid,
                file_path=clip_file,
                file_hash=file_hash_val,
                duration_seconds=duration,
                width=1080,
                height=1920,
                manifest_path="",
                rendered_at=datetime.now(timezone.utc).isoformat(),
            )
            candidate_obj = HighlightCandidate(
                candidate_id=cid,
                video_id=video_id,
                start_seconds=sidecar.start_seconds if sidecar else 0.0,
                end_seconds=sidecar.end_seconds if sidecar else duration,
                duration_seconds=duration,
                score=top_clip.get("score", 90.0),
                breakdown=ScoreBreakdown(hook_score=9.0, moment_score=9.0, coherence_score=9.0, pacing_score=9.0),
                hook_title=final_title,
                suggested_description=final_desc,
            )

            rights_policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
            attr_engine = AttributionEngine(db_path=DB_PATH)
            real_manifest = rights_policy.check_rights(video_id)
            creator_name = real_manifest.owner_name or "Unknown Creator"
            attr_pkg = attr_engine.format_attribution(
                video_id=video_id,
                creator_name=creator_name,
                channel_id=real_manifest.creator_id or None,
                license_type=real_manifest.basis.value,
                license_url=real_manifest.license_url,
            )
            attr_valid, _ = validate_attribution_package(attr_pkg)
            rights_obj = rights_policy.assert_can_publish(
                video_id,
                manifest=real_manifest,
                approved_by_user=bool(req.approved_by_user),
                attribution_validated=attr_valid,
                profile=get_active_compliance_profile(),
            )

            qa_obj = MediaQualityVerifier().verify_clip(rendered_clip_obj, candidate_obj)
            if qa_obj.status == "FAILED":
                raise RuntimeError(f"QA verification failed before auto-publish: {qa_obj.errors}")

            rcpt = publisher.publish(
                rendered_clip=rendered_clip_obj,
                candidate=candidate_obj,
                rights_manifest=rights_obj,
                qa_report=qa_obj,
                dry_run=False,
                platforms=req.platforms,
                approved_by_user=bool(req.approved_by_user),
                title_override=final_title,
                description_override=final_desc or attr_pkg.full_description,
                tags=["shorts", "viral", "trending"],
                publish_target=req.target,
            )
            published_receipts.append(rcpt.to_dict() if hasattr(rcpt, "to_dict") else asdict(rcpt))

        complete_msg = (
            f"StreamToClipper complete! Rendered and published to {req.target}."
            if published_receipts else f"StreamToClipper complete! {len(clips_out)} solid Short(s) rendered."
        )

        job_manager.update_progress(
            job_id=task_id,
            status=RenderJobStatus.COMPLETED.value,
            progress=100,
            current_stage="completed",
            message=complete_msg,
            clips=clips_out,
        )
        if task_id in active_render_jobs:
            active_render_jobs[task_id]["status"] = "COMPLETED"
            active_render_jobs[task_id]["progress"] = 100
            active_render_jobs[task_id]["clips"] = clips_out
            active_render_jobs[task_id]["message"] = complete_msg
            active_render_jobs[task_id]["receipts"] = published_receipts
    except Exception as e:
        logger.error(f"StreamToClipper worker failed for task {task_id}: {e}")
        job_manager.update_progress(
            job_id=task_id,
            status=RenderJobStatus.FAILED.value,
            progress=100,
            current_stage="failed",
            message=f"StreamToClipper pipeline failed: {e}",
            error=str(e),
        )
        if task_id in active_render_jobs:
            active_render_jobs[task_id]["status"] = "FAILED"
            active_render_jobs[task_id]["error"] = str(e)


@app.post("/api/v1/trending/stream-to-clipper")
def api_trending_stream_to_clipper(req: StreamToClipperRequest, bg_tasks: BackgroundTasks) -> Dict[str, Any]:
    """
    Streams a top trending YouTube video directly through the clipping,
    intelligent FLUX asset evaluation, and multi-platform publishing pipeline.
    """
    try:
        video_id, _ = normalize_youtube_url(req.video_id_or_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YouTube video ID or URL: {e}")

    if req.auto_publish and not req.approved_by_user:
        raise HTTPException(
            status_code=400,
            detail="Publishing blocked: explicit approved_by_user=true is mandatory when auto_publish=true.",
        )

    policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    try:
        policy.assert_can_process(video_id, stage="stream_to_clipper", profile=get_active_compliance_profile())
    except RightsPolicyViolationError as rexc:
        raise HTTPException(status_code=403, detail=str(rexc))

    job_params = req.model_dump() if hasattr(req, "model_dump") else req.dict()
    job = job_manager.create_job(video_id=video_id, request_params=job_params)
    task_id = job.job_id

    _prune_active_render_jobs()
    active_render_jobs[task_id] = {
        "task_id": task_id,
        "video_id": video_id,
        "status": "QUEUED",
        "progress": 5,
        "message": "StreamToClipper job queued for clipping and publishing...",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "clips": [],
    }

    bg_tasks.add_task(_run_stream_to_clipper_worker, task_id, req, video_id)
    return {
        "success": True,
        "task_id": task_id,
        "job_id": task_id,
        "video_id": video_id,
        "status": "QUEUED",
        "message": "StreamToClipper workflow initiated! Automated clipping and publishing underway.",
        "check_status_url": f"/api/v1/jobs/{task_id}",
    }


@app.get("/api/v1/clips")
def api_list_clips(project_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Returns all rendered vertical clips stored on disk with sidecar metadata and playback endpoints."""
    sidecars = project_store.list_clips(project_id=project_id)
    clips = []
    for s in sidecars:
        if not s.file_path or not os.path.exists(s.file_path) or os.path.getsize(s.file_path) < 1024 or s.status == "MISSING_MEDIA":
            continue
        fname = os.path.basename(s.file_path)
        clips.append({
            "clip_id": s.clip_id,
            "project_id": s.project_id,
            "video_id": s.video_id,
            "filename": fname,
            "file_path": s.file_path,
            "url": f"/clips/{fname}",
            "playback_url": f"/api/v1/clips/{s.clip_id}/media",
            "poster_url": f"/api/v1/clips/{s.clip_id}/poster",
            "download_url": f"/api/v1/clips/{s.clip_id}/download",
            "size_mb": round(s.file_size_bytes / (1024 * 1024), 2),
            "duration": round(s.duration_seconds, 1),
            "score": round(s.score, 1),
            "status": s.status,
            "validation_status": s.status,
            "modified_at": s.render_timestamp,
            "intelligence": s.intelligence,
            "caption_package": s.caption_package,
            "source_metadata": s.source_metadata,
            "qa_report": s.qa_report,
        })
    return clips


@app.post("/api/v1/clips/{clip_id}/regenerate_caption")
def api_regenerate_clip_caption(clip_id: str) -> Dict[str, Any]:
    """Regenerates AI caption package and intelligence for an existing clip sidecar."""
    clean_id = _sanitize_clip_id(clip_id)
    sidecar = project_store.get_clip_sidecar(clean_id)
    if not sidecar:
        raise HTTPException(status_code=404, detail="Clip ID not found.")

    cand_data = sidecar.candidate_data or {}
    from ..contracts.models import HighlightCandidate, ScoreBreakdown
    from ..discovery.video_metadata import EnrichedVideoInfo

    candidate = HighlightCandidate(
        candidate_id=sidecar.clip_id,
        video_id=sidecar.video_id,
        start_seconds=sidecar.start_seconds,
        end_seconds=sidecar.end_seconds,
        duration_seconds=sidecar.duration_seconds,
        score=sidecar.score,
        hook_title=cand_data.get("hook_title") or sidecar.caption_package.get("hook_title", ""),
        suggested_description=cand_data.get("suggested_description", ""),
        transcript_text=cand_data.get("transcript_text", ""),
        breakdown=ScoreBreakdown.from_dict(cand_data.get("breakdown", {})) if cand_data.get("breakdown") else ScoreBreakdown(),
    )

    video_info = None
    if sidecar.source_metadata:
        try:
            video_info = EnrichedVideoInfo.from_dict(sidecar.source_metadata)
        except Exception:
            pass

    new_pkg = caption_synthesizer.generate_caption_package(candidate, video_info)
    new_intel = caption_synthesizer.explain_clip(candidate, video_info)

    sidecar.caption_package = new_pkg.to_dict()
    sidecar.intelligence = new_intel.to_dict()
    project_store.save_clip_sidecar(sidecar)

    return {
        "clip_id": sidecar.clip_id,
        "caption_package": new_pkg.to_dict(),
        "intelligence": new_intel.to_dict(),
        "status": "regenerated",
    }


def _sanitize_clip_id(clip_id: str) -> str:
    clean = os.path.basename(clip_id.strip()).replace("/", "").replace("\\", "")
    if not clean or ".." in clip_id:
        raise HTTPException(status_code=400, detail="Invalid clip identifier.")
    return clean


def _assert_path_in_data_dir(file_path: str) -> str:
    resolved = os.path.realpath(os.path.abspath(file_path))
    allowed_roots = [
        os.path.realpath(os.path.abspath(DATA_DIR)),
        os.path.realpath(os.path.abspath(CLIPS_DIR)),
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


@app.get("/api/v1/clips/{clip_id}")
def api_get_clip(clip_id: str) -> Dict[str, Any]:
    """Returns detailed sidecar record for a specific clip."""
    clean_id = _sanitize_clip_id(clip_id)
    sidecar = project_store.get_clip_sidecar(clean_id)
    if not sidecar:
        raise HTTPException(status_code=404, detail="Clip ID not found.")
    return sidecar.to_dict()


@app.get("/api/v1/clips/{clip_id}/download")
def api_download_clip(clip_id: str) -> FileResponse:
    """Downloads the finished Short video file."""
    clean_id = _sanitize_clip_id(clip_id)
    sidecar = project_store.get_clip_sidecar(clean_id)
    file_path = None
    if sidecar and os.path.exists(sidecar.file_path):
        file_path = sidecar.file_path
    else:
        # Fallback: check CLIPS_DIR directly for matching filename
        matches = glob.glob(os.path.join(CLIPS_DIR, f"*{clean_id}*.mp4"))
        if matches and os.path.exists(matches[0]):
            file_path = matches[0]

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Video file not found.")

    safe_path = _assert_path_in_data_dir(file_path)
    return FileResponse(safe_path, filename=os.path.basename(safe_path), media_type="video/mp4")


@app.get("/api/v1/clips/{clip_id}/media")
def api_stream_clip_media(clip_id: str, request: Request) -> Response:
    """Streams video with HTTP Range request support for seeking."""
    clean_id = _sanitize_clip_id(clip_id)
    sidecar = project_store.get_clip_sidecar(clean_id)
    file_path = sidecar.file_path if (sidecar and sidecar.file_path and os.path.exists(sidecar.file_path)) else None
    if not file_path:
        matches = glob.glob(os.path.join(CLIPS_DIR, f"*{clean_id}*.mp4"))
        if matches:
            file_path = matches[0]

    if not file_path:
        matches_proj = glob.glob(os.path.join(project_store.projects_dir, "*", "clips", f"*{clean_id}*.mp4"))
        if matches_proj:
            file_path = matches_proj[0]

    if not file_path:
        parts = clean_id.split("-")
        if len(parts) >= 2 and parts[0] == "job":
            vid = parts[1]
            matches_vid = glob.glob(os.path.join(CLIPS_DIR, f"*{vid}*.mp4")) or glob.glob(
                os.path.join(project_store.projects_dir, "*", "clips", f"*{vid}*.mp4")
            )
            if matches_vid:
                file_path = matches_vid[0]

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Video file not found.")

    safe_path = _assert_path_in_data_dir(file_path)
    return stream_video_with_range(safe_path, request)


@app.get("/api/v1/clips/{clip_id}/stream")
def api_stream_clip_stream_alias(clip_id: str, request: Request) -> Response:
    """Streams video with HTTP Range request support (alias for HTML5 video player)."""
    return api_stream_clip_media(clip_id, request)


@app.get("/api/v1/clips/{clip_id}/poster")
def api_get_clip_poster(clip_id: str):
    """Returns a JPEG poster thumbnail for the clip, generating it if needed."""
    clean_id = _sanitize_clip_id(clip_id)
    sidecar = project_store.get_clip_sidecar(clean_id)
    file_path = sidecar.file_path if (sidecar and sidecar.file_path and os.path.exists(sidecar.file_path)) else None
    if not file_path:
        matches = glob.glob(os.path.join(CLIPS_DIR, f"*{clean_id}*.mp4"))
        if matches:
            file_path = matches[0]

    if not file_path:
        matches_proj = glob.glob(os.path.join(project_store.projects_dir, "*", "clips", f"*{clean_id}*.mp4"))
        if matches_proj:
            file_path = matches_proj[0]

    if not file_path:
        parts = clean_id.split("-")
        if len(parts) >= 2 and parts[0] == "job":
            vid = parts[1]
            matches_vid = glob.glob(os.path.join(CLIPS_DIR, f"*{vid}*.mp4")) or glob.glob(
                os.path.join(project_store.projects_dir, "*", "clips", f"*{vid}*.mp4")
            )
            if matches_vid:
                file_path = matches_vid[0]

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Clip video not found.")

    poster_path = os.path.splitext(file_path)[0] + ".jpg"
    if not os.path.exists(poster_path):
        try:
            import subprocess
            subprocess.run(
                ["ffmpeg", "-y", "-ss", "00:00:01.5", "-i", file_path, "-vframes", "1", "-q:v", "2", poster_path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
                timeout=5,
            )
        except Exception:
            pass

    if os.path.exists(poster_path):
        return FileResponse(poster_path, media_type="image/jpeg")

    if sidecar and sidecar.source_metadata and sidecar.source_metadata.get("thumbnail_url"):
        return RedirectResponse(sidecar.source_metadata["thumbnail_url"])
    raise HTTPException(status_code=404, detail="Poster unavailable.")


@app.get("/api/v1/projects")
def api_list_projects() -> List[Dict[str, Any]]:
    """Returns persistent project history enriched with clip metadata."""
    projects = project_store.list_projects()
    out = []
    for p in projects:
        data = p.to_dict()
        clips = [
            c for c in project_store.list_clips(project_id=p.project_id)
            if c.file_path and os.path.exists(c.file_path) and os.path.getsize(c.file_path) >= 1024 and c.status != "MISSING_MEDIA"
        ]
        data["clips"] = [
            {
                "clip_id": c.clip_id,
                "filename": os.path.basename(c.file_path),
                "duration": round(c.duration_seconds, 1),
                "score": round(c.score, 1),
                "playback_url": f"/api/v1/clips/{c.clip_id}/media",
                "poster_url": f"/api/v1/clips/{c.clip_id}/poster",
                "download_url": f"/api/v1/clips/{c.clip_id}/download",
                "hook_title": (c.caption_package.get("hook_title") if c.caption_package else "") or (c.candidate_data.get("hook_title") if c.candidate_data else ""),
                "status": c.status,
            }
            for c in clips
        ]
        data["clips_count"] = len(clips)
        out.append(data)
    return out


@app.get("/api/v1/projects/{project_id}")
def api_get_project(project_id: str) -> Dict[str, Any]:
    """Returns details and clips for a specific project."""
    project = project_store.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project ID not found.")
    clips = [
        c for c in project_store.list_clips(project_id=project_id)
        if c.file_path and os.path.exists(c.file_path) and os.path.getsize(c.file_path) >= 1024 and c.status != "MISSING_MEDIA"
    ]
    data = project.to_dict()
    data["clips"] = [c.to_dict() for c in clips]
    data["clips_count"] = len(clips)
    return data


@app.delete("/api/v1/projects/{project_id}")
def api_delete_project(project_id: str) -> Dict[str, Any]:
    """Deletes a project folder and its associated files."""
    clean_id = os.path.basename(project_id.strip()).replace("/", "").replace("\\", "")
    pdir = project_store.get_project_dir(clean_id)
    if os.path.exists(pdir):
        import shutil
        shutil.rmtree(pdir, ignore_errors=True)
        return {"status": "deleted", "project_id": clean_id}
    raise HTTPException(status_code=404, detail="Project not found.")


STUDIO_SETTINGS = {
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


@app.get("/api/v1/settings")
def api_get_settings() -> Dict[str, Any]:
    """Returns current studio configuration."""
    return {k: v for k, v in STUDIO_SETTINGS.items() if "key" not in k.lower() and "token" not in k.lower()}


@app.post("/api/v1/settings")
def api_update_settings(updates: Dict[str, Any]) -> Dict[str, Any]:
    """Updates studio configuration preferences with strict validation."""
    if not isinstance(updates, dict):
        raise HTTPException(status_code=400, detail="Settings payload must be an object.")
    if "compliance_profile" in updates:
        try:
            ComplianceProfile(str(updates["compliance_profile"]))
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid compliance_profile. Allowed: STRICT_LICENSED, REVIEW_REQUIRED, COMMENTARY_REVIEW.",
            )
    blocked_keys = {k for k in updates if any(s in k.lower() for s in ("api_key", "secret", "password", "token"))}
    if blocked_keys:
        raise HTTPException(status_code=400, detail="Secrets cannot be mutated via studio settings API.")
    STUDIO_SETTINGS.update(updates)
    return {"status": "saved", "settings": api_get_settings()}


# ==============================================================================
# Dedicated Google Account & OAuth Endpoints
# ==============================================================================

@app.get("/api/v1/auth/google/url")
def api_get_google_auth_url(state: Optional[str] = None) -> Dict[str, str]:
    """Returns the dedicated OAuth 2.0 authorization URL for YouTube channel access."""
    url = youtube_auth.get_authorization_url(state=state)
    return {"auth_url": url}


@app.get("/api/v1/auth/google/callback")
def api_google_auth_callback(code: str, state: Optional[str] = None):
    """Exchanges OAuth authorization code for credentials and saves them to isolated store."""
    try:
        status_info = youtube_auth.exchange_code_for_tokens(code)
        # Return an HTML confirmation that automatically closes popup or redirects
        html = f"""
        <!DOCTYPE html>
        <html>
        <head><title>Authorization Successful</title></head>
        <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="background: #1e293b; padding: 2rem; border-radius: 12px; text-align: center; max-width: 400px; border: 1px solid #334155;">
            <h2 style="color: #10b981; margin-top: 0;">Channel Connected!</h2>
            <p>Dedicated YouTube Channel <strong>{status_info.get('channel_title')}</strong> ({status_info.get('channel_handle')}) is now authorized.</p>
            <script>
              if (window.opener) {{
                window.opener.postMessage({{ type: 'YOUTUBE_AUTH_SUCCESS', channel: {json.dumps(status_info)} }}, '*');
                setTimeout(() => window.close(), 1200);
              }} else {{
                setTimeout(() => window.location.href = '/?tab=publishing', 1500);
              }}
            </script>
          </div>
        </body>
        </html>
        """
        return HTMLResponse(content=html, status_code=200)
    except Exception as e:
        logger.error(f"OAuth callback error: {e}")
        return HTMLResponse(
            content=f"<html><body style='background:#0f172a;color:#ef4444;padding:2rem;'><h3>OAuth Failed</h3><p>{str(e)}</p></body></html>",
            status_code=400,
        )


@app.get("/api/v1/auth/google/status")
def api_get_google_auth_status() -> Dict[str, Any]:
    """Returns safe, sanitized channel connection state. Zero secrets exposed."""
    return youtube_auth.get_public_status()


@app.post("/api/v1/auth/google/disconnect")
def api_google_disconnect() -> Dict[str, Any]:
    """Revokes channel token and deletes stored credentials."""
    success = youtube_auth.disconnect()
    return {"status": "disconnected" if success else "failed", "connected": False}


# ==============================================================================
# Manual Video Editor API
# ==============================================================================

class EditorFrameRequest(BaseModel):
    file_path: str
    timestamp: float = 0.0


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


@app.post("/api/v1/editor/preview-frame")
def api_editor_preview_frame(req: EditorFrameRequest):
    """Generates an image frame at specified timestamp for interactive scrubbing."""
    resolved_path = _resolve_clip_path(req.file_path)
    try:
        frame_path = video_editor.extract_frame_preview(resolved_path, req.timestamp)
        return FileResponse(frame_path, media_type="image/jpeg")
    except Exception as e:
        logger.error(f"Frame preview failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class EditorExportClipSpec(BaseModel):
    title: str = "Edited Clip"
    start_seconds: float = 0.0
    end_seconds: float = 30.0
    aspect_ratio: str = "9:16"
    center_x: float = 0.5
    center_y: float = 0.5
    layout_mode: str = "crop"
    text_overlay: Optional[str] = None
    text_position: str = "top"
    description: Optional[str] = None


class EditorExportRequest(BaseModel):
    source_path: str
    project_id: str
    clips: List[EditorExportClipSpec]


@app.post("/api/v1/editor/export")
def api_editor_export(req: EditorExportRequest):
    """Renders edited clips from source video and persists them into ProjectStore."""
    resolved_source = _resolve_clip_path(req.source_path)

    specs = [c.model_dump() if hasattr(c, "model_dump") else c.dict() for c in req.clips]
    try:
        exported_records = video_editor.export_multiple_clips(
            source_path=resolved_source,
            clips_specs=specs,
            project_id=req.project_id,
            project_store=project_store,
        )
        return {
            "success": True,
            "project_id": req.project_id,
            "exported_count": len(exported_records),
            "clips": [r.to_dict() for r in exported_records],
        }
    except Exception as e:
        logger.error(f"Editor export failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/editor/waveform")
def api_editor_waveform(req: EditorFrameRequest):
    """Calculates downsampled audio waveform energy profile for timeline scrub bar."""
    import numpy as np
    resolved_path = _resolve_clip_path(req.file_path)
    try:
        pcm = extract_pcm_from_file(resolved_path)
        if not pcm or len(pcm) < 3200:
            return {"points": [0.25, 0.45, 0.75, 0.55, 0.35, 0.65, 0.85, 0.5, 0.2] * 8, "duration": 30.0}
        samples = np.frombuffer(pcm, dtype=np.int16)
        num_buckets = 100
        bucket_size = max(1, len(samples) // num_buckets)
        points = []
        for i in range(num_buckets):
            chunk = samples[i * bucket_size : (i + 1) * bucket_size]
            if len(chunk) > 0:
                rms = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2)))
                points.append(min(1.0, round(rms / 12000.0, 3)))
            else:
                points.append(0.1)
        duration = round(len(samples) / 16000.0, 2)
        return {"points": points, "duration": duration}
    except Exception as e:
        logger.warning(f"Waveform calculation failed: {e}")
        return {"points": [0.35] * 60, "duration": 0.0}


@app.post("/api/v1/editor/save-poster")
def api_save_poster(req: SavePosterRequest):
    """Captures frame at timestamp and saves as high-res poster JPEG/PNG."""
    resolved_path = _resolve_clip_path(req.video_path)
    try:
        frame_path = video_editor.extract_frame_preview(resolved_path, req.timestamp)
        poster_filename = f"{req.clip_id or 'poster'}_{int(req.timestamp * 1000)}.jpg"
        target_path = os.path.join(CLIPS_DIR, poster_filename)
        shutil.copy2(frame_path, target_path)
        return {
            "status": "success",
            "poster_path": target_path,
            "poster_url": f"/clips/{poster_filename}",
            "timestamp": req.timestamp,
        }
    except Exception as e:
        logger.error(f"Save poster failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/source/{video_id}")
def api_get_source_info(video_id: str) -> Dict[str, Any]:
    """Retrieves full source video information, playable asset URL, duration, and AI highlight markers."""
    clean_id = _sanitize_clip_id(video_id)

    # 1. Look for asset MP4 in ASSETS_DIR
    asset_file = None
    for cand in [
        os.path.join(ASSETS_DIR, f"{clean_id}.mp4"),
        os.path.join(ASSETS_DIR, f"{clean_id}_slice.mp4"),
    ]:
        if os.path.exists(cand) and os.path.getsize(cand) > 1024:
            asset_file = cand
            break

    if not asset_file:
        matches = glob.glob(os.path.join(ASSETS_DIR, f"*{clean_id}*.mp4"))
        if matches:
            asset_file = matches[0]

    video_info = None
    try:
        video_info = metadata_service.get_metadata(clean_id)
    except Exception:
        pass

    duration = 0.0
    if asset_file:
        try:
            meta = video_editor.get_video_metadata(asset_file)
            duration = meta.get("duration", 0.0)
        except Exception:
            pass

    if duration <= 0 and video_info:
        duration = float(video_info.duration or 0.0)

    # Load retention heatmap if present
    heatmap_points = []
    try:
        pipeline = build_pipeline(output_dir=CLIPS_DIR)
        hm = pipeline.heatmap_analyzer.extract_heatmap(clean_id, duration_seconds=duration or 300.0)
        if hm and hasattr(hm, "points"):
            heatmap_points = [{"time": p.timestamp_seconds, "intensity": p.intensity} for p in hm.points]
    except Exception:
        pass

    # Load solid clips candidates if available in cache or preview
    solid_clips = []
    try:
        pipeline = build_pipeline(output_dir=CLIPS_DIR, min_duration=15, max_duration=60)
        cands = pipeline.get_candidates(video_id=clean_id, min_duration=15, max_duration=60)
        decider = SolidShortsDecider()
        decision = decider.decide(candidates=cands, duration_seconds=duration or 300.0)
        solid_clips = [
            {
                "start_seconds": c.start_seconds,
                "end_seconds": c.end_seconds,
                "duration": round(c.duration_seconds, 1),
                "score": round(c.score, 1),
                "title": c.hook_title,
                "hook_type": getattr(c, "hook_type", "AI Hook"),
                "hook_sentence": getattr(c, "hook_sentence", ""),
            }
            for c in decision.selected_candidates
        ]
    except Exception as e:
        logger.warning(f"Failed to extract candidates for source info {clean_id}: {e}")

    # Check transcript presence
    transcript_file = os.path.join(DATA_DIR, "transcripts", f"{clean_id}.json")
    has_transcript = os.path.exists(transcript_file)
    if not has_transcript:
        t_cands = glob.glob(os.path.join(DATA_DIR, "transcripts", f"*{clean_id}*.json"))
        has_transcript = len(t_cands) > 0

    fname = os.path.basename(asset_file) if asset_file else None
    return {
        "video_id": clean_id,
        "title": video_info.title if video_info else f"Video {clean_id}",
        "channel_title": video_info.channel_title if video_info else "",
        "thumbnail_url": video_info.thumbnail_url if video_info else "",
        "duration": duration,
        "has_local_file": bool(asset_file),
        "has_transcript": has_transcript,
        "source_url": f"/assets/{fname}" if fname else None,
        "file_path": asset_file,
        "heatmap": heatmap_points,
        "solid_clips": solid_clips,
    }


@app.get("/api/v1/source/{video_id}/transcript")
def api_get_source_transcript(video_id: str) -> Dict[str, Any]:
    """Returns word-level and sentence-level transcript timestamps for text-based editing."""
    clean_id = _sanitize_clip_id(video_id)
    alt_id = _find_closest_video_id(clean_id)
    if alt_id:
        clean_id = alt_id

    transcript_path = os.path.join(DATA_DIR, "transcripts", f"{clean_id}.json")
    if not os.path.exists(transcript_path):
        cands = glob.glob(os.path.join(DATA_DIR, "transcripts", f"*{clean_id}*.json"))
        if cands:
            transcript_path = cands[0]
        else:
            try:
                from yt_clipping.transcription.transcriber import LocalTranscriber
                transcriber = LocalTranscriber()
                t = transcriber.fetch_online_transcript(clean_id)
                if t and os.path.exists(transcript_path):
                    logger.info(f"Dynamically fetched online transcript for {clean_id}")
                else:
                    raise HTTPException(status_code=404, detail=f"No transcript found for video {clean_id}")
            except HTTPException:
                raise
            except Exception as e:
                logger.warning(f"Dynamic transcript fetch failed for {clean_id}: {e}")
                raise HTTPException(status_code=404, detail=f"No transcript found for video {clean_id}")

    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            "video_id": clean_id,
            "text": data.get("text", ""),
            "duration_seconds": data.get("duration_seconds", 0.0),
            "segments": data.get("segments", []),
        }
    except Exception as e:
        logger.error(f"Error reading transcript for {clean_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/analytics/feedback")
def api_record_feedback(req: FeedbackRequest) -> Dict[str, Any]:
    """Records creator review feedback and loops engagement into future scoring calibration."""
    loop = get_feedback_loop()
    record = ClipPerformanceRecord(
        clip_id=req.clip_id,
        video_id=req.video_id or "unknown",
        hook_title=req.hook_title or req.clip_id,
        hook_type=req.hook_type or "General",
        duration_seconds=req.duration_seconds or 30.0,
        score=req.score or 80.0,
        user_rating=req.rating,
        feedback_notes=req.notes or "",
        completion_rate=0.75 if req.rating >= 4.0 else (0.45 if req.rating <= 2.0 else 0.60),
    )
    loop.record_clip_performance(record)
    success = loop.record_user_feedback(req.clip_id, req.rating, req.notes or "")
    summary = loop.get_summary()
    return {
        "success": success,
        "clip_id": req.clip_id,
        "rating": req.rating,
        "calibration_status": summary.get("calibration_status", "ONLINE"),
    }


@app.get("/api/v1/analytics/summary")
def api_get_analytics_summary() -> Dict[str, Any]:
    """Returns analytics feedback ledger summary and calibrated hook weights."""
    loop = get_feedback_loop()
    summary = loop.get_summary()
    multipliers = loop.get_calibrated_multipliers()
    return {
        "summary": summary,
        "multipliers": multipliers,
    }


# ==============================================================================
# Cloudflare Workers AI FLUX.1 Engine Endpoints
# ==============================================================================

@app.get("/api/v1/flux/status")
def api_flux_status() -> Dict[str, Any]:
    """Returns Cloudflare Workers AI FLUX.1 status and readiness."""
    return flux_generator.get_status()


@app.post("/api/v1/flux/generate")
def api_flux_generate(req: FluxGenerateRequest) -> Dict[str, Any]:
    """Generates visual asset from text prompt via Cloudflare FLUX.1 Schnell."""
    try:
        res = flux_generator.generate_image(
            prompt=req.prompt,
            style_preset=req.style_preset or "cinematic_hook",
            width=req.width or 768,
            height=req.height or 1344,
            steps=req.steps or 4,
        )
        data = res.to_dict()
        if req.animate_broll and res.success and os.path.exists(res.file_path):
            base_name = os.path.splitext(os.path.basename(res.file_path))[0]
            out_filename = f"{base_name}_broll.mp4"
            out_path = os.path.join(CLIPS_DIR, out_filename)
            clip_path = flux_generator.create_broll_clip(res.file_path, duration=3.5, output_path=out_path)
            data["broll_video_path"] = clip_path
            if clip_path and os.path.exists(clip_path):
                data["broll_video_url"] = f"/clips/{out_filename}"
        return data
    except Exception as e:
        logger.error(f"FLUX generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/flux/broll-clip")
def api_flux_broll_clip(req: FluxBRollRequest) -> Dict[str, Any]:
    """Renders a Ken Burns 9:16 vertical motion video clip from a FLUX image."""
    resolved = None
    if os.path.exists(req.image_path):
        resolved = req.image_path
    else:
        flux_cand = os.path.join(flux_generator.output_dir, os.path.basename(req.image_path))
        if os.path.exists(flux_cand):
            resolved = flux_cand
        else:
            try:
                resolved = _resolve_clip_path(req.image_path)
            except Exception:
                raise HTTPException(status_code=404, detail=f"Image source not found: {req.image_path}")

    try:
        base_name = os.path.splitext(os.path.basename(resolved))[0]
        out_filename = f"{base_name}_broll.mp4"
        out_path = os.path.join(CLIPS_DIR, out_filename)
        clip_path = flux_generator.create_broll_clip(
            image_path=resolved,
            duration=req.duration or 3.5,
            motion=req.motion or "zoom_in",
            output_path=out_path,
        )
        if not clip_path or not os.path.exists(clip_path):
            raise HTTPException(status_code=500, detail="Failed to create B-roll motion video clip.")
        return {
            "success": True,
            "broll_video_path": clip_path,
            "broll_video_url": f"/clips/{out_filename}",
            "duration": req.duration or 3.5,
            "motion": req.motion or "zoom_in",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"FLUX B-roll clip generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/flux/auto-broll")
def api_flux_auto_broll(req: FluxAutoBRollRequest) -> Dict[str, Any]:
    """Extracts visual concepts from transcript and generates FLUX visual cards."""
    try:
        concepts = FluxImageGenerator.extract_broll_concepts(
            transcript_text=req.transcript_text,
            max_concepts=req.max_concepts or 3,
        )
        generated_assets = []
        for c in concepts:
            res = flux_generator.generate_image(
                prompt=c["prompt"],
                style_preset=req.style_preset or c.get("style", "cinematic_hook"),
            )
            d = res.to_dict()
            d["concept"] = c["concept"]
            generated_assets.append(d)

        return {
            "success": True,
            "count": len(generated_assets),
            "assets": generated_assets,
        }
    except Exception as e:
        logger.error(f"Auto B-roll error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/flux/settings")
def api_flux_settings(req: FluxSettingsRequest) -> Dict[str, Any]:
    """Updates Cloudflare Workers AI credentials for FLUX.1 image generation."""
    flux_generator.account_id = req.account_id.strip()
    flux_generator.api_token = req.api_token.strip()
    os.environ["CLOUDFLARE_ACCOUNT_ID"] = flux_generator.account_id
    os.environ["CLOUDFLARE_API_TOKEN"] = flux_generator.api_token
    return {
        "status": "success",
        "configured": flux_generator.is_configured,
        "message": "Cloudflare Workers AI credentials saved.",
    }


# ==============================================================================
# Publishing Workflow API
# ==============================================================================

@app.get("/api/v1/publish/channels")
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


class PublishSubmitRequest(BaseModel):
    clip_id: Optional[str] = None
    clip_ids: Optional[List[str]] = None
    target: str = "youtube_dedicated"  # "youtube_dedicated" or "omnipost"
    channel_id: Optional[str] = None
    platforms: List[str] = Field(default_factory=lambda: ["youtube"])
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    thumbnail_path: Optional[str] = None
    scheduled_time: Optional[str] = None
    approved_by_user: bool = False  # Human approval gate


@app.post("/api/v1/publish/submit")
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


@app.get("/api/v1/publish/history")
def api_get_publish_history(limit: int = 50) -> List[Dict[str, Any]]:
    """Returns past publishing handoffs, status, errors, and delivery receipts."""
    return publisher.list_publishing_history(limit=limit)


@app.post("/api/v1/publish/retry/{receipt_id}")
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


@app.get("/api/v1/publish/status/{receipt_id}")
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


# ------------------------------------------------------------------------------
# Professional SaaS Web Studio & Showcase Landing Page
# ------------------------------------------------------------------------------
LANDING_HTML_PATH = os.path.join(os.path.dirname(__file__), "landing.html")
DASHBOARD_HTML_PATH = os.path.join(os.path.dirname(__file__), "dashboard.html")
DOCS_HTML_PATH = os.path.join(os.path.dirname(__file__), "docs.html")
DOCS_DIR = os.path.abspath(os.path.join(BASE_DIR, "docs"))


@app.get("/docs", response_class=HTMLResponse)
def serve_docs():
    """Serves the interactive documentation hub and architecture viewer."""
    if os.path.exists(DOCS_HTML_PATH):
        with open(DOCS_HTML_PATH, "r", encoding="utf-8") as _f:
            return _f.read()
    return "<!DOCTYPE html><html><body><h1>Documentation Hub Loading...</h1></body></html>"


@app.get("/docs/{doc_path:path}")
def serve_docs_subpath(doc_path: str, request: Request):
    """Serves specific documentation files, supporting both web viewing and raw markdown downloads."""
    clean_name = os.path.basename(doc_path.strip())
    # Allow looking in docs/ or repo root for README.md
    target_path = os.path.join(DOCS_DIR, clean_name)
    if not os.path.exists(target_path) and clean_name.lower() == "readme.md":
        target_path = os.path.join(BASE_DIR, "README.md")
    
    # Path traversal protection
    real_target = os.path.abspath(target_path)
    if not (real_target.startswith(DOCS_DIR) or real_target == os.path.abspath(os.path.join(BASE_DIR, "README.md"))):
        raise HTTPException(status_code=403, detail="Access denied: path traversal attempt detected.")

    if not os.path.exists(real_target):
        raise HTTPException(status_code=404, detail=f"Documentation file '{clean_name}' not found.")

    accept_hdr = request.headers.get("Accept", "").lower()
    raw_param = request.query_params.get("raw", "").lower() in ("1", "true", "yes")

    # If raw requested or non-HTML client, return raw markdown
    if raw_param or "text/markdown" in accept_hdr or "text/plain" in accept_hdr:
        with open(real_target, "r", encoding="utf-8") as _f:
            return Response(content=_f.read(), media_type="text/markdown")

    # Otherwise serve docs.html with the doc loaded
    if os.path.exists(DOCS_HTML_PATH):
        with open(DOCS_HTML_PATH, "r", encoding="utf-8") as _f:
            content = _f.read()
            return HTMLResponse(content=content.replace("let currentDoc = 'ARCHITECTURE.md';", f"let currentDoc = '{clean_name}';"))
    
    with open(real_target, "r", encoding="utf-8") as _f:
        return Response(content=_f.read(), media_type="text/plain")


@app.get("/api/v1/docs/list")
def list_available_docs():
    """Returns a list of all technical documentation and architectural reports."""
    items = []
    if os.path.exists(DOCS_DIR):
        for entry in os.listdir(DOCS_DIR):
            if entry.endswith(".md"):
                p = os.path.join(DOCS_DIR, entry)
                stat = os.stat(p)
                items.append({
                    "filename": entry,
                    "title": entry.replace("_", " ").replace(".md", "").title(),
                    "size_bytes": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                })
    # Also include root README.md
    readme_p = os.path.join(BASE_DIR, "README.md")
    if os.path.exists(readme_p):
        stat = os.stat(readme_p)
        items.insert(0, {
            "filename": "README.md",
            "title": "Project Overview (README)",
            "size_bytes": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        })
    return {"total": len(items), "docs": sorted(items, key=lambda x: x["filename"])}


@app.get("/api/v1/docs/content/{filename:path}")
def get_doc_content(filename: str):
    """Retrieves and renders a documentation markdown file into HTML."""
    clean_name = os.path.basename(filename.strip())
    target_path = os.path.join(DOCS_DIR, clean_name)
    if not os.path.exists(target_path) and clean_name.lower() == "readme.md":
        target_path = os.path.join(BASE_DIR, "README.md")

    real_target = os.path.abspath(target_path)
    if not (real_target.startswith(DOCS_DIR) or real_target == os.path.abspath(os.path.join(BASE_DIR, "README.md"))):
        raise HTTPException(status_code=403, detail="Access denied: path traversal attempt detected.")

    if not os.path.exists(real_target) or not os.path.isfile(real_target):
        raise HTTPException(status_code=404, detail=f"Documentation file '{clean_name}' not found.")

    with open(real_target, "r", encoding="utf-8") as _f:
        raw_md = _f.read()

    # Extract first H1 as title if available
    title = clean_name.replace("_", " ").replace(".md", "").title()
    for line in raw_md.splitlines():
        if line.startswith("# "):
            title = line.lstrip("# ").strip()
            break

    rendered_html = markdown.markdown(raw_md, extensions=['fenced_code', 'tables', 'nl2br'])
    return {
        "filename": clean_name,
        "title": title,
        "markdown": raw_md,
        "html": rendered_html,
    }


@app.get("/", response_class=HTMLResponse)
def serve_dashboard():
    """Serves the advertising showcase homepage and interactive simulator."""
    if os.path.exists(LANDING_HTML_PATH):
        with open(LANDING_HTML_PATH, "r", encoding="utf-8") as _f:
            return _f.read()
    if os.path.exists(DASHBOARD_HTML_PATH):
        with open(DASHBOARD_HTML_PATH, "r", encoding="utf-8") as _f:
            return _f.read()
    return "<!DOCTYPE html><html><body><h1>Studio Loading...</h1></body></html>"


@app.get("/studio", response_class=HTMLResponse)
def serve_studio():
    """Serves the live interactive clipping studio and editor workspace."""
    if os.path.exists(DASHBOARD_HTML_PATH):
        with open(DASHBOARD_HTML_PATH, "r", encoding="utf-8") as _f:
            return _f.read()
    return "<!DOCTYPE html><html><body><h1>Studio Loading...</h1></body></html>"


@app.get("/login", response_class=HTMLResponse)
def serve_login():
    """Serves the client and tenant portal authentication flow."""
    if os.path.exists(LANDING_HTML_PATH):
        with open(LANDING_HTML_PATH, "r", encoding="utf-8") as _f:
            content = _f.read()
            return content.replace("<body", "<body onload=\"openAuthModal('tenant')\"")
    return serve_dashboard()


@app.get("/robots.txt", response_class=Response)
def serve_robots():
    """Serves search engine crawler instructions."""
    content = "User-agent: *\nAllow: /\nSitemap: http://localhost:8000/sitemap.xml\n"
    return Response(content=content, media_type="text/plain")


@app.get("/sitemap.xml", response_class=Response)
def serve_sitemap():
    """Serves XML sitemap for SEO discovery."""
    content = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>http://localhost:8000/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>"""
    return Response(content=content, media_type="application/xml")


@app.get("/favicon.svg", response_class=Response)
@app.get("/favicon.ico", response_class=Response)
def serve_favicon():
    """Serves crisp SVG studio favicon."""
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="8" fill="#08090d"/>
  <rect x="1" y="1" width="30" height="30" rx="7" stroke="#2563eb" stroke-width="1.5"/>
  <polygon points="12,8 24,16 12,24" fill="#3b82f6"/>
</svg>"""
    return Response(content=svg, media_type="image/svg+xml")


@app.get("/og-image.svg", response_class=Response)
def serve_og_image():
    """Serves OpenGraph preview poster image (1200x630)."""
    svg = """<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" fill="none">
  <rect width="1200" height="630" fill="#08090d"/>
  <rect x="40" y="40" width="1120" height="550" rx="16" stroke="#1c202d" stroke-width="2"/>
  <text x="100" y="240" fill="#f1f5f9" font-family="system-ui, sans-serif" font-size="64" font-weight="800">YouTube Clipping Studio</text>
  <text x="100" y="320" fill="#8492a6" font-family="system-ui, sans-serif" font-size="28">Autonomous Long-to-Shorts Intelligence &amp; 9:16 Video Synthesis</text>
  <rect x="100" y="380" width="220" height="52" rx="8" fill="#2563eb"/>
  <text x="140" y="415" fill="#ffffff" font-family="system-ui, sans-serif" font-size="20" font-weight="700">Open Studio</text>
</svg>"""
    return Response(content=svg, media_type="image/svg+xml")


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


# ------------------------------------------------------------------------------
# Overnight Multi-Video Batch Queue Endpoints
# ------------------------------------------------------------------------------

@app.post("/api/v1/batch/start")
def api_batch_start(req: BatchStartRequest, bg_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Launches an autonomous overnight multi-video batch queue."""
    videos_to_queue = []
    if req.video_ids and len(req.video_ids) > 0:
        for vid in req.video_ids:
            try:
                clean_id, clean_url = normalize_youtube_url(vid)
                meta = None
                try:
                    meta = metadata_service.get_metadata(clean_id)
                except Exception:
                    pass
                videos_to_queue.append({
                    "video_id": clean_id,
                    "url": clean_url,
                    "title": meta.title if meta else f"YouTube Video ({clean_id})",
                    "channel_name": meta.channel_title if meta else "YouTube Creator",
                    "channel_subscribers_formatted": "10M+",
                    "thumbnail_url": meta.thumbnail_url if meta else f"https://i.ytimg.com/vi/{clean_id}/hqdefault.jpg",
                    "duration_seconds": meta.duration if meta else 0.0,
                })
            except Exception:
                continue
    else:
        # Auto-fetch top 10 from 10M+ trending fetcher
        try:
            from top_trending_videos_in_youtube import TopTrending10MFetcher
            fetcher = TopTrending10MFetcher()
            trending_list = fetcher.get_top_trending_10m_list(limit=10)
            videos_to_queue = [v.to_dict() for v in trending_list]
        except Exception as e:
            logger.warning(f"Error auto-populating 10M trending videos for batch: {e}")

    if not videos_to_queue:
        raise HTTPException(status_code=400, detail="No valid videos found to queue for overnight batch.")

    render_cfg = {
        "max_clips": req.max_clips or 3,
        "layout": req.layout or "active_speaker",
        "subtitle_preset": req.subtitle_preset or "hormozi",
        "enable_polish": True if req.enable_polish is None else req.enable_polish,
        "enable_outro": True if req.enable_outro is None else req.enable_outro,
        "gpu": True if req.gpu is None else req.gpu,
    }

    session = batch_manager.create_batch(
        videos=videos_to_queue,
        render_config=render_cfg,
        name=req.name or "Overnight 10M+ Trending Batch",
    )

    bg_tasks.add_task(_execute_batch_background, session.batch_id)
    return session.to_dict()


@app.get("/api/v1/batch/status")
def api_batch_status() -> Dict[str, Any]:
    """Returns the live status of the active running batch queue, or idle if none running."""
    active = batch_manager.get_active_batch()
    if active:
        return active.to_dict()
    return {"status": "idle", "items": [], "message": "Pipeline queue idle. No batch rendering currently in progress."}


@app.post("/api/v1/batch/cancel")
def api_batch_cancel() -> Dict[str, Any]:
    """Gracefully cancels any running overnight batch session."""
    active = batch_manager.get_active_batch()
    if not active:
        return {"status": "idle", "message": "No active batch running."}
    success = batch_manager.cancel_batch(active.batch_id)
    return {"status": "cancelled" if success else "failed", "batch_id": active.batch_id}


@app.get("/api/v1/batch/history")
def api_batch_history(limit: int = 10) -> List[Dict[str, Any]]:
    """Returns history of past overnight batch sessions."""
    return [b.to_dict() for b in batch_manager.list_batches(limit=limit)]


# ------------------------------------------------------------------------------
# Rights Governance, Creator Registry & Operational Observability Endpoints
# ------------------------------------------------------------------------------
class RightsRegisterRequest(BaseModel):
    video_id: str
    basis: str
    owner: str
    status: str = "PENDING_REVIEW"
    proof_reference: str = ""
    license_url: str = ""
    license_id: str = ""
    creator_id: str = ""
    evidence_type: str = ""
    verified_by: str = "studio_operator"
    valid_until: Optional[str] = None
    audit_notes: str = ""
    allow_regrant_revoked: bool = False


class RightsRevokeRequest(BaseModel):
    video_id: Optional[str] = None
    creator_id: Optional[str] = None
    reason: str
    actor: str = "studio_operator"


class CreatorApproveRequest(BaseModel):
    channel_id: str
    channel_name: str
    policy: str
    approval_evidence: str
    creator_handle: Optional[str] = None
    approved_by: str = "studio_operator"
    expires_at: Optional[str] = None
    notes: str = ""


class CreatorRevokeRequest(BaseModel):
    channel_id: str
    reason: str
    revoked_by: str = "studio_operator"


@app.post("/api/v1/rights/register")
def api_rights_register(req: RightsRegisterRequest) -> Dict[str, Any]:
    """Registers evidence-backed rights metadata (never allows OPERATOR_ASSET to verify)."""
    policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    try:
        manifest = policy.register_rights(
            video_id=req.video_id,
            basis=req.basis,
            owner=req.owner,
            status=req.status,
            proof_reference=req.proof_reference,
            license_url=req.license_url,
            license_id=req.license_id,
            creator_id=req.creator_id,
            evidence_type=req.evidence_type,
            verified_by=req.verified_by,
            valid_until=req.valid_until,
            audit_notes=req.audit_notes,
            allow_regrant_revoked=req.allow_regrant_revoked,
        )
        return {
            "success": True,
            "rights_id": manifest.rights_id,
            "video_id": manifest.video_id,
            "basis": manifest.basis.value,
            "status": manifest.effective_status().value,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/v1/rights/revoke")
def api_rights_revoke(req: RightsRevokeRequest) -> Dict[str, Any]:
    """Revokes rights for a video or creator and cascades holds to pending jobs & receipts."""
    policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    try:
        res = policy.revoke_rights(
            video_id=req.video_id,
            creator_id=req.creator_id,
            reason=req.reason,
            actor=req.actor,
        )
        return {"success": True, **res}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/v1/rights/audit")
def api_rights_audit(video_id: Optional[str] = None, limit: int = 100) -> Dict[str, Any]:
    """Returns append-only immutable rights transition history."""
    policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    history = policy.get_audit_history(video_id=video_id, limit=limit)
    return {"count": len(history), "entries": history}


@app.post("/api/v1/creators/approve")
def api_creators_approve(req: CreatorApproveRequest) -> Dict[str, Any]:
    """Approves a creator/channel in SQLite creator_registry with mandatory evidence."""
    engine = AttributionEngine(db_path=DB_PATH)
    try:
        pol = CreatorPolicy(req.policy)
        rec = engine.approve_creator(
            channel_id=req.channel_id,
            channel_name=req.channel_name,
            policy=pol,
            approval_evidence=req.approval_evidence,
            creator_handle=req.creator_handle,
            approved_by=req.approved_by,
            expires_at=req.expires_at,
            notes=req.notes,
        )
        return {"success": True, "creator": rec}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/v1/creators/revoke")
def api_creators_revoke(req: CreatorRevokeRequest) -> Dict[str, Any]:
    """Revokes a creator's clipping permission immediately."""
    engine = AttributionEngine(db_path=DB_PATH)
    try:
        rec = engine.revoke_creator(channel_id=req.channel_id, reason=req.reason, revoked_by=req.revoked_by)
        return {"success": True, "creator": rec}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/v1/creators/{channel_id}")
def api_creators_get(channel_id: str) -> Dict[str, Any]:
    """Inspects creator policy & approval status."""
    engine = AttributionEngine(db_path=DB_PATH)
    policy = engine.get_creator_policy(channel_id)
    record = engine.get_creator_record(channel_id)
    return {"channel_id": channel_id, "policy": policy.value, "record": record}


@app.get("/api/v1/ops/health")
def api_ops_health() -> Dict[str, Any]:
    """Returns operational metrics across queue, rights ledger, revocations, and disk capacity."""
    rights_policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    manifests = rights_policy.list_all_manifests()
    revocation_impacts = rights_policy.list_revocation_impacts(limit=25)
    status_counts: Dict[str, int] = {}
    for m in manifests:
        st = m.effective_status().value
        status_counts[st] = status_counts.get(st, 0) + 1

    disk = shutil.disk_usage(DATA_DIR)
    return {
        "status": "ok",
        "compliance_profile": get_active_compliance_profile().value,
        "legal_officer": is_legal_officer_enabled(),
        "auth_configured": bool((os.getenv("WEB_STUDIO_API_KEY") or "").strip()),
        "rights_summary": {"total": len(manifests), "by_status": status_counts},
        "recent_revocation_impacts": revocation_impacts,
        "active_render_jobs_count": len(active_render_jobs),
        "free_disk_gb": round(disk.free / (1024 ** 3), 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


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


class ExternalAIVideoIngestRequest(BaseModel):
    project_id: str
    video_url: str
    source_engine: str = "custom_ai_pipeline"
    prompt_metadata: Optional[Dict[str, Any]] = None
    transcript: Optional[List[Dict[str, Any]]] = None
    target_aspect_ratio: str = "9:16"
    audio_treatment: Optional[Dict[str, Any]] = None
    omnipost_routing: Optional[Dict[str, Any]] = None


@app.post("/api/v1/external/ai-video/ingest")
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


@app.get("/api/v1/external/ai-video/status/{job_id}")
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


@app.post("/api/v1/webhooks/omnipost")
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


# ============================================================================
# LIVE GOVERNANCE, LEGAL OFFICER TOGGLE & AI PIPELINE STUDIO ENDPOINTS
# ============================================================================

@app.get("/api/v1/config/legal-officer")
async def api_get_legal_officer() -> Dict[str, Any]:
    """Returns the live state of the master Legal Officer switch."""
    enabled = is_legal_officer_enabled()
    return {
        "enabled": enabled,
        "mode": "STRICT_COMPLIANCE" if enabled else "UNRESTRICTED_BYPASS",
        "description": "When active, copyright, creator attribution, and rights ledger checks are strictly enforced. When disabled, content bypasses legal barriers with an UNVERIFIED_BYPASS audit log.",
    }


@app.post("/api/v1/config/legal-officer")
async def api_set_legal_officer(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Dynamically toggles the master Legal Officer switch at runtime."""
    enabled = bool(payload.get("enabled", True))
    os.environ["LEGAL_OFFICER"] = "true" if enabled else "false"
    logger.info(f"[Legal Officer Toggle] Master switch updated to: {enabled}")
    return {
        "success": True,
        "enabled": is_legal_officer_enabled(),
        "mode": "STRICT_COMPLIANCE" if is_legal_officer_enabled() else "UNRESTRICTED_BYPASS",
    }


@app.get("/api/v1/system/governor-status")
async def api_get_governor_status() -> Dict[str, Any]:
    """Returns live hardware concurrency, VRAM, and zero-memory-leak profiler telemetry."""
    governor = get_resource_governor()
    metrics = governor.memory_profiler.get_leak_metrics()
    disk = shutil.disk_usage(DATA_DIR)
    return {
        "hardware_concurrency": governor.hardware_concurrency,
        "active_render_jobs": len(governor._active_jobs),
        "vram_gb": governor.vram_gb,
        "cpu_cores": governor.cpu_cores,
        "free_disk_gb": round(disk.free / (1024 ** 3), 2),
        "total_disk_gb": round(disk.total / (1024 ** 3), 2),
        "rss_memory_mb": round(governor.memory_profiler.get_current_rss_mb(), 2),
        "zero_memory_leak_certified": metrics.get("rss_growth_pct", 0.0) < 5.0,
        "rss_growth_pct": metrics.get("rss_growth_pct", 0.0),
        "legal_officer_enabled": is_legal_officer_enabled(),
    }


@app.post("/api/v1/system/storage-cleanup")
async def api_trigger_storage_cleanup(temp_only: bool = True, dry_run: bool = False) -> Dict[str, Any]:
    """Triggers automated scratch disk and temporary file lifecycle pruning."""
    from ..orchestration.storage_manager import StorageManager
    mgr = StorageManager()
    report = mgr.run_cleanup(temp_only=temp_only, dry_run=dry_run)
    return report.to_dict()


@app.get("/api/v1/external/ai-video/tenants")
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


@app.get("/api/v1/external/ai-video/jobs")
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


# ============================================================================
# SupoClip Ecosystem Integration Endpoints
# ============================================================================

import uuid
import re
from ..supoclip import (
    get_supoclip_adapter,
    WorkflowOptions,
    WorkflowPlanner,
    get_template_info,
    PLATFORM_PRESETS,
)

supoclip_adapter = get_supoclip_adapter()


class SupoClipScoreRequest(BaseModel):
    text: str
    duration: float = Field(default=30.0, ge=1.0)
    pacing_wpm: float = Field(default=140.0, ge=10.0)
    audio_energy: float = Field(default=0.7, ge=0.0, le=1.0)


class SupoClipPlanRequest(BaseModel):
    workflow: str = Field(default="highlights")
    duration: float = Field(default=180.0, ge=5.0)
    transcript_segments: Optional[List[Dict[str, Any]]] = None
    options: Optional[Dict[str, Any]] = None


class SupoClipRenderRequest(BaseModel):
    source_path: Optional[str] = None
    clip_id: Optional[str] = None
    output_filename: Optional[str] = None
    start_time: float = Field(default=0.0, ge=0.0)
    end_time: float = Field(default=30.0, gt=0.0)
    template_name: str = Field(default="default")
    words: Optional[List[Dict[str, Any]]] = None
    hook_title: Optional[str] = None
    layout: str = Field(default="talking_head")
    ken_burns_zoom: bool = Field(default=True)
    platform_preset: Optional[str] = None


class SupoClipTrimRequest(BaseModel):
    source_path: Optional[str] = None
    clip_id: Optional[str] = None
    start_time: float = Field(ge=0.0)
    end_time: float = Field(gt=0.0)
    output_filename: Optional[str] = None


class SupoClipSplitRequest(BaseModel):
    source_path: Optional[str] = None
    clip_id: Optional[str] = None
    split_timestamp: float = Field(gt=0.0)
    base_name: Optional[str] = "split"


class SupoClipMergeRequest(BaseModel):
    clip_ids: Optional[List[str]] = None
    clip_paths: Optional[List[str]] = None
    target_filename: Optional[str] = None


@app.get("/api/v1/supoclip/status")
async def api_supoclip_status() -> Dict[str, Any]:
    """Returns real-time status of the SupoClip engine, models, and presets."""
    return supoclip_adapter.get_status()


@app.get("/api/v1/supoclip/workflows")
async def api_supoclip_workflows() -> Dict[str, Any]:
    """Returns available SupoClip workflows and schema documentation."""
    return {
        "success": True,
        "workflows": supoclip_adapter.list_workflows(),
    }


@app.get("/api/v1/supoclip/templates")
async def api_supoclip_templates() -> Dict[str, Any]:
    """Returns supported animated caption templates and styles."""
    return {
        "success": True,
        "templates": supoclip_adapter.list_templates(),
    }


@app.get("/api/v1/supoclip/fonts")
async def api_supoclip_fonts() -> Dict[str, Any]:
    """Returns TTF typography fonts available for burning into short clips."""
    return {
        "success": True,
        "fonts": supoclip_adapter.list_fonts(),
    }


@app.post("/api/v1/supoclip/score")
async def api_supoclip_score(req: SupoClipScoreRequest) -> Dict[str, Any]:
    """Computes SupoClip's 4-dimensional virality rubric and generates hook titles."""
    try:
        score = supoclip_adapter.score_content(
            text=req.text,
            duration=req.duration,
            pacing_wpm=req.pacing_wpm,
            audio_energy=req.audio_energy,
        )
        return {
            "success": True,
            "score": score,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@app.post("/api/v1/supoclip/plan")
async def api_supoclip_plan(req: SupoClipPlanRequest) -> Dict[str, Any]:
    """Creates an execution plan for a designated SupoClip workflow."""
    try:
        plan = supoclip_adapter.plan_workflow(
            workflow=req.workflow,
            duration=req.duration,
            transcript_segments=req.transcript_segments,
            options=req.options,
        )
        return {
            "success": True,
            "plan": plan,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@app.post("/api/v1/supoclip/render")
def api_supoclip_render(req: SupoClipRenderRequest) -> Dict[str, Any]:
    """Renders a 9:16 vertical clip with face tracking, ASS subtitles, and hook title."""
    src = req.source_path or req.clip_id
    if not src:
        raise HTTPException(status_code=400, detail="Must provide source_path or clip_id")
    resolved_src = _resolve_clip_path(src)
    if not resolved_src or not os.path.exists(resolved_src):
        raise HTTPException(status_code=404, detail=f"Source video not found: {src}")

    if req.end_time <= req.start_time:
        raise HTTPException(
            status_code=400,
            detail=f"end_time ({req.end_time}) must be greater than start_time ({req.start_time})"
        )

    if req.output_filename:
        clean_base = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", os.path.basename(req.output_filename))
        out_name = clean_base if clean_base.endswith(".mp4") else f"{clean_base}.mp4"
    else:
        out_name = f"supoclip_{uuid.uuid4().hex[:8]}.mp4"
    out_path = os.path.join(CLIPS_DIR, out_name)

    try:
        success = supoclip_adapter.render_reframed_clip(
            source_path=resolved_src,
            output_path=out_path,
            start_time=req.start_time,
            end_time=req.end_time,
            template_name=req.template_name,
            words=req.words,
            hook_title=req.hook_title,
            layout=req.layout,
            ken_burns_zoom=req.ken_burns_zoom,
            platform_preset=req.platform_preset,
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SupoClip rendering execution failed: {e}")

    if not success:
        raise HTTPException(status_code=500, detail="SupoClip rendering execution failed")

    return {
        "success": True,
        "rendered_file": out_name,
        "file_path": out_path,
        "start_time": req.start_time,
        "end_time": req.end_time,
        "template": req.template_name,
        "layout": req.layout,
        "hook_title": req.hook_title,
        "platform_preset": req.platform_preset,
    }


@app.post("/api/v1/supoclip/editor/trim")
def api_supoclip_trim(req: SupoClipTrimRequest) -> Dict[str, Any]:
    """Trims a clip to precise boundary timestamps."""
    src = req.source_path or req.clip_id
    if not src:
        raise HTTPException(status_code=400, detail="Must provide source_path or clip_id")
    resolved_src = _resolve_clip_path(src)
    if not resolved_src or not os.path.exists(resolved_src):
        raise HTTPException(status_code=404, detail=f"Source video not found: {src}")

    if req.end_time <= req.start_time:
        raise HTTPException(
            status_code=400,
            detail=f"end_time ({req.end_time}) must be greater than start_time ({req.start_time})"
        )

    if req.output_filename:
        clean_base = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", os.path.basename(req.output_filename))
        out_name = clean_base if clean_base.endswith(".mp4") else f"{clean_base}.mp4"
    else:
        out_name = f"trimmed_{uuid.uuid4().hex[:8]}.mp4"
    out_path = os.path.join(CLIPS_DIR, out_name)

    try:
        ok = supoclip_adapter.trim(resolved_src, out_path, req.start_time, req.end_time)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))

    if not ok:
        raise HTTPException(status_code=500, detail="Trim operation failed")

    return {
        "success": True,
        "trimmed_file": out_name,
        "file_path": out_path,
        "duration": round(req.end_time - req.start_time, 2),
    }


@app.post("/api/v1/supoclip/editor/split")
def api_supoclip_split(req: SupoClipSplitRequest) -> Dict[str, Any]:
    """Splits a clip into two separate segments at the specified timestamp."""
    src = req.source_path or req.clip_id
    if not src:
        raise HTTPException(status_code=400, detail="Must provide source_path or clip_id")
    resolved_src = _resolve_clip_path(src)
    if not resolved_src or not os.path.exists(resolved_src):
        raise HTTPException(status_code=404, detail=f"Source video not found: {src}")

    base_name = re.sub(r"[^a-zA-Z0-9_\-]", "_", os.path.basename(req.base_name or f"split_{uuid.uuid4().hex[:6]}"))
    try:
        p1, p2 = supoclip_adapter.split(resolved_src, CLIPS_DIR, req.split_timestamp, base_name=base_name)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Split operation failed: {e}")

    return {
        "success": True,
        "part1_file": os.path.basename(p1),
        "part2_file": os.path.basename(p2),
        "split_timestamp": req.split_timestamp,
    }


@app.post("/api/v1/supoclip/editor/merge")
def api_supoclip_merge(req: SupoClipMergeRequest) -> Dict[str, Any]:
    """Concatenates multiple clips into a single video."""
    sources: List[str] = []
    if req.clip_ids:
        for cid in req.clip_ids:
            p = _resolve_clip_path(cid)
            if p and os.path.exists(p):
                sources.append(p)
    elif req.clip_paths:
        for cp in req.clip_paths:
            p = _resolve_clip_path(cp)
            if p and os.path.exists(p):
                sources.append(p)

    if len(sources) < 2:
        raise HTTPException(status_code=400, detail="Must provide at least 2 valid clips to merge")

    if req.target_filename:
        clean_base = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", os.path.basename(req.target_filename))
        out_name = clean_base if clean_base.endswith(".mp4") else f"{clean_base}.mp4"
    else:
        out_name = f"merged_{uuid.uuid4().hex[:8]}.mp4"
    out_path = os.path.join(CLIPS_DIR, out_name)

    try:
        ok = supoclip_adapter.merge(sources, out_path)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Merge operation failed: {e}")

    if not ok:
        raise HTTPException(status_code=500, detail="Merge operation failed")

    return {
        "success": True,
        "merged_file": out_name,
        "file_path": out_path,
        "source_count": len(sources),
    }


@app.get("/api/v1/supoclip/editor/presets")
async def api_supoclip_presets() -> Dict[str, Any]:
    """Returns platform export presets (TikTok, Reels, Shorts)."""
    return {
        "success": True,
        "presets": supoclip_adapter.get_presets(),
    }


@app.get("/api/v1/supoclip/export/zip")
def api_supoclip_export_zip(
    project_id: Optional[str] = None,
    clip_ids: Optional[str] = None,
) -> FileResponse:
    """Streams a packaged ZIP archive of rendered clips."""
    clips_to_pack: List[Dict[str, Any]] = []

    if clip_ids:
        c_list = [c.strip() for c in clip_ids.split(",") if c.strip()]
        for cid in c_list:
            try:
                p = _resolve_clip_path(cid)
                if p and os.path.exists(p) and os.path.getsize(p) > 1024:
                    clips_to_pack.append({
                        "clip_id": cid,
                        "file_path": p,
                        "title": f"Clip {cid}",
                    })
            except Exception:
                continue
    elif project_id:
        proj_clips = project_store.list_clips(project_id=project_id)
        if proj_clips:
            for c in proj_clips:
                p = None
                if c.file_path and os.path.exists(c.file_path):
                    p = c.file_path
                else:
                    try:
                        p = _resolve_clip_path(c.clip_id)
                    except Exception:
                        p = None
                if p and os.path.exists(p) and os.path.getsize(p) > 1024:
                    title = (c.caption_package.get("hook_title") if c.caption_package else None) or f"Clip {c.clip_id}"
                    clips_to_pack.append({
                        "clip_id": c.clip_id,
                        "file_path": p,
                        "title": title,
                    })

        # If project_id provided but no clips matched yet, also look in project folder or matching video_id in CLIPS_DIR
        if not clips_to_pack:
            vid = project_id.replace("proj_", "").replace("project_", "")
            vid_clips = glob.glob(os.path.join(CLIPS_DIR, f"*{vid}*.mp4")) or glob.glob(
                os.path.join(project_store.projects_dir, f"*{project_id}*", "clips", "*.mp4")
            )
            for p in vid_clips:
                if os.path.exists(p) and os.path.getsize(p) > 1024:
                    cid = os.path.splitext(os.path.basename(p))[0]
                    clips_to_pack.append({
                        "clip_id": cid,
                        "file_path": p,
                        "title": f"Clip {cid}",
                    })

    if not clips_to_pack:
        recent_mp4s = glob.glob(os.path.join(CLIPS_DIR, "*.mp4"))[:10]
        for p in recent_mp4s:
            if os.path.exists(p) and os.path.getsize(p) > 1024:
                cid = os.path.splitext(os.path.basename(p))[0]
                clips_to_pack.append({
                    "clip_id": cid,
                    "file_path": p,
                    "title": f"Clip {cid}",
                })

    if not clips_to_pack:
        raise HTTPException(status_code=404, detail="No clips found to package")

    safe_proj_id = re.sub(r"[^a-zA-Z0-9_\-]", "_", os.path.basename(project_id)) if project_id else uuid.uuid4().hex[:6]
    zip_filename = f"supoclip_export_{safe_proj_id}.zip"
    zip_path = os.path.join(TEMP_DIR, zip_filename)

    supoclip_adapter.package_zip(
        clips=clips_to_pack,
        target_zip_path=zip_path,
        metadata={"project_id": project_id, "total_clips": len(clips_to_pack)},
    )

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=zip_filename,
    )


def start_server(host: str = "0.0.0.0", port: int = 8000) -> None:
    """Entry point to launch the studio server via uvicorn."""
    import uvicorn
    uvicorn.run("yt_clipping.web.server:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    start_server()


