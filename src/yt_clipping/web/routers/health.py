"""
Health checks, ops status, governor status, and storage cleanup router.
"""

from __future__ import annotations
from typing import Dict, Any
import os
import glob
import shutil
from datetime import datetime, timezone

from fastapi import APIRouter

from ...config import is_legal_officer_enabled
from ...rights.gate import LocalRightsPolicy
from ...orchestration.resource_governor import get_resource_governor
from ..state import (
    BASE_DIR,
    DATA_DIR,
    CLIPS_DIR,
    PROJECTS_DIR,
    DB_PATH,
    caption_synthesizer,
    get_active_compliance_profile,
    active_render_jobs,
)

router = APIRouter(tags=["Health"])


@router.get("/api/v1/health")
@router.get("/api/v1/system/health")
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


@router.get("/api/v1/ops/health")
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


@router.get("/api/v1/system/governor-status")
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


@router.post("/api/v1/system/storage-cleanup")
async def api_trigger_storage_cleanup(temp_only: bool = True, dry_run: bool = False) -> Dict[str, Any]:
    """Triggers automated scratch disk and temporary file lifecycle pruning."""
    from ...orchestration.storage_manager import StorageManager
    mgr = StorageManager()
    report = mgr.run_cleanup(temp_only=temp_only, dry_run=dry_run)
    return report.to_dict()
