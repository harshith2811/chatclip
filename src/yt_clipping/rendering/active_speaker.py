"""
Active Speaker Detection and Multi-Subject Cinematography Engine.
Combines visual mouth motion analysis (optical variance in facial lower-third)
with acoustic speech activity gating to determine the active speaker.
100% local, runs with OpenCV and NumPy, zero external paid APIs.
"""

from typing import List, Tuple, Optional, Dict, Any
import os
import cv2
import numpy as np
import logging

logger = logging.getLogger(__name__)


def extract_mouth_region(frame: np.ndarray, face_box: Tuple[int, int, int, int]) -> Optional[np.ndarray]:
    """
    Extracts the mouth/jaw region (lower third, centered horizontally) from a detected face.
    face_box: (x, y, w, h)
    """
    fx, fy, fw, fh = face_box
    if fw <= 0 or fh <= 0:
        return None

    frame_h, frame_w = frame.shape[:2]
    # Lower 35% of face, horizontally spanning center 60%
    my = max(0, min(frame_h - 1, int(fy + fh * 0.62)))
    mh = max(1, min(frame_h - my, int(fh * 0.35)))
    mx = max(0, min(frame_w - 1, int(fx + fw * 0.20)))
    mw = max(1, min(frame_w - mx, int(fw * 0.60)))

    if mw < 8 or mh < 6:
        return None

    patch = frame[my : my + mh, mx : mx + mw]
    if patch.size == 0:
        return None

    # Convert to grayscale and normalize size for stable variance comparison
    if len(patch.shape) == 3:
        gray_patch = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
    else:
        gray_patch = patch

    return cv2.resize(gray_patch, (64, 48), interpolation=cv2.INTER_AREA)


def compute_mouth_motion_energy(prev_patch: np.ndarray, curr_patch: np.ndarray) -> float:
    """
    Computes optical variance energy between consecutive mouth patches.
    Higher values indicate active jaw/lip articulation.
    """
    if prev_patch is None or curr_patch is None:
        return 0.0
    if prev_patch.shape != curr_patch.shape:
        return 0.0

    # Gaussian blur to filter out sensor noise / compression artifacts
    p1 = cv2.GaussianBlur(prev_patch, (5, 5), 0)
    p2 = cv2.GaussianBlur(curr_patch, (5, 5), 0)

    diff = cv2.absdiff(p1, p2)
    # Mean intensity variance of difference map
    motion_energy = float(np.mean(diff))
    return round(motion_energy, 3)


