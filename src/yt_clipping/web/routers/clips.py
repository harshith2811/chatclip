"""
Clip management, media streaming, downloads, posters, projects, and settings router.
"""

from __future__ import annotations
from typing import List, Dict, Optional, Any
import os
import glob
import shutil

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, RedirectResponse

from ...contracts.models import HighlightCandidate, ScoreBreakdown, ComplianceProfile
from ...discovery.video_metadata import EnrichedVideoInfo
from ..streaming import stream_video_with_range
from ..state import (
    BASE_DIR,
    DATA_DIR,
    CLIPS_DIR,
    ASSETS_DIR,
    project_store,
    caption_synthesizer,
    flux_generator,
    STUDIO_SETTINGS,
    _sanitize_clip_id,
    _assert_path_in_data_dir,
)

router = APIRouter(tags=["Clips"])


@router.get("/api/v1/clips")
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


@router.post("/api/v1/clips/{clip_id}/regenerate_caption")
def api_regenerate_clip_caption(clip_id: str) -> Dict[str, Any]:
    """Regenerates AI caption package and intelligence for an existing clip sidecar."""
    clean_id = _sanitize_clip_id(clip_id)
    sidecar = project_store.get_clip_sidecar(clean_id)
    if not sidecar:
        raise HTTPException(status_code=404, detail="Clip ID not found.")

    cand_data = sidecar.candidate_data or {}
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


@router.get("/api/v1/clips/{clip_id}")
def api_get_clip(clip_id: str) -> Dict[str, Any]:
    """Returns detailed sidecar record for a specific clip."""
    clean_id = _sanitize_clip_id(clip_id)
    sidecar = project_store.get_clip_sidecar(clean_id)
    if not sidecar:
        raise HTTPException(status_code=404, detail="Clip ID not found.")
    return sidecar.to_dict()


@router.get("/api/v1/clips/{clip_id}/download")
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


@router.get("/api/v1/clips/{clip_id}/media")
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


@router.get("/api/v1/clips/{clip_id}/stream")
def api_stream_clip_stream_alias(clip_id: str, request: Request) -> Response:
    """Streams video with HTTP Range request support (alias for HTML5 video player)."""
    return api_stream_clip_media(clip_id, request)


@router.get("/api/v1/clips/{clip_id}/poster")
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


@router.get("/api/v1/projects")
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


@router.get("/api/v1/projects/{project_id}")
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


@router.delete("/api/v1/projects/{project_id}")
def api_delete_project(project_id: str) -> Dict[str, Any]:
    """Deletes a project folder and its associated files."""
    clean_id = os.path.basename(project_id.strip()).replace("/", "").replace("\\", "")
    pdir = project_store.get_project_dir(clean_id)
    if os.path.exists(pdir):
        shutil.rmtree(pdir, ignore_errors=True)
        return {"status": "deleted", "project_id": clean_id}
    raise HTTPException(status_code=404, detail="Project not found.")


@router.get("/api/v1/settings")
def api_get_settings() -> Dict[str, Any]:
    """Returns current studio configuration."""
    return {k: v for k, v in STUDIO_SETTINGS.items() if "key" not in k.lower() and "token" not in k.lower()}


@router.post("/api/v1/settings")
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
