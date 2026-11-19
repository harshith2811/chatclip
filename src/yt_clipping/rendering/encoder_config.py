"""
Centralized Hardware & Software Video Encoder Configuration.
Resolves and standardizes codec-specific flags across all rendering stages:
- Renderer (master 9:16 vertical render)
- B-Roll Engine (alpha-faded stock footage overlay)
- Outro Card (animated branded subscribe card concatenation)

Eliminates invalid encoder options (e.g. passing x264 -crf to h264_nvenc).
Provides cached encoder availability probing and seamless CPU fallback.
"""

from typing import List, Optional, Tuple, Dict, Any
import subprocess
import logging
import os
import functools

logger = logging.getLogger(__name__)

# Cache of verified working encoders
_PROBED_ENCODERS: Dict[str, bool] = {}


def is_nvenc(vcodec: str) -> bool:
    """Checks if the video codec is an NVIDIA hardware encoder."""
    return "nvenc" in (vcodec or "").lower()


def get_encoder_args(
    vcodec: str,
    quality: int = 18,
    preset: Optional[str] = None,
    pixel_format: str = "yuv420p",
    crf: Optional[int] = None,
) -> List[str]:
    """
    Returns valid FFmpeg command arguments for the specified video encoder.
    Guarantees no invalid flags (e.g. -crf is never passed to NVENC).
    Accepts both quality and crf keyword arguments.
    """
    eff_quality = crf if crf is not None else quality
    codec = (vcodec or "libx264").lower()

    if is_nvenc(codec):
        # NVENC uses -cq for constant quality rate control, -preset p1-p7 or medium/fast
        # p4 is optimal balance between speed and quality on Turing / Ampere / Ada
        eff_preset = preset or "p4"
        return [
            "-c:v", vcodec,
            "-preset", eff_preset,
            "-cq", str(eff_quality),
            "-pix_fmt", pixel_format,
        ]
    elif "libx264" in codec or "libx265" in codec:
        eff_preset = preset or "fast"
        return [
            "-c:v", vcodec,
            "-preset", eff_preset,
            "-crf", str(eff_quality),
            "-pix_fmt", pixel_format,
        ]
    else:
        # Generic encoder fallback
        args = ["-c:v", vcodec, "-pix_fmt", pixel_format]
        if preset:
            args.extend(["-preset", preset])
        return args


def probe_encoder_operational(vcodec: str) -> bool:
    """
    Verifies whether a given video encoder can actually encode a test frame on this system.
    Caches results to prevent repeated subprocess calls.
    """
    if vcodec in _PROBED_ENCODERS:
        return _PROBED_ENCODERS[vcodec]

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1:r=30",
        *get_encoder_args(vcodec, quality=28),
        "-f", "null", "-",
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        success = (res.returncode == 0)
    except Exception:
        success = False

    _PROBED_ENCODERS[vcodec] = success
    if not success and is_nvenc(vcodec):
        logger.warning(f"Hardware encoder '{vcodec}' is not operational on this system. Falling back to libx264.")
    return success


def resolve_effective_encoder(requested_vcodec: str = "h264_nvenc") -> str:
    """
    Resolves the best operational encoder. If requested is NVENC and hardware fails,
    returns 'libx264'.
    """
    if is_nvenc(requested_vcodec):
        if probe_encoder_operational(requested_vcodec):
            return requested_vcodec
        return "libx264"

    return requested_vcodec
