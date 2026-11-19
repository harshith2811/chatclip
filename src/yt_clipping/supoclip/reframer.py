"""
SupoClip-inspired Smart Vertical Reframing and Multi-Layout Engine.
Converts landscape (16:9) video into portrait (9:16) with:
1. Talking Head with Ken Burns punch-in zoom
2. Dual-Speaker Split Screen Layout
3. Dynamic Smooth Face-Tracked Crop
"""

from __future__ import annotations
from typing import Dict, Any, List, Optional, Tuple
import os
import cv2
import numpy as np
import subprocess
import logging

logger = logging.getLogger(__name__)


def escape_ffmpeg_filter_path(path: str) -> str:
    """Escapes path for FFmpeg subtitles and filter options across Windows and POSIX."""
    norm = path.replace("\\", "/")
    norm = norm.replace(":", "\\:")
    norm = norm.replace("'", "'\\''")
    norm = norm.replace("[", "\\[").replace("]", "\\]")
    return norm


class SupoClipReframer:
    """Manages face tracking, layout computation, and FFmpeg command generation."""

    def __init__(self, yunet_model_path: Optional[str] = None):
        self.yunet_model_path = yunet_model_path or os.path.abspath(
            os.path.join(os.path.dirname(__file__), "../../../models/face_detection_yunet_2023mar.onnx")
        )
        self.detector = None
        self._init_detector()

    def _init_detector(self):
        if os.path.exists(self.yunet_model_path):
            try:
                self.detector = cv2.FaceDetectorYN.create(
                    self.yunet_model_path,
                    "",
                    (320, 320),
                    score_threshold=0.55,
                    nms_threshold=0.3,
                    top_k=50,
                )
                logger.info("SupoClipReframer: Initialized YuNet ONNX detector.")
            except Exception as e:
                logger.warning(f"SupoClipReframer: Could not load YuNet: {e}")
                self.detector = None

    def detect_faces(self, frame: np.ndarray) -> List[Tuple[float, float, float, float]]:
        """Returns normalized face boxes: (x, y, w, h) in [0.0, 1.0]."""
        h, w = frame.shape[:2]
        if w <= 0 or h <= 0:
            return []

        if self.detector is not None:
            try:
                self.detector.setInputSize((w, h))
                _, faces = self.detector.detect(frame)
                if faces is not None and len(faces) > 0:
                    results = []
                    for face in faces:
                        fx, fy, fw, fh = face[:4]
                        results.append((float(fx / w), float(fy / h), float(fw / w), float(fh / h)))
                    return results
            except Exception as e:
                logger.debug(f"Detector error: {e}")

        # Haar cascade fallback
        try:
            if hasattr(cv2, "CascadeClassifier") and hasattr(cv2, "data"):
                cascade_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
                if os.path.exists(cascade_path):
                    cascade = cv2.CascadeClassifier(cascade_path)
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
                    detected = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4)
                    if len(detected) > 0:
                        return [(float(x / w), float(y / h), float(bw / w), float(bh / h)) for (x, y, bw, bh) in detected]
        except Exception:
            pass

        return []

    def compute_crop_parameters(
        self,
        source_width: int,
        source_height: int,
        target_width: int = 1080,
        target_height: int = 1920,
        layout: str = "talking_head",
        face_center_x: float = 0.5,
    ) -> Dict[str, Any]:
        """
        Calculates optimal crop box.
        For 9:16 target from 16:9 source, crop width = source_height * (9/16).
        Handles narrow/portrait source videos gracefully without invalid crop dimensions.
        """
        target_aspect = 9.0 / 16.0
        source_aspect = (source_width / max(1, source_height))

        if source_aspect <= target_aspect:
            # Video is already narrower than or equal to 9:16
            crop_w = source_width
            if crop_w % 2 != 0:
                crop_w -= 1
            crop_h = min(source_height, int(round(crop_w / target_aspect)))
            if crop_h % 2 != 0:
                crop_h -= 1
            crop_x = 0
            crop_y = max(0, (source_height - crop_h) // 2)
            if crop_y % 2 != 0:
                crop_y = max(0, crop_y - 1)
        else:
            # Standard landscape / wider than 9:16
            crop_h = source_height
            if crop_h % 2 != 0:
                crop_h -= 1
            crop_w = int(round(crop_h * target_aspect))
            if crop_w % 2 != 0:
                crop_w -= 1
            crop_w = min(source_width, crop_w)

            # Position crop_x centered on detected face
            desired_center_x = int(round(source_width * face_center_x))
            crop_x = desired_center_x - (crop_w // 2)
            crop_x = max(0, min(source_width - crop_w, crop_x))
            if crop_x % 2 != 0:
                crop_x = max(0, crop_x - 1)
            crop_y = 0

        # Strict safety bounds
        crop_w = max(2, min(source_width, crop_w))
        crop_h = max(2, min(source_height, crop_h))
        crop_x = max(0, min(source_width - crop_w, crop_x))
        crop_y = max(0, min(source_height - crop_h, crop_y))

        return {
            "crop_w": crop_w,
            "crop_h": crop_h,
            "crop_x": crop_x,
            "crop_y": crop_y,
            "target_w": target_width,
            "target_h": target_height,
            "layout": layout,
        }

    def build_ffmpeg_filter(
        self,
        crop_params: Dict[str, Any],
        ass_path: Optional[str] = None,
        fonts_dir: Optional[str] = None,
        ken_burns_zoom: bool = True,
    ) -> str:
        """
        Builds ffmpeg filter chain for 9:16 reframing.
        Supports both AI Smart Crop (face tracking) and Ambient Flowing Blur (16:9 full in center).
        Burns ASS subtitles if provided.
        """
        target_w = crop_params["target_w"]
        target_h = crop_params["target_h"]
        layout = crop_params.get("layout", "talking_head")

        if layout in ("blur_background", "ambient_blur"):
            sub_filter = ""
            if ass_path and os.path.exists(ass_path):
                escaped_path = escape_ffmpeg_filter_path(os.path.abspath(ass_path))
                sub_filter = f",subtitles=filename='{escaped_path}'"
                if fonts_dir and os.path.exists(fonts_dir):
                    escaped_fonts = escape_ffmpeg_filter_path(os.path.abspath(fonts_dir))
                    sub_filter += f":fontsdir='{escaped_fonts}'"
            return (
                f"[0:v]split=2[in_bg][in_fg];"
                f"[in_bg]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,crop={target_w}:{target_h},boxblur=25:5[bg];"
                f"[in_fg]scale={target_w}:-2[fg];"
                f"[bg][fg]overlay=0:(H-h)/2[comp];"
                f"[comp]setsar=1{sub_filter}[v]"
            )

        crop_w = crop_params["crop_w"]
        crop_h = crop_params["crop_h"]
        crop_x = crop_params["crop_x"]
        crop_y = crop_params["crop_y"]

        filters = []
        # 1. Base Crop
        filters.append(f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}")

        # 2. Scale to target
        filters.append(f"scale={target_w}:{target_h}")

        # 3. Subtitles burn-in
        if ass_path and os.path.exists(ass_path):
            escaped_path = escape_ffmpeg_filter_path(os.path.abspath(ass_path))
            sub_filter = f"subtitles=filename='{escaped_path}'"
            if fonts_dir and os.path.exists(fonts_dir):
                escaped_fonts = escape_ffmpeg_filter_path(os.path.abspath(fonts_dir))
                sub_filter += f":fontsdir='{escaped_fonts}'"
            filters.append(sub_filter)

        return ",".join(filters)