class ActiveSpeakerEstimator:
    """
    Multi-face tracking with lip-motion variance estimation and audio presence gating.
    Identifies the active speaker, detects conversational turns, and calculates
    dynamic framing coordinates for single and multi-person layouts.
    """

    def __init__(
        self,
        sample_fps: float = 8.0,
        min_face_ratio: float = 0.045,
        speech_motion_threshold: float = 3.5,
    ):
        self.sample_fps = max(1.0, float(sample_fps))
        self.min_face_ratio = min_face_ratio
        self.speech_motion_threshold = speech_motion_threshold

        # Initialize Haar cascade fallback
        self.face_cascade = None
        try:
            if hasattr(cv2, "CascadeClassifier") and hasattr(cv2, "data") and hasattr(cv2.data, "haarcascades"):
                p = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
                if os.path.exists(p):
                    self.face_cascade = cv2.CascadeClassifier(p)
        except Exception:
            pass

    def estimate_active_speakers(
        self,
        media_path: str,
        start_seconds: float,
        duration_seconds: float,
        speech_intervals: Optional[List[Tuple[float, float]]] = None,
    ) -> Dict[str, Any]:
        """
        Analyzes video interval to track faces, calculate mouth motion,
        correlate with speech timestamps, and produce cinematography framing metrics.
        """
        default_res = {
            "has_multiple_speakers": False,
            "active_speaker_x": None,
            "speaker_tracks": [],
            "split_top_x": None,
            "split_bot_x": None,
            "recommended_layout": "active_speaker",
            "confidence": 0.0,
        }

        if not os.path.exists(media_path) or duration_seconds <= 0.0:
            return default_res

        cap = cv2.VideoCapture(media_path)
        if not cap.isOpened():
            return default_res

        try:
            fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
            src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

            start_frame = int(start_seconds * fps)
            num_frames = int(duration_seconds * fps)
            step = max(1, int(round(fps / self.sample_fps)))

            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, start_frame))

            # Track faces across frames: cluster by x-position (left vs right person)
            # Left cluster: x < src_w * 0.5; Right cluster: x >= src_w * 0.5
            left_mouth_energies: List[float] = []
            right_mouth_energies: List[float] = []
            left_x_positions: List[int] = []
            right_x_positions: List[int] = []

            prev_left_patch = None
            prev_right_patch = None

            min_face_px = max(40, int(src_h * self.min_face_ratio))

            sampled_count = 0
            for i in range(num_frames):
                if i % step != 0:
                    if not cap.grab():
                        break
                    continue

                ret, frame = cap.read()
                if not ret or frame is None:
                    break

                t_curr = start_seconds + (float(i) / fps)
                sampled_count += 1

                # Check if speech is active at this timestamp
                is_speech_active = True
                if speech_intervals is not None:
                    is_speech_active = any(s <= t_curr <= e for s, e in speech_intervals)

                # Face detection
                faces: List[Tuple[int, int, int, int]] = []
                if self.face_cascade is not None:
                    scale = 0.5
                    small = cv2.resize(frame, (0, 0), fx=scale, fy=scale)
                    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                    detected = self.face_cascade.detectMultiScale(
                        gray,
                        scaleFactor=1.15,
                        minNeighbors=5,
                        minSize=(int(min_face_px * scale), int(min_face_px * scale)),
                    )
                    for (x, y, w, h) in detected:
                        real_box = (int(x / scale), int(y / scale), int(w / scale), int(h / scale))
                        faces.append(real_box)

                # Sort detected faces from left to right
                faces.sort(key=lambda b: b[0])

                curr_left_patch = None
                curr_right_patch = None

                for box in faces:
                    cx = box[0] + box[2] // 2
                    if cx < src_w * 0.5:
                        left_x_positions.append(cx)
                        curr_left_patch = extract_mouth_region(frame, box)
                    else:
                        right_x_positions.append(cx)
                        curr_right_patch = extract_mouth_region(frame, box)

                if is_speech_active:
                    if curr_left_patch is not None and prev_left_patch is not None:
                        e_left = compute_mouth_motion_energy(prev_left_patch, curr_left_patch)
                        left_mouth_energies.append(e_left)
                    if curr_right_patch is not None and prev_right_patch is not None:
                        e_right = compute_mouth_motion_energy(prev_right_patch, curr_right_patch)
                        right_mouth_energies.append(e_right)

                if curr_left_patch is not None:
                    prev_left_patch = curr_left_patch
                if curr_right_patch is not None:
                    prev_right_patch = curr_right_patch

            # Analyze aggregated scores
            has_left = len(left_x_positions) >= 3
            has_right = len(right_x_positions) >= 3

            avg_left_energy = float(np.mean(left_mouth_energies)) if left_mouth_energies else 0.0
            avg_right_energy = float(np.mean(right_mouth_energies)) if right_mouth_energies else 0.0

            has_two_people = has_left and has_right

            # Calculate 9:8 split-screen crop width
            # 9:8 aspect ratio for each half of 9:16 stacked
            crop_w_split = int(src_h * 9.0 / 8.0)
            if crop_w_split % 2 != 0:
                crop_w_split -= 1
            crop_w_split = min(crop_w_split, src_w)

            split_top_x = None
            split_bot_x = None

            if has_two_people:
                med_left = int(np.median(left_x_positions))
                med_right = int(np.median(right_x_positions))

                # Center crop on left speaker
                split_top_x = max(0, min(src_w - crop_w_split, med_left - crop_w_split // 2))
                split_top_x = split_top_x if split_top_x % 2 == 0 else max(0, split_top_x - 1)

                # Center crop on right speaker
                split_bot_x = max(0, min(src_w - crop_w_split, med_right - crop_w_split // 2))
                split_bot_x = split_bot_x if split_bot_x % 2 == 0 else max(0, split_bot_x - 1)

            # Determine dominant active speaker
            active_x = None
            if has_two_people:
                if avg_left_energy > avg_right_energy * 1.35:
                    active_x = int(np.median(left_x_positions))
                elif avg_right_energy > avg_left_energy * 1.35:
                    active_x = int(np.median(right_x_positions))
            elif has_left:
                active_x = int(np.median(left_x_positions))
            elif has_right:
                active_x = int(np.median(right_x_positions))

            # Layout recommendation
            if has_two_people and (avg_left_energy >= self.speech_motion_threshold or avg_right_energy >= self.speech_motion_threshold):
                layout = "split_screen"
            elif active_x is not None:
                layout = "active_speaker"
            else:
                layout = "blur_background"

            return {
                "has_multiple_speakers": has_two_people,
                "active_speaker_x": active_x,
                "left_speech_energy": round(avg_left_energy, 2),
                "right_speech_energy": round(avg_right_energy, 2),
                "split_top_x": split_top_x,
                "split_bot_x": split_bot_x,
                "recommended_layout": layout,
                "confidence": 0.85 if has_two_people or active_x is not None else 0.40,
            }
        finally:
            cap.release()
