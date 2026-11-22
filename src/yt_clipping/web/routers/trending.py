"""
Trending discovery, Google Trends momentum, and Stream-to-Clipper automated pipeline router.
"""

from __future__ import annotations
from typing import List, Dict, Optional, Any
import os
import sys
import logging
import asyncio
from dataclasses import asdict
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, BackgroundTasks

from ...discovery.video_metadata import normalize_youtube_url
from ...rights.gate import LocalRightsPolicy
from ...discovery.attribution_engine import AttributionEngine, validate_attribution_package
from ...contracts.models import (
    RenderedClip,
    HighlightCandidate,
    ScoreBreakdown,
)
from ...contracts.interfaces import RightsPolicyViolationError
from ...qa.verifier import MediaQualityVerifier
from ...orchestration.job_manager import RenderJobStatus
from ...orchestration.resource_manager import ResourceManager
from ..schemas import StreamToClipperRequest
from ..state import (
    DATA_DIR,
    DB_PATH,
    job_manager,
    project_store,
    publisher,
    active_render_jobs,
    get_active_compliance_profile,
    _prune_active_render_jobs,
    _compute_file_sha256,
)
from .video import _render_video_pipeline

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Trending"])

# High-speed in-memory TTL cache for viral trending and breakout topics (15-min TTL)
_TOP10M_CACHE: Dict[str, Dict[str, Any]] = {}
_TOPICS_CACHE: Dict[str, Dict[str, Any]] = {}
_CACHE_TTL_SECONDS = 900.0  # 15 minutes


def _get_curated_10m_fallback(limit: int = 15) -> List[Dict[str, Any]]:
    """Instantaneous zero-latency curated Top 10M video fallback."""
    try:
        from top_trending_videos_in_youtube import TopTrending10MFetcher
        fb = TopTrending10MFetcher()._get_fallback_10m_videos()
        return [v.to_dict() for v in fb[:limit]]
    except Exception:
        return []


def _get_topics_fallback(limit: int = 15) -> List[Dict[str, Any]]:
    """Instantaneous zero-latency trending topics fallback."""
    try:
        from ...discovery.trends import GoogleTrendsEngine
        # Check SQLite L2 first
        from ...discovery.trends import trends_engine
        l2 = trends_engine._get_l2("daily_trends_US")
        if l2 and isinstance(l2, list):
            return l2[:limit]
    except Exception:
        pass
    fallback_titles = [
        ("f1 vote", "500+"),
        ("gta 6 gameplay", "250K+"),
        ("ai video generators", "100K+"),
        ("mrbeast challenge", "1M+"),
        ("apple event", "200K+"),
        ("spacex starship launch", "150K+"),
        ("minecraft update", "80K+"),
        ("premier league highlights", "300K+"),
    ]
    return [
        {
            "title": t,
            "traffic_approx": tr,
            "pub_date": "",
            "news_titles": [],
            "source": "curated_fallback",
        }
        for t, tr in fallback_titles[:limit]
    ]


@router.get("/api/v1/trending/top10m")
async def api_get_top10m_trending(limit: int = 15, filter_mode: Optional[str] = None) -> List[Dict[str, Any]]:
    """Returns curated and live trending videos from channels with > 10M subscribers with sub-millisecond caching."""
    import time
    now = time.time()
    cache_key = f"{limit}:{filter_mode or 'all'}"
    
    # 1. Exact cache match
    cached = _TOP10M_CACHE.get(cache_key)
    if cached and (now - cached["timestamp"] < _CACHE_TTL_SECONDS):
        return cached["data"]

    # 2. Slice from any existing larger cache entry
    mode_suffix = f":{filter_mode or 'all'}"
    for k, v in _TOP10M_CACHE.items():
        if k.endswith(mode_suffix) and (now - v["timestamp"] < _CACHE_TTL_SECONDS):
            if len(v.get("data", [])) >= limit:
                return v["data"][:limit]

    # 3. Fetch live in worker thread with instant fallback if taking > 800ms
    try:
        from top_trending_videos_in_youtube import TopTrending10MFetcher
        fetcher = TopTrending10MFetcher()
        videos = await asyncio.wait_for(
            asyncio.to_thread(fetcher.get_top_trending_10m_list, limit=limit, filter_mode=filter_mode),
            timeout=2.0
        )
        res = [v.to_dict() for v in videos]
        if res:
            _TOP10M_CACHE[cache_key] = {"timestamp": now, "data": res}
        return res
    except Exception as e:
        logger.warning(f"Error or timeout fetching 10M trending videos: {e}")
        if cached:
            return cached["data"]
        # Instant fallback to high-yield curated list
        fb = _get_curated_10m_fallback(limit)
        if fb:
            _TOP10M_CACHE[cache_key] = {"timestamp": now, "data": fb}
        return fb


@router.get("/api/v1/trending/topics")
async def api_get_trending_topics(geo: str = "US", limit: int = 15) -> List[Dict[str, Any]]:
    """Returns real-time breakout search trends from Google Trends & YouTube with sub-millisecond caching."""
    import time
    now = time.time()
    cache_key = f"{geo}:{limit}"
    
    # 1. Exact cache hit
    cached = _TOPICS_CACHE.get(cache_key)
    if cached and (now - cached["timestamp"] < _CACHE_TTL_SECONDS):
        return cached["data"]

    # 2. Slice from any larger cache hit for the same geo
    for k, v in _TOPICS_CACHE.items():
        if k.startswith(f"{geo}:") and (now - v["timestamp"] < _CACHE_TTL_SECONDS):
            if len(v.get("data", [])) >= limit:
                return v["data"][:limit]

    from ...discovery.trends import trends_engine
    try:
        topics = await asyncio.wait_for(
            asyncio.to_thread(trends_engine.fetch_daily_trending, geo=geo, limit=limit),
            timeout=1.5
        )
        res = [
            {
                "title": t.title,
                "traffic_approx": t.traffic_approx,
                "pub_date": t.pub_date,
                "news_titles": t.news_titles,
                "source": t.source,
            }
            for t in topics
        ]
        if res:
            _TOPICS_CACHE[cache_key] = {"timestamp": now, "data": res}
        return res
    except Exception as e:
        logger.warning(f"Error or timeout fetching trending topics: {e}")
        if cached:
            return cached["data"]
        fb = _get_topics_fallback(limit)
        if fb:
            _TOPICS_CACHE[cache_key] = {"timestamp": now, "data": fb}
        return fb


@router.get("/api/v1/trending/suggest")
async def api_get_trending_suggestions(q: str, limit: int = 10) -> Dict[str, Any]:
    """Returns real-time YouTube search autocomplete suggestions and breakout momentum score."""
    from ...discovery.trends import trends_engine
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


@router.post("/api/v1/trending/stream-to-clipper")
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

    def _dispatch_stream_worker(tid: str, r: StreamToClipperRequest, vid: str) -> None:
        server_mod = sys.modules.get("yt_clipping.web.server")
        worker = getattr(server_mod, "_run_stream_to_clipper_worker", _run_stream_to_clipper_worker) if server_mod else _run_stream_to_clipper_worker
        worker(tid, r, vid)

    bg_tasks.add_task(_dispatch_stream_worker, task_id, req, video_id)
    return {
        "success": True,
        "task_id": task_id,
        "job_id": task_id,
        "video_id": video_id,
        "status": "QUEUED",
        "message": "StreamToClipper workflow initiated! Automated clipping and publishing underway.",
        "check_status_url": f"/api/v1/jobs/{task_id}",
    }
