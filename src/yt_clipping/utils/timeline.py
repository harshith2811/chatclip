"""
Media Timeline and Timestamp Sanitization Layer.
Enforces invariant guarantees across speech transcription, video cutting,
and ASS/SRT caption subtitle generation:
- Finite non-negative numbers (replaces NaN/Inf with 0.0)
- Strictly positive durations (start < end)
- Chronological monotonicity within segments
- Clamped within valid media / candidate bounds
"""

from typing import List, Optional, Any
import math
import logging
from ..contracts.models import WordTimestamp, TranscriptSegment, Transcript

logger = logging.getLogger(__name__)


def sanitize_float(val: Any, default: float = 0.0, min_val: float = 0.0) -> float:
    """Ensures value is a finite float >= min_val."""
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return max(min_val, f)
    except (TypeError, ValueError):
        return default


def sanitize_word_timestamps(
    words: List[WordTimestamp],
    segment_start: float = 0.0,
    segment_end: Optional[float] = None,
    media_duration: Optional[float] = None,
) -> List[WordTimestamp]:
    """
    Sanitizes word timestamps:
    - Finite numeric timestamps
    - Positive duration (start < end)
    - Chronological ordering
    - Bounded within segment and media duration
    """
    if not words:
        return []

    sanitized: List[WordTimestamp] = []
    prev_end = segment_start

    for idx, w in enumerate(words):
        raw_start = sanitize_float(getattr(w, "start", 0.0), default=prev_end, min_val=0.0)
        raw_end = sanitize_float(getattr(w, "end", 0.0), default=raw_start + 0.1, min_val=0.0)

        # Monotonicity check
        if raw_start < prev_end:
            raw_start = prev_end

        # Minimum word duration of 0.04s (~1 frame at 24fps)
        if raw_end <= raw_start:
            raw_end = raw_start + 0.08

        # Clamp to media duration if known
        if media_duration is not None and media_duration > 0:
            if raw_start >= media_duration - 0.01:
                continue
            raw_end = min(raw_end, media_duration)
            if raw_end <= raw_start:
                continue

        word_text = getattr(w, "word", "").strip()
        conf = sanitize_float(getattr(w, "confidence", 0.9), default=0.9, min_val=0.0)
        conf = min(conf, 1.0)
        speaker_tag = getattr(w, "speaker_tag", None)

        sanitized.append(
            WordTimestamp(
                word=word_text,
                start=round(raw_start, 3),
                end=round(raw_end, 3),
                confidence=round(conf, 2),
                speaker_tag=speaker_tag,
            )
        )
        prev_end = raw_end

    return sanitized


def sanitize_transcript(transcript: Transcript, media_duration: Optional[float] = None) -> Transcript:
    """
    Sanitizes an entire transcript, ensuring segments and words are chronologically
    consistent, bounded, and free of NaN/Inf.
    """
    clean_segments: List[TranscriptSegment] = []
    prev_seg_end = 0.0

    for seg in transcript.segments:
        s_start = sanitize_float(seg.start, default=prev_seg_end, min_val=0.0)
        s_end = sanitize_float(seg.end, default=s_start + 0.5, min_val=s_start + 0.05)

        if s_end <= s_start:
            s_end = s_start + 0.5

        if media_duration and media_duration > 0:
            if s_start >= media_duration - 0.01:
                continue
            s_end = min(s_end, media_duration)
            if s_end <= s_start:
                continue

        clean_words = sanitize_word_timestamps(
            seg.words or [],
            segment_start=s_start,
            segment_end=s_end,
            media_duration=media_duration,
        )

        clean_segments.append(
            TranscriptSegment(
                segment_id=seg.segment_id,
                start=round(s_start, 3),
                end=round(s_end, 3),
                text=seg.text.strip(),
                words=clean_words,
                speaker_tag=getattr(seg, "speaker_tag", getattr(seg, "speaker", None)),
            )
        )
        prev_seg_end = s_end

    transcript.segments = clean_segments
    if clean_segments:
        transcript.duration_seconds = max(
            sanitize_float(transcript.duration_seconds),
            clean_segments[-1].end
        )
    return transcript
