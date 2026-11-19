"""
Audio Risk Analyzer & Licensed Replacement Mixer.
Inspects clip metadata cues and audio stream heuristics, classifying honestly into:
  - DETECTED_MATCH
  - POSSIBLE_MATCH
  - NO_MATCH_DETECTED
  - UNABLE_TO_ANALYZE

Never fabricates copyright clearance; flagged audio paths require operator review or
explicit replacement with an authorized/licensed audio track.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import json
import logging
import os
import re
import sqlite3
import subprocess
import uuid
from typing import Any, Dict, List, Optional

from ..contracts.models import AudioRiskAssessment

logger = logging.getLogger("yt_clipping.audio.risk_analyzer")

_MUSIC_CUE_RE = re.compile(
    r"\b(official\s+(audio|music\s+video|lyric)|feat\.|ft\.|remix|soundtrack|bgm|music\s+by|copyrighted\s+music|record\s+label|vevo)\b",
    re.IGNORECASE,
)


class AudioRiskAnalyzer:
    """Performs conservative audio risk screening and authorized replacement mixing."""

    VALID_MATCH_STATUSES = {
        "DETECTED_MATCH",
        "POSSIBLE_MATCH",
        "NO_MATCH_DETECTED",
        "UNABLE_TO_ANALYZE",
    }

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def analyze_clip(
        self,
        *,
        video_id: str,
        clip_id: str,
        file_path: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> AudioRiskAssessment:
        """Assesses clip audio + metadata cues and stores result in `audio_risk_assessments`."""
        meta = metadata or {}
        segments: List[Dict[str, Any]] = []
        title_desc = " ".join(
            str(meta.get(k, "") or "") for k in ("title", "description", "audio_track", "music_license")
        ).strip()

        # Check explicit metadata cues for commercial music / third-party tracks
        cue_matches = _MUSIC_CUE_RE.findall(title_desc)
        licensed_track = bool(meta.get("licensed_audio_id") or meta.get("authorized_audio_track"))

        match_status = "NO_MATCH_DETECTED"
        risk_level = "LOW"
        review_required = False

        if not file_path or not os.path.exists(file_path):
            match_status = "UNABLE_TO_ANALYZE"
            risk_level = "MEDIUM"
            review_required = True
            segments.append({"reason": "Media file missing on disk during audio risk inspection."})
        else:
            probe = self._probe_audio_stream(file_path)
            if not probe.get("readable", False):
                match_status = "UNABLE_TO_ANALYZE"
                risk_level = "MEDIUM"
                review_required = True
                segments.append({"reason": probe.get("error", "Audio stream unreadable")})
            elif cue_matches and not licensed_track:
                match_status = "DETECTED_MATCH"
                risk_level = "HIGH"
                review_required = True
                segments.append(
                    {
                        "source": "metadata_cue",
                        "matched_cues": [m[0] if isinstance(m, tuple) else str(m) for m in cue_matches[:5]],
                        "note": "Commercial music cues present without linked audio license.",
                    }
                )
            elif not probe.get("has_audio", False):
                match_status = "NO_MATCH_DETECTED"
                risk_level = "LOW"
                review_required = False
                segments.append({"note": "Clip contains no audio stream."})
            else:
                # Non-speech/music bed heuristic via ffmpeg astats if available
                if meta.get("has_background_music") and not licensed_track:
                    match_status = "POSSIBLE_MATCH"
                    risk_level = "MEDIUM"
                    review_required = True
                    segments.append({"note": "Unverified background music reported in clip metadata."})

        assessment = AudioRiskAssessment(
            assessment_id=f"aud-{uuid.uuid4().hex[:10]}",
            video_id=video_id,
            clip_id=clip_id,
            match_status=match_status,
            risk_level=risk_level,
            flagged_segments=segments,
            review_required=review_required,
        )
        self._persist(assessment)
        return assessment

    @staticmethod
    def _probe_audio_stream(file_path: str) -> Dict[str, Any]:
        try:
            proc = subprocess.run(
                ["ffmpeg", "-hide_banner", "-i", file_path],
                capture_output=True,
                text=True,
                errors="replace",
                timeout=15,
            )
            stderr = proc.stderr or ""
            has_audio = "Audio:" in stderr
            has_duration = "Duration:" in stderr
            if not has_duration and "Invalid data" in stderr:
                return {"readable": False, "has_audio": False, "error": "Invalid container"}
            return {"readable": True, "has_audio": has_audio}
        except FileNotFoundError:
            return {"readable": False, "has_audio": False, "error": "FFmpeg unavailable"}
        except Exception as exc:
            return {"readable": False, "has_audio": False, "error": str(exc)}

    def _persist(self, assessment: AudioRiskAssessment) -> None:
        conn = self._connect()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO audio_risk_assessments (
                        assessment_id, video_id, clip_id, match_status, risk_level,
                        segments_json, review_required, reviewed_by, reviewed_at,
                        replacement_audio_path, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        assessment.assessment_id,
                        assessment.video_id,
                        assessment.clip_id,
                        assessment.match_status,
                        assessment.risk_level,
                        json.dumps(assessment.flagged_segments),
                        1 if assessment.review_required else 0,
                        assessment.reviewed_by,
                        assessment.reviewed_at,
                        assessment.replacement_audio_path,
                        assessment.created_at,
                    ),
                )
        finally:
            conn.close()

    def replace_audio_track(
        self,
        *,
        assessment_id: str,
        video_path: str,
        replacement_audio_path: str,
        output_path: str,
        authorized_audio_evidence: str,
        reviewer: str,
    ) -> str:
        """Replaces clip audio track with an explicitly authorized licensed track via FFmpeg."""
        if not authorized_audio_evidence or not authorized_audio_evidence.strip():
            raise ValueError("authorized_audio_evidence is required to substitute an audio track.")
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")
        if not os.path.exists(replacement_audio_path):
            raise FileNotFoundError(f"Replacement audio file not found: {replacement_audio_path}")

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            video_path,
            "-i",
            replacement_audio_path,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-movflags",
            "+faststart",
            output_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if proc.returncode != 0 or not os.path.exists(output_path):
            raise RuntimeError(f"FFmpeg audio replacement failed: {proc.stderr[-300:] if proc.stderr else 'unknown error'}")

        now_iso = datetime.now(timezone.utc).isoformat()
        conn = self._connect()
        try:
            with conn:
                conn.execute(
                    """
                    UPDATE audio_risk_assessments
                    SET review_required = 0, reviewed_by = ?, reviewed_at = ?, replacement_audio_path = ?
                    WHERE assessment_id = ?
                    """,
                    (reviewer.strip() or "operator", now_iso, replacement_audio_path, assessment_id),
                )
        finally:
            conn.close()
        return output_path
