"""
Tests for Phase 1: Word-boundary snapping and continuation-token merging.
Verifies precision timeline invariants:
- Zero mid-syllable audio cuts (words are never sliced through).
- Lead/tail natural acoustic silence padding.
- Whisper continuation-token and contraction merging.
- Canonical timeline safety bounds.
"""

import pytest
from src.yt_clipping.contracts.models import WordTimestamp, Transcript, TranscriptSegment
from src.yt_clipping.utils.timeline import snap_clip_to_words, sanitize_transcript
from src.yt_clipping.transcription.transcriber import merge_continuation_words


def test_merge_continuation_words_subwords_and_contractions():
    # Whisper raw tokens: " Don", "'t", " give", " up", "."
    raw_tokens = [
        {"word": " Don", "start": 1.0, "end": 1.3, "probability": 0.95},
        {"word": "'t", "start": 1.3, "end": 1.45, "probability": 0.90},
        {"word": " give", "start": 1.6, "end": 1.9, "probability": 0.98},
        {"word": " up", "start": 2.0, "end": 2.2, "probability": 0.99},
        {"word": ".", "start": 2.2, "end": 2.25, "probability": 0.85},
    ]

    merged = merge_continuation_words(raw_tokens)
    words = [w.word for w in merged]

    # " Don" and "'t" must merge into "Don't"
    assert words[0] == "Don't"
    assert merged[0].start == 1.0
    assert merged[0].end == 1.45

    # " give" is distinct
    assert words[1] == "give"
    assert merged[1].start == 1.6
    assert merged[1].end == 1.9

    # " up" and "." merge into "up."
    assert words[2] == "up."
    assert merged[2].start == 2.0
    assert merged[2].end == 2.25


def test_merge_continuation_words_hyphenated_and_currency():
    # "$", "100", "-", "dollar"
    raw_tokens = [
        {"word": " $", "start": 5.0, "end": 5.2, "probability": 0.92},
        {"word": "100", "start": 5.2, "end": 5.5, "probability": 0.95},
        {"word": " bill", "start": 5.6, "end": 5.9, "probability": 0.91},
    ]
    merged = merge_continuation_words(raw_tokens)
    assert len(merged) == 2
    assert merged[0].word == "$100"
    assert merged[0].start == 5.0
    assert merged[0].end == 5.5
    assert merged[1].word == "bill"


def test_snap_clip_to_words_cuts_inside_word():
    # Words:
    # 0: [10.0, 10.6] "Welcome"
    # 1: [10.8, 11.2] "back"
    # 2: [11.5, 12.0] "everyone"
    words = [
        WordTimestamp(word="Welcome", start=10.0, end=10.6),
        WordTimestamp(word="back", start=10.8, end=11.2),
        WordTimestamp(word="everyone", start=11.5, end=12.0),
    ]

    # User cut request: start=10.3 (cuts inside "Welcome") to end=11.8 (cuts inside "everyone")
    s, e = snap_clip_to_words(10.3, 11.8, words, min_lead=0.15, max_lead=0.35, min_tail=0.20, max_tail=0.45)

    # Must snap start BEFORE "Welcome" (<= 10.0)
    assert s <= 10.0
    assert s >= 0.0

    # Must snap end AFTER "everyone" (>= 12.0)
    assert e >= 12.0


def test_snap_clip_to_words_in_silence_gap():
    # Gap between 10.6 and 11.5
    words = [
        WordTimestamp(word="Hello", start=10.0, end=10.6),
        WordTimestamp(word="World", start=11.5, end=12.0),
    ]

    # Cut request inside the silence gap: start=11.0, end=11.3
    s, e = snap_clip_to_words(11.0, 11.3, words)

    # Start should respect lead padding before "World" (11.5 - pad)
    assert s >= 10.6  # Does not cut previous word
    assert s <= 11.5  # Before next word

    # End should satisfy monotonicity and duration
    assert e > s


def test_snap_clip_to_words_clamping_and_bounds():
    words = [
        WordTimestamp(word="Start", start=1.0, end=2.0),
        WordTimestamp(word="End", start=58.0, end=59.5),
    ]

    # Clamping to media_duration=60.0
    s, e = snap_clip_to_words(0.5, 59.9, words, media_duration=60.0)
    assert s >= 0.0
    assert e <= 60.0
    assert s < e

    # Empty words fallback
    s_empty, e_empty = snap_clip_to_words(5.0, 15.0, [], media_duration=60.0)
    assert s_empty == 5.0
    assert e_empty == 15.0
