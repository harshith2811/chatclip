"""
SupoClip scoring, planning, reframing, manual editing (trim, split, merge), presets, and zip export router.
"""

from __future__ import annotations
from typing import List, Dict, Optional, Any
import os
import re
import glob
import uuid
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..schemas import (
    SupoClipScoreRequest,
    SupoClipPlanRequest,
    SupoClipRenderRequest,
    SupoClipTrimRequest,
    SupoClipSplitRequest,
    SupoClipMergeRequest,
)
from ..state import (
    CLIPS_DIR,
    TEMP_DIR,
    project_store,
    supoclip_adapter,
    _resolve_clip_path,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["SupoClip"])


@router.get("/api/v1/supoclip/status")
async def api_supoclip_status() -> Dict[str, Any]:
    """Returns real-time status of the SupoClip engine, models, and presets."""
    return supoclip_adapter.get_status()


@router.get("/api/v1/supoclip/workflows")
async def api_supoclip_workflows() -> Dict[str, Any]:
    """Returns available SupoClip workflows and schema documentation."""
    return {
        "success": True,
        "workflows": supoclip_adapter.list_workflows(),
    }


@router.get("/api/v1/supoclip/templates")
async def api_supoclip_templates() -> Dict[str, Any]:
    """Returns supported animated caption templates and styles."""
    return {
        "success": True,
        "templates": supoclip_adapter.list_templates(),
    }


@router.get("/api/v1/supoclip/fonts")
async def api_supoclip_fonts() -> Dict[str, Any]:
    """Returns TTF typography fonts available for burning into short clips."""
    return {
        "success": True,
        "fonts": supoclip_adapter.list_fonts(),
    }


@router.post("/api/v1/supoclip/score")
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


@router.post("/api/v1/supoclip/plan")
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


@router.post("/api/v1/supoclip/render")
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


@router.post("/api/v1/supoclip/editor/trim")
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


@router.post("/api/v1/supoclip/editor/split")
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


@router.post("/api/v1/supoclip/editor/merge")
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


@router.get("/api/v1/supoclip/editor/presets")
async def api_supoclip_presets() -> Dict[str, Any]:
    """Returns platform export presets (TikTok, Reels, Shorts)."""
    return {
        "success": True,
        "presets": supoclip_adapter.get_presets(),
    }


@router.get("/api/v1/supoclip/export/zip")
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
