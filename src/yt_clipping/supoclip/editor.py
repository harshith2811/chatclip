"""
SupoClip-inspired Non-Linear Clip Editor and Export Engine.
Provides:
- Trim clip to new start/end boundary
- Split clip at timestamp into two sub-clips
- Merge/stitch multiple clips into one
- Platform presets (TikTok, Instagram Reels, YouTube Shorts)
- On-the-fly streaming ZIP packaging
"""

from __future__ import annotations
from typing import Dict, Any, List, Optional, Tuple
import os
import re
import json
import zipfile
import subprocess
import logging

logger = logging.getLogger(__name__)

PLATFORM_PRESETS: Dict[str, Dict[str, Any]] = {
    "tiktok": {
        "platform": "TikTok",
        "aspect_ratio": "9:16",
        "width": 1080,
        "height": 1920,
        "fps": 30,
        "video_bitrate": "4500k",
        "audio_bitrate": "192k",
        "max_duration_seconds": 60,
    },
    "reels": {
        "platform": "Instagram Reels",
        "aspect_ratio": "9:16",
        "width": 1080,
        "height": 1920,
        "fps": 30,
        "video_bitrate": "4000k",
        "audio_bitrate": "192k",
        "max_duration_seconds": 90,
    },
    "shorts": {
        "platform": "YouTube Shorts",
        "aspect_ratio": "9:16",
        "width": 1080,
        "height": 1920,
        "fps": 60,
        "video_bitrate": "6000k",
        "audio_bitrate": "256k",
        "max_duration_seconds": 60,
    },
}


class SupoClipEditorEngine:
    """Manages clip editing operations via FFmpeg."""

    @classmethod
    def get_presets(cls) -> Dict[str, Dict[str, Any]]:
        return PLATFORM_PRESETS

    @classmethod
    def trim_clip(
        cls,
        source_path: str,
        target_path: str,
        start_time: float,
        end_time: float,
    ) -> bool:
        """Trims a clip between start_time and end_time."""
        if not os.path.exists(source_path):
            raise FileNotFoundError(f"Source clip not found: {source_path}")
        if end_time <= start_time:
            raise ValueError(f"end_time ({end_time}) must be greater than start_time ({start_time})")

        duration = end_time - start_time
        os.makedirs(os.path.dirname(os.path.abspath(target_path)), exist_ok=True)
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start_time),
            "-i", source_path,
            "-t", str(duration),
            "-c:v", "libx264",
            "-c:a", "aac",
            "-pix_fmt", "yuv420p",
            target_path,
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            logger.error(f"FFmpeg trim failed: {res.stderr}")
            return False
        return True

    @classmethod
    def split_clip(
        cls,
        source_path: str,
        target_dir: str,
        split_timestamp: float,
        base_name: str = "split",
    ) -> Tuple[str, str]:
        """Splits a clip at split_timestamp into part 1 and part 2."""
        if not os.path.exists(source_path):
            raise FileNotFoundError(f"Source clip not found: {source_path}")
        if split_timestamp <= 0:
            raise ValueError(f"split_timestamp must be positive, got {split_timestamp}")

        clean_base = re.sub(r"[^a-zA-Z0-9_\-]", "_", os.path.basename(base_name or "split"))
        os.makedirs(target_dir, exist_ok=True)
        part1_path = os.path.join(target_dir, f"{clean_base}_part1.mp4")
        part2_path = os.path.join(target_dir, f"{clean_base}_part2.mp4")

        # Part 1: from 0 to split_timestamp
        cmd1 = [
            "ffmpeg", "-y",
            "-i", source_path,
            "-t", str(split_timestamp),
            "-c:v", "libx264",
            "-c:a", "aac",
            "-pix_fmt", "yuv420p",
            part1_path,
        ]
        res1 = subprocess.run(cmd1, capture_output=True, text=True)
        if res1.returncode != 0:
            raise RuntimeError(f"FFmpeg split part 1 failed: {res1.stderr}")

        # Part 2: from split_timestamp to end
        cmd2 = [
            "ffmpeg", "-y",
            "-ss", str(split_timestamp),
            "-i", source_path,
            "-c:v", "libx264",
            "-c:a", "aac",
            "-pix_fmt", "yuv420p",
            part2_path,
        ]
        res2 = subprocess.run(cmd2, capture_output=True, text=True)
        if res2.returncode != 0:
            raise RuntimeError(f"FFmpeg split part 2 failed: {res2.stderr}")

        return part1_path, part2_path

    @classmethod
    def merge_clips(
        cls,
        clip_paths: List[str],
        target_path: str,
    ) -> bool:
        """Concatenates multiple MP4 clips."""
        if len(clip_paths) < 2:
            raise ValueError(f"Need at least 2 clips to merge, got {len(clip_paths)}")

        for cp in clip_paths:
            if not os.path.exists(cp):
                raise FileNotFoundError(f"Clip not found: {cp}")

        os.makedirs(os.path.dirname(os.path.abspath(target_path)), exist_ok=True)
        concat_list_path = target_path + ".txt"
        with open(concat_list_path, "w", encoding="utf-8") as f:
            for cp in clip_paths:
                clean_path = os.path.abspath(cp).replace("\\", "/").replace("'", "'\\''")
                f.write(f"file '{clean_path}'\n")

        cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_list_path,
            "-c:v", "libx264",
            "-c:a", "aac",
            "-pix_fmt", "yuv420p",
            target_path,
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True)
            return res.returncode == 0
        finally:
            if os.path.exists(concat_list_path):
                os.remove(concat_list_path)

    @classmethod
    def create_zip_archive(
        cls,
        clips: List[Dict[str, Any]],
        target_zip_path: str,
        manifest_meta: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Creates a ZIP archive containing all clips and a manifest.json.
        """
        os.makedirs(os.path.dirname(os.path.abspath(target_zip_path)), exist_ok=True)
        with zipfile.ZipFile(target_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            manifest_items = []
            used_arcnames = set()
            for c in clips:
                file_path = c.get("file_path")
                clip_id = c.get("clip_id", os.path.basename(file_path or "clip"))
                if file_path and os.path.exists(file_path):
                    base_file = os.path.basename(file_path)
                    arcname = f"clips/{base_file}"
                    if arcname in used_arcnames:
                        arcname = f"clips/{clip_id}_{base_file}"
                    used_arcnames.add(arcname)

                    zf.write(file_path, arcname=arcname)
                    manifest_items.append({
                        "clip_id": clip_id,
                        "filename": arcname,
                        "title": c.get("title", ""),
                        "virality_score": c.get("virality_score", 0),
                        "duration": c.get("duration", 0),
                    })
            
            manifest_content = {
                "engine": "supoclip",
                "version": "1.0",
                "total_clips": len(manifest_items),
                "metadata": manifest_meta or {},
                "clips": manifest_items,
            }
            zf.writestr("manifest.json", json.dumps(manifest_content, indent=2))

        return target_zip_path
