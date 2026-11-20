"""
Media Timeline and Timestamp Sanitization Layer.
Enforces invariant guarantees across speech transcription, video cutting,
and ASS/SRT caption subtitle generation:
- Finite non-negative numbers (replaces NaN/Inf with 0.0)
- Strictly positive durations (start < end)
- Chronological monotonicity within segments
- Clamped within valid media / candidate bounds
"""

from typing import List, Optional, Any, Tuple
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

        # Word timing must stay inside its containing caption segment.
        if segment_end is not None:
            if raw_start >= segment_end:
                continue
            raw_end = min(raw_end, segment_end)
            if raw_end <= raw_start:
                continue

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


def snap_clip_to_words(
    start_seconds: float,
    end_seconds: float,
    words: List[Any],
    min_lead: float = 0.15,
    max_lead: float = 0.35,
    min_tail: float = 0.20,
    max_tail: float = 0.45,
    media_duration: Optional[float] = None,
) -> Tuple[float, float]:
    """
    Snaps candidate cut boundaries to speech word boundaries.
    Prevents mid-syllable audio truncation by aligning cuts to spoken words
    with natural acoustic silence padding.

    Guarantees:
    - 0.0 <= snapped_start < snapped_end
    - If media_duration is provided: snapped_end <= media_duration
    - Never cuts through an active word token.
    - If start is inside a word, snaps before that word with lead padding.
    - If end is inside a word, snaps after that word with tail padding.
    - Adds natural silence lead/tail padding clamped between min and max bounds.
    """
    s = sanitize_float(start_seconds, default=0.0, min_val=0.0)
    e = sanitize_float(end_seconds, default=s + 1.0, min_val=s + 0.05)

    if not words:
        if media_duration is not None and media_duration > 0.0:
            s = min(s, max(0.0, media_duration - 0.1))
            e = min(e, media_duration)
        return round(s, 3), round(e, 3)

    # Normalize words to list of (start, end, word_text)
    norm_words: List[Tuple[float, float, str]] = []
    for w in words:
        if isinstance(w, dict):
            w_start = sanitize_float(w.get("start", 0.0))
            w_end = sanitize_float(w.get("end", 0.0))
            w_text = str(w.get("word", "")).strip()
        else:
            w_start = sanitize_float(getattr(w, "start", 0.0))
            w_end = sanitize_float(getattr(w, "end", 0.0))
            w_text = str(getattr(w, "word", "")).strip()
        if w_end > w_start:
            norm_words.append((w_start, w_end, w_text))

    if not norm_words:
        if media_duration is not None and media_duration > 0.0:
            s = min(s, max(0.0, media_duration - 0.1))
            e = min(e, media_duration)
        return round(s, 3), round(e, 3)

    norm_words.sort(key=lambda x: x[0])

    # 1. Snap Start Boundary
    first_w = norm_words[0]
    last_w = norm_words[-1]

    # Check if start is already cleanly aligned to a word start boundary
    already_snapped_start = False
    for w_s, _, _ in norm_words:
        if abs(s - w_s) <= 0.05:
            snapped_start = w_s
            already_snapped_start = True
            break

    if not already_snapped_start:
        if s <= first_w[0]:
            # Before or at first word
            available = first_w[0]
            pad = min(max_lead, max(min_lead, available * 0.5)) if available > 0 else 0.0
            snapped_start = max(0.0, first_w[0] - pad)
        elif s >= last_w[1]:
            # Past all speech: snap to last word start or silence
            snapped_start = max(0.0, last_w[0] - min_lead)
        else:
            # Check if s cuts into an active word
            cutting_word_idx = None
            for i, (w_s, w_e, _) in enumerate(norm_words):
                if w_s <= s < w_e:
                    cutting_word_idx = i
                    break

            if cutting_word_idx is not None:
                # Cut is inside word cutting_word_idx: move start to before this word
                w_s, _, _ = norm_words[cutting_word_idx]
                prev_end = norm_words[cutting_word_idx - 1][1] if cutting_word_idx > 0 else 0.0
                available = max(0.0, w_s - prev_end)
                pad = min(max_lead, max(min_lead, available * 0.5)) if available > 0 else 0.0
                snapped_start = max(prev_end, w_s - pad)
            else:
                # s falls in a silence gap between norm_words[i-1] and norm_words[i]
                snapped_start = s
                for i in range(1, len(norm_words)):
                    prev_e = norm_words[i - 1][1]
                    next_s = norm_words[i][0]
                    if prev_e <= s < next_s:
                        available = next_s - prev_e
                        pad = min(max_lead, max(min_lead, available * 0.5))
                        # Position before next_s with lead padding, but no earlier than prev_e
                        snapped_start = max(prev_e, next_s - pad)
                        break

    # 2. Snap End Boundary
    already_snapped_end = False
    for _, w_e, _ in norm_words:
        if abs(e - w_e) <= 0.05:
            snapped_end = w_e
            already_snapped_end = True
            break

    if not already_snapped_end:
        if e >= last_w[1]:
            # At or beyond last word
            available = (media_duration - last_w[1]) if media_duration else max_tail
            pad = min(max_tail, max(min_tail, available * 0.5)) if available > 0 else 0.0
            snapped_end = last_w[1] + pad
        elif e <= first_w[0]:
            # Before any speech: snap past first word
            snapped_end = first_w[1] + min_tail
        else:
            # Check if e cuts into an active word
            cutting_word_idx = None
            for i, (w_s, w_e, _) in enumerate(norm_words):
                if w_s < e <= w_e:
                    cutting_word_idx = i
                    break

            if cutting_word_idx is not None:
                # Cut is inside word cutting_word_idx: move end to after this word
                _, w_e, _ = norm_words[cutting_word_idx]
                next_start = (
                    norm_words[cutting_word_idx + 1][0]
                    if cutting_word_idx + 1 < len(norm_words)
                    else (media_duration or (w_e + max_tail))
                )
                available = max(0.0, next_start - w_e)
                pad = min(max_tail, max(min_tail, available * 0.5)) if available > 0 else 0.0
                snapped_end = min(next_start, w_e + pad)
            else:
                # e falls in a silence gap between norm_words[i] and norm_words[i+1]
                snapped_end = e
                for i in range(len(norm_words) - 1):
                    prev_e = norm_words[i][1]
                    next_s = norm_words[i + 1][0]
                    if prev_e <= e < next_s:
                        available = next_s - prev_e
                        pad = min(max_tail, max(min_tail, available * 0.5))
                        # Position after prev_e with tail padding, but no later than next_s
                        snapped_end = min(next_s, prev_e + pad)
                        break

    # 3. Final Invariants
    snapped_start = max(0.0, snapped_start)
    if snapped_end <= snapped_start:
        snapped_end = snapped_start + max(1.0, e - s)

    if media_duration is not None and media_duration > 0.0:
        if snapped_end > media_duration:
            snapped_end = media_duration
            if snapped_start >= snapped_end:
                snapped_start = max(0.0, snapped_end - 1.0)

    return round(snapped_start, 3), round(snapped_end, 3)

