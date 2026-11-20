"""
Autonomous overnight multi-video batch queue processing and status router.
"""

from __future__ import annotations
from typing import List, Dict, Any, Callable
import sys
import logging

from fastapi import APIRouter, HTTPException, BackgroundTasks

from ...discovery.video_metadata import normalize_youtube_url
from ..schemas import BatchStartRequest
from ..state import (
    metadata_service,
    batch_manager,
)
from .video import _render_video_pipeline

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Batch"])


def _execute_batch_background(batch_id: str) -> None:
    """Worker entry point for overnight batch execution."""
    def _render_wrapper(vid: str, cfg: Dict[str, Any], progress_cb: Callable[[int, str], None]) -> List[Dict[str, Any]]:
        server_mod = sys.modules.get("yt_clipping.web.server")
        pipeline_fn = getattr(server_mod, "_render_video_pipeline", _render_video_pipeline) if server_mod else _render_video_pipeline
        return pipeline_fn(vid, cfg, progress_cb)

    batch_manager.run_batch_worker(batch_id, _render_wrapper)


@router.post("/api/v1/batch/start")
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

    def _dispatch_batch_background(bid: str) -> None:
        server_mod = sys.modules.get("yt_clipping.web.server")
        worker = getattr(server_mod, "_execute_batch_background", _execute_batch_background) if server_mod else _execute_batch_background
        worker(bid)

    bg_tasks.add_task(_dispatch_batch_background, session.batch_id)
    return session.to_dict()


@router.get("/api/v1/batch/status")
def api_batch_status() -> Dict[str, Any]:
    """Returns the live status of the active running batch queue, or idle if none running."""
    active = batch_manager.get_active_batch()
    if active:
        return active.to_dict()
    return {"status": "idle", "items": [], "message": "Pipeline queue idle. No batch rendering currently in progress."}


@router.post("/api/v1/batch/cancel")
def api_batch_cancel() -> Dict[str, Any]:
    """Gracefully cancels any running overnight batch session."""
    active = batch_manager.get_active_batch()
    if not active:
        return {"status": "idle", "message": "No active batch running."}
    success = batch_manager.cancel_batch(active.batch_id)
    return {"status": "cancelled" if success else "failed", "batch_id": active.batch_id}


@router.get("/api/v1/batch/history")
def api_batch_history(limit: int = 10) -> List[Dict[str, Any]]:
    """Returns history of past overnight batch sessions."""
    return [b.to_dict() for b in batch_manager.list_batches(limit=limit)]
