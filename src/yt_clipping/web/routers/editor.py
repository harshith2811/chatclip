"""
Video editor previews, timeline waveform, frame export, poster capture, and analytics feedback router.
"""

from __future__ import annotations
from typing import Dict, Any
import os
import shutil
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ...detection.audio_energy import extract_pcm_from_file
from ...analytics.feedback_loop import get_feedback_loop, ClipPerformanceRecord
from ..schemas import (
    EditorFrameRequest,
    EditorExportRequest,
    SavePosterRequest,
    FeedbackRequest,
)
from ..state import (
    CLIPS_DIR,
    project_store,
    video_editor,
    _resolve_clip_path,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Editor"])


@router.post("/api/v1/editor/preview-frame")
def api_editor_preview_frame(req: EditorFrameRequest):
    """Generates an image frame at specified timestamp for interactive scrubbing."""
    resolved_path = _resolve_clip_path(req.file_path)
    try:
        frame_path = video_editor.extract_frame_preview(resolved_path, req.timestamp)
        return FileResponse(frame_path, media_type="image/jpeg")
    except Exception as e:
        logger.error(f"Frame preview failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/v1/editor/export")
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


@router.post("/api/v1/editor/waveform")
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


@router.post("/api/v1/editor/save-poster")
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


@router.post("/api/v1/analytics/feedback")
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


@router.get("/api/v1/analytics/summary")
def api_get_analytics_summary() -> Dict[str, Any]:
    """Returns analytics feedback ledger summary and calibrated hook weights."""
    loop = get_feedback_loop()
    summary = loop.get_summary()
    multipliers = loop.get_calibrated_multipliers()
    return {
        "summary": summary,
        "multipliers": multipliers,
    }
