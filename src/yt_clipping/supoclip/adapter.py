"""
Unified SupoClip Adapter for the YouTube Clipping Intelligence Engine.
Integrates SupoClip's core capabilities:
- Multi-metric virality scoring (hook, engagement, value, shareability, 0-100 virality)
- Punchy hook title generation for clip openers
- Advanced animated caption templates (default, hormozi, mrbeast, minimal, tiktok, neon, podcast)
- Workflows (highlights, series, topic, recap, trailer)
- Face-centered 9:16 smart vertical reframing
- Clip editing (trim, split, merge, presets, ZIP packaging)
"""

from __future__ import annotations
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import asdict
import os
import cv2
import glob
import subprocess
import logging

from .caption_templates import get_template, get_all_templates, get_template_names, get_template_info
from .workflows import WorkflowPlanner, WorkflowOptions, WorkflowPlan
from .virality_scorer import SupoClipScorer, SupoClipViralityScore
from .subtitles import AssSubtitleBuilder
from .reframer import SupoClipReframer
from .editor import SupoClipEditorEngine

logger = logging.getLogger(__name__)


class SupoClipAdapter:
    """Seamless facade for SupoClip features inside yt-clipping-intelligence."""

    def __init__(self, data_dir: Optional[str] = None):
        self.base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
        self.data_dir = data_dir or os.path.join(self.base_dir, "data")
        self.fonts_dir = os.path.join(self.data_dir, "fonts")
        self.yunet_path = os.path.join(self.base_dir, "models", "face_detection_yunet_2023mar.onnx")
        self.reframer = SupoClipReframer(yunet_model_path=self.yunet_path)

    def get_status(self) -> Dict[str, Any]:
        """Returns readiness status of SupoClip components."""
        fonts = self.list_fonts()
        return {
            "status": "ready",
            "engine": "supoclip",
            "version": "1.0.0",
            "yunet_detector_ready": self.reframer.detector is not None,
            "fonts_available": len(fonts),
            "fonts": fonts[:10],
            "templates_count": len(get_template_names()),
            "templates": get_template_names(),
            "workflows": [w["id"] for w in WorkflowPlanner.list_workflows()],
            "editor_presets": list(SupoClipEditorEngine.get_presets().keys()),
        }

    def list_fonts(self) -> List[str]:
        """Lists available TTF fonts in the fonts directory."""
        if not os.path.exists(self.fonts_dir):
            return []
        ttfs = glob.glob(os.path.join(self.fonts_dir, "*.ttf"))
        return [os.path.splitext(os.path.basename(p))[0] for p in ttfs]

    def list_workflows(self) -> List[Dict[str, Any]]:
        """Returns supported workflow definitions."""
        return WorkflowPlanner.list_workflows()

    def list_templates(self) -> List[Dict[str, Any]]:
        """Returns supported caption templates."""
        return get_template_info()

    def plan_workflow(
        self,
        workflow: str,
        duration: float,
        transcript_segments: Optional[List[Dict[str, Any]]] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generates a structured plan for the specified workflow."""
        wf_opts = WorkflowOptions.from_dict(options)
        plan = WorkflowPlanner.plan(
            workflow=workflow,
            duration=duration,
            transcript_segments=transcript_segments,
            options=wf_opts,
        )
        return {
            "workflow": plan.workflow,
            "total_parts": plan.total_parts,
            "overview": plan.overview,
            "options": plan.options.to_dict(),
            "segments": [asdict(s) for s in plan.segments],
        }

    def score_content(
        self,
        text: str,
        duration: float = 30.0,
        pacing_wpm: float = 140.0,
        audio_energy: float = 0.7,
    ) -> Dict[str, Any]:
        """Computes SupoClip's 4 virality dimensions + hook title."""
        score = SupoClipScorer.score_segment(
            text=text,
            duration=duration,
            pacing_wpm=pacing_wpm,
            audio_energy=audio_energy,
        )
        return score.to_dict()

    def generate_subtitles_ass(
        self,
        words: List[Dict[str, Any]],
        template_name: str = "default",
        video_width: int = 1080,
        video_height: int = 1920,
        hook_title: Optional[str] = None,
        output_path: Optional[str] = None,
    ) -> str:
        """Generates ASS script content and optionally writes it to output_path."""
        ass_content = AssSubtitleBuilder.generate_ass(
            words=words,
            template_name=template_name,
            video_width=video_width,
            video_height=video_height,
            hook_title=hook_title,
        )
        if output_path:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(ass_content)
        return ass_content

    def render_reframed_clip(
        self,
        source_path: str,
        output_path: str,
        start_time: float,
        end_time: float,
        template_name: str = "default",
        words: Optional[List[Dict[str, Any]]] = None,
        hook_title: Optional[str] = None,
        layout: str = "talking_head",
        ken_burns_zoom: bool = True,
        platform_preset: Optional[str] = None,
    ) -> bool:
        """
        Renders a 9:16 vertical clip with smart face-centered framing,
        optional subtle Ken Burns zoom, and burned animated ASS subtitles.
        """
        if not os.path.exists(source_path):
            raise FileNotFoundError(f"Source video not found: {source_path}")

        duration = end_time - start_time
        if duration <= 0:
            raise ValueError(f"Invalid duration: {duration} (end_time {end_time} must be > start_time {start_time})")

        # Compute crop parameters
        # Probe video size or default to 1920x1080
        src_w, src_h = 1920, 1080
        face_center_x = 0.5
        cap = cv2.VideoCapture(source_path)
        if cap.isOpened():
            src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
            src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)
            fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

            # Sample 3 checkpoints inside the clip interval [start_time, end_time]
            start_f = max(0, int(start_time * fps))
            end_f = min(total_frames - 1, int(end_time * fps)) if total_frames > 0 else int(end_time * fps)
            if end_f <= start_f:
                end_f = start_f + int(fps * 2)

            checkpoints = [
                start_f + int((end_f - start_f) * 0.25),
                start_f + int((end_f - start_f) * 0.50),
                start_f + int((end_f - start_f) * 0.75),
            ]

            detected_x: List[float] = []
            for cp_idx in checkpoints:
                if total_frames <= 0 or cp_idx < total_frames:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, cp_idx))
                    ret, frame = cap.read()
                    if ret and frame is not None:
                        faces = self.reframer.detect_faces(frame)
                        if faces:
                            # Largest detected face
                            best = max(faces, key=lambda f: f[2] * f[3])
                            fx, fy, fw, fh = best
                            detected_x.append(fx + (fw / 2.0))
            cap.release()
            if detected_x:
                detected_x.sort()
                face_center_x = detected_x[len(detected_x) // 2]
        else:
            face_center_x = 0.5

        crop_params = self.reframer.compute_crop_parameters(
            source_width=src_w,
            source_height=src_h,
            target_width=1080,
            target_height=1920,
            layout=layout,
            face_center_x=face_center_x,
        )

        # Build ASS subtitles if words or hook_title provided
        ass_temp_path = None
        if words or hook_title:
            ass_temp_path = output_path + ".ass"
            self.generate_subtitles_ass(
                words=words or [],
                template_name=template_name,
                video_width=1080,
                video_height=1920,
                hook_title=hook_title,
                output_path=ass_temp_path,
            )

        filter_str = self.reframer.build_ffmpeg_filter(
            crop_params=crop_params,
            ass_path=ass_temp_path,
            fonts_dir=self.fonts_dir if os.path.exists(self.fonts_dir) else None,
            ken_burns_zoom=ken_burns_zoom,
        )

        presets = SupoClipEditorEngine.get_presets()
        preset_cfg = presets.get(str(platform_preset).lower(), {}) if platform_preset else {}
        fps_val = str(preset_cfg.get("fps", 30))
        v_bitrate = preset_cfg.get("video_bitrate", "4500k")
        a_bitrate = preset_cfg.get("audio_bitrate", "192k")

        filter_args = (
            ["-filter_complex", filter_str, "-map", "[v]", "-map", "0:a?"]
            if ";" in filter_str or "[v]" in filter_str
            else ["-vf", filter_str]
        )

        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start_time),
            "-i", source_path,
            "-t", str(duration),
            *filter_args,
            "-r", fps_val,
            "-b:v", v_bitrate,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "18",
            "-c:a", "aac",
            "-b:a", a_bitrate,
            "-pix_fmt", "yuv420p",
            output_path,
        ]

        try:
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode != 0:
                logger.error(f"SupoClip render failed: {res.stderr}")
                return False
            return True
        finally:
            if ass_temp_path and os.path.exists(ass_temp_path):
                try:
                    os.remove(ass_temp_path)
                except Exception:
                    pass

    def trim(self, source_path: str, target_path: str, start_time: float, end_time: float) -> bool:
        return SupoClipEditorEngine.trim_clip(source_path, target_path, start_time, end_time)

    def split(self, source_path: str, target_dir: str, split_timestamp: float, base_name: str = "split") -> Tuple[str, str]:
        return SupoClipEditorEngine.split_clip(source_path, target_dir, split_timestamp, base_name=base_name)

    def merge(self, clip_paths: List[str], target_path: str) -> bool:
        return SupoClipEditorEngine.merge_clips(clip_paths, target_path)

    def get_presets(self) -> Dict[str, Dict[str, Any]]:
        return SupoClipEditorEngine.get_presets()

    def package_zip(self, clips: List[Dict[str, Any]], target_zip_path: str, metadata: Optional[Dict[str, Any]] = None) -> str:
        return SupoClipEditorEngine.create_zip_archive(clips, target_zip_path, metadata)


# Global adapter singleton
_supoclip_instance: Optional[SupoClipAdapter] = None


def get_supoclip_adapter() -> SupoClipAdapter:
    global _supoclip_instance
    if _supoclip_instance is None:
        _supoclip_instance = SupoClipAdapter()
    return _supoclip_instance
