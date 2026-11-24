"""
Video metadata, candidate preview, vertical Short rendering, job management, and source video router.
"""

from __future__ import annotations
from typing import List, Dict, Optional, Any, Callable
import os
import sys
import glob
import json
import logging
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse

from ...discovery.video_metadata import normalize_youtube_url
from ...rights.gate import LocalRightsPolicy
from ...contracts.models import RenderProfile
from ...contracts.interfaces import RightsPolicyViolationError
from ...cli.commands.pipeline import build_pipeline
from ...detection.solid_shorts import SolidShortsDecider
from ...scoring.caption_synthesizer import ClipIntelligence
from ...qa.verifier import validate_rendered_short
from ...orchestration.job_manager import RenderJobStatus
from ...orchestration.resource_manager import ResourceManager
from ...orchestration.project_store import ClipSidecarRecord
from ..schemas import MetadataRequest, PreviewRequest, RenderRequest
from ..state import (
    DATA_DIR,
    CLIPS_DIR,
    ASSETS_DIR,
    DB_PATH,
    metadata_service,
    caption_synthesizer,
    project_store,
    job_manager,
    video_editor,
    active_render_jobs,
    get_active_compliance_profile,
    _prune_active_render_jobs,
    _sanitize_clip_id,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Video"])


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


@router.post("/api/v1/metadata")
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


@router.post("/api/v1/preview")
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
    cache_file = os.path.join(
        preview_cache_dir,
        f"{video_id}_{int(req.min_duration)}_{int(req.max_duration)}_{req.max_clips}.json",
    )
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
    from ...discovery.trends import trends_engine
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
        target_count=req.max_clips,
        strict_quality=True,
        trend_alignments=trend_alignments,
        fill_to_target=True,
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
        "requested_clips_count": req.max_clips,
        "selection_shortfall": max(0, req.max_clips - decision.recommended_count),
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


def _get_server_attr(attr_name: str, default: Any = None) -> Any:
    for mod_name in ("src.yt_clipping.web.server", "yt_clipping.web.server"):
        mod = sys.modules.get(mod_name)
        if mod and hasattr(mod, attr_name):
            val = getattr(mod, attr_name)
            if val is not default:
                return val
    return default


def _render_video_pipeline(
    video_id: str,
    config: Dict[str, Any],
    progress_cb: Optional[Callable[[int, str], None]] = None,
) -> List[Dict[str, Any]]:
    """Core rendering routine used by single job rendering and overnight batch runs."""
    if progress_cb:
        progress_cb(15, "Resolving metadata & verifying content rights...")

    meta_svc = _get_server_attr("metadata_service", metadata_service)
    proj_store = _get_server_attr("project_store", project_store)
    rights_policy_cls = _get_server_attr("LocalRightsPolicy", LocalRightsPolicy)
    build_pipe_fn = _get_server_attr("build_pipeline", build_pipeline)
    qa_validator = _get_server_attr("validate_rendered_short", validate_rendered_short)

    video_info = None
    try:
        video_info = meta_svc.get_metadata(video_id)
    except Exception:
        pass

    project = proj_store.create_or_get_project(video_id, source_metadata=video_info)

    policy = rights_policy_cls(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    manifest = policy.assert_can_process(
        video_id,
        stage="studio_render_pipeline",
        profile=get_active_compliance_profile(),
    )

    max_clips = max(1, min(24, int(config.get("max_clips", 8))))
    layout = config.get("layout", "active_speaker")
    subtitle_preset = config.get("subtitle_preset", "hormozi")
    enable_outro = config.get("enable_outro", True)
    enable_polish = config.get("enable_polish", True)
    gpu = config.get("gpu", True)
    outro_channel = config.get("outro_channel_name") or (video_info.channel_title if video_info else None)

    if progress_cb:
        progress_cb(40, f"Rendering top {max_clips} vertical Shorts with FFmpeg & face tracking...")

    pipeline = build_pipe_fn(output_dir=CLIPS_DIR)
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
        selected_candidate_ids=config.get("selected_candidate_ids"),
        fill_to_target=bool(config.get("fill_to_target", True)),
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
            qa_result = qa_validator(
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
        server_mod = sys.modules.get("yt_clipping.web.server")
        pipeline_fn = getattr(server_mod, "_render_video_pipeline", _render_video_pipeline) if server_mod else _render_video_pipeline
        with slot_ctx:
            clips_out = pipeline_fn(video_id, cfg, sub_progress)
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


@router.post("/api/v1/render")
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

    def _dispatch_render_worker(tid: str, r: RenderRequest, vid: str) -> None:
        server_mod = sys.modules.get("yt_clipping.web.server")
        worker = getattr(server_mod, "_run_render_worker", _run_render_worker) if server_mod else _run_render_worker
        worker(tid, r, vid)

    bg_tasks.add_task(_dispatch_render_worker, task_id, req, video_id)
    return {
        "task_id": task_id,
        "job_id": task_id,
        "status": "QUEUED",
        "requested_clips": req.max_clips,
        "check_status_url": f"/api/v1/jobs/{task_id}",
    }


@router.get("/api/v1/render/status/{task_id}")
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


@router.get("/api/v1/jobs/{job_id}")
def api_get_job(job_id: str) -> Dict[str, Any]:
    """Retrieves full job status and outputs."""
    job = job_manager.get_job(job_id)
    if not job:
        # Check active_render_jobs fallback
        if job_id in active_render_jobs:
            return active_render_jobs[job_id]
        raise HTTPException(status_code=404, detail="Job ID not found.")
    return job.to_dict()


@router.post("/api/v1/jobs/{job_id}/cancel")
def api_cancel_job(job_id: str) -> Dict[str, Any]:
    """Cancels a queued or in-progress rendering job."""
    success = job_manager.cancel_job(job_id)
    if not success:
        raise HTTPException(status_code=400, detail="Job cannot be cancelled (already completed or not found).")
    if job_id in active_render_jobs:
        active_render_jobs[job_id]["status"] = "CANCELLED"
    return {"job_id": job_id, "status": "cancelled", "message": "Job cancellation signaled successfully."}


@router.get("/api/v1/jobs/{job_id}/stream")
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


@router.get("/api/v1/source/{video_id}")
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


@router.get("/api/v1/source/{video_id}/transcript")
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
                from ...transcription.transcriber import LocalTranscriber
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
