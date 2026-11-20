"""
Cloudflare FLUX.1 AI image generation, automated B-roll, and settings router.
"""

from __future__ import annotations
from typing import Dict, Any
import os
import logging

from fastapi import APIRouter, HTTPException

from ...rendering.flux_generator import FluxImageGenerator
from ..schemas import (
    FluxGenerateRequest,
    FluxBRollRequest,
    FluxAutoBRollRequest,
    FluxSettingsRequest,
)
from ..state import (
    CLIPS_DIR,
    flux_generator,
    _resolve_clip_path,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["FLUX"])


@router.get("/api/v1/flux/status")
def api_flux_status() -> Dict[str, Any]:
    """Returns Cloudflare Workers AI FLUX.1 status and readiness."""
    return flux_generator.get_status()


@router.post("/api/v1/flux/generate")
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


@router.post("/api/v1/flux/broll-clip")
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


@router.post("/api/v1/flux/auto-broll")
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


@router.post("/api/v1/flux/settings")
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
