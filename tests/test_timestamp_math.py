"""
Tests for timestamp boundary mathematics, durations, and half-open intervals.
"""

import pytest
from src.yt_clipping.contracts.models import HighlightCandidate, ScoreBreakdown


@pytest.mark.parametrize("field", ["start_seconds", "end_seconds", "duration_seconds"])
@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf"), None, "30", True])
def test_candidate_bounds_reject_nonfinite_and_untyped_timing(field, value):
    candidate = HighlightCandidate(candidate_id="c", video_id="v", start_seconds=0,
        end_seconds=30, duration_seconds=30, score=80, breakdown=ScoreBreakdown(), hook_title="Test")
    setattr(candidate, field, value)
    assert candidate.validate_bounds(60) is False


def test_candidate_bounds_do_not_allow_half_second_past_media_end():
    candidate = HighlightCandidate(candidate_id="c", video_id="v", start_seconds=0,
        end_seconds=30.4, duration_seconds=30.4, score=80, breakdown=ScoreBreakdown(), hook_title="Test")
    assert candidate.validate_bounds(30) is False
    assert candidate.validate_bounds(float("nan")) is False


def test_word_sanitizer_enforces_segment_end():
    from src.yt_clipping.contracts.models import WordTimestamp
    from src.yt_clipping.utils.timeline import sanitize_word_timestamps

    words = [WordTimestamp(word="edge", start=1.8, end=2.4),
             WordTimestamp(word="outside", start=2.5, end=3.0)]
    result = sanitize_word_timestamps(words, segment_start=1, segment_end=2, media_duration=10)
    assert [(w.word, w.start, w.end) for w in result] == [("edge", 1.8, 2)]


def test_pruned_transcript_words_are_bounded_and_preserve_speaker():
    from src.yt_clipping.contracts.models import Transcript, TranscriptSegment, WordTimestamp
    from src.yt_clipping.orchestration.pipeline import remap_transcript_for_keep_intervals

    transcript = Transcript(video_id="source", language="en", duration_seconds=5,
        text="edge", segments=[TranscriptSegment(segment_id=1, start=0, end=5,
            text="edge", words=[WordTimestamp(word="edge", start=0.5, end=2.5,
                confidence=0.7, speaker_tag="speaker")])])
    result = remap_transcript_for_keep_intervals(transcript, [(1, 2)])
    word = result.segments[0].words[0]
    assert (word.start, word.end) == (0, 1)
    assert word.confidence == 0.7
    assert word.speaker_tag == "speaker"


def test_oversized_segment_partition_preserves_every_word():
    from src.yt_clipping.contracts.models import TranscriptSegment
    from src.yt_clipping.detection.segmenter import ContextAwareSegmenter

    text = "one two three four five six seven eight nine ten eleven"
    segment = TranscriptSegment(segment_id=1, start=10, end=110, text=text, words=[])
    chunks = ContextAwareSegmenter()._normalize_segments([segment], max_dur=45)
    assert " ".join(chunk.text for chunk in chunks) == text
    assert chunks[0].start == 10
    assert chunks[-1].end == 110
    assert all(0 < chunk.end - chunk.start <= 45 for chunk in chunks)
    assert all(left.end == right.start for left, right in zip(chunks, chunks[1:]))


def test_candidate_boundary_validation():
    breakdown = ScoreBreakdown()
    valid_cand = HighlightCandidate(
        candidate_id="c1",
        video_id="v1",
        start_seconds=10.0,
        end_seconds=45.0,
        duration_seconds=35.0,
        score=80.0,
        breakdown=breakdown,
        hook_title="Valid Moment",
    )
    # Valid within 60s video
    assert valid_cand.validate_bounds(source_duration=60.0) is True

    # Negative start
    neg_cand = HighlightCandidate(
        candidate_id="c2",
        video_id="v1",
        start_seconds=-2.0,
        end_seconds=30.0,
        duration_seconds=32.0,
        score=80.0,
        breakdown=breakdown,
        hook_title="Negative start",
    )
    assert neg_cand.validate_bounds(source_duration=60.0) is False

    # End before start
    inverted_cand = HighlightCandidate(
        candidate_id="c3",
        video_id="v1",
        start_seconds=40.0,
        end_seconds=30.0,
        duration_seconds=-10.0,
        score=80.0,
        breakdown=breakdown,
        hook_title="Inverted bounds",
    )
    assert inverted_cand.validate_bounds(source_duration=60.0) is False

    # Exceeding source duration
    exceeding_cand = HighlightCandidate(
        candidate_id="c4",
        video_id="v1",
        start_seconds=10.0,
        end_seconds=75.0,
        duration_seconds=65.0,
        score=80.0,
        breakdown=breakdown,
        hook_title="Exceeds video length",
    )
    assert exceeding_cand.validate_bounds(source_duration=60.0) is False


def test_floating_point_rounding_precision():
    start = 12.3456
    end = 45.6789
    dur = round(end - start, 2)
    assert dur == 33.33


def test_subtitle_timestamp_rollover_boundaries():
    from src.yt_clipping.rendering.captions import SubtitleGenerator

    # Test ASS rollover when fraction rounds to 100cs
    assert SubtitleGenerator._format_timestamp_ass(0.0) == "0:00:00.00"
    assert SubtitleGenerator._format_timestamp_ass(1.996) == "0:00:02.00"
    assert SubtitleGenerator._format_timestamp_ass(59.999) == "0:01:00.00"
    assert SubtitleGenerator._format_timestamp_ass(3661.05) == "1:01:01.05"

    # Test SRT rollover when fraction rounds to 1000ms
    assert SubtitleGenerator._format_timestamp_srt(0.0) == "00:00:00,000"
    assert SubtitleGenerator._format_timestamp_srt(1.9996) == "00:00:02,000"
    assert SubtitleGenerator._format_timestamp_srt(59.9996) == "00:01:00,000"
    assert SubtitleGenerator._format_timestamp_srt(3661.05) == "01:01:01,050"


def test_caption_word_boundary_overlap(tmp_path):
    """Regression test for L06: word ending exactly at or before clip start must not be included."""
    from src.yt_clipping.rendering.captions import SubtitleGenerator
    from src.yt_clipping.contracts.models import Transcript, TranscriptSegment, WordTimestamp

    # Clip is from 10.0 to 20.0
    cand = HighlightCandidate(
        candidate_id="c_overlap_test",
        video_id="v_test",
        start_seconds=10.0,
        end_seconds=20.0,
        duration_seconds=10.0,
        score=85.0,
        breakdown=ScoreBreakdown(),
        hook_title="Test Overlap",
    )

    # Word 1 ends at 10.0 (outside clip), Word 2 starts at 10.05 (inside), Word 3 starts at 20.0 (outside)
    seg = TranscriptSegment(
        segment_id=1,
        start=9.0,
        end=21.0,
        text="previous inside following",
        words=[
            WordTimestamp(word="previous", start=9.2, end=10.0),
            WordTimestamp(word="inside", start=10.05, end=11.0),
            WordTimestamp(word="following", start=20.0, end=20.8),
        ]
    )
    transcript = Transcript(
        video_id="v_test",
        language="en",
        duration_seconds=30.0,
        text="previous inside following",
        segments=[seg]
    )

    gen = SubtitleGenerator(style_preset="hormozi")
    out_ass = str(tmp_path / "test_boundary.ass")
    gen.generate_ass(cand, transcript, out_ass)

    content = open(out_ass, "r", encoding="utf-8").read()
    # 'PREVIOUS' and 'FOLLOWING' must NOT appear in dialogue events
    assert "INSIDE" in content
    assert "PREVIOUS" not in content
    assert "FOLLOWING" not in content


def test_ass_color_normalization(tmp_path):
    """Regression test for L07: Custom ASS color format normalization and avoidance of duplicate '&&'."""
    from src.yt_clipping.rendering.captions import SubtitleGenerator, normalize_ass_color
    from src.yt_clipping.contracts.models import Transcript, TranscriptSegment, WordTimestamp

    # Test standalone normalizer
    assert normalize_ass_color("&H00FFFFFF&") == "&H00FFFFFF&"
    assert normalize_ass_color("&H00FFFFFF&&") == "&H00FFFFFF&"
    assert normalize_ass_color("#FF5500") == "&H000055FF&"
    assert normalize_ass_color("00FFFF") == "&H0000FFFF&"

    # Test in ASS generation with custom primary and highlight colors that include trailing ampersands
    gen = SubtitleGenerator(
        style_preset="hormozi",
        primary_color="&H00FFFFFF&",
        highlight_color="&H0000FFFF&",
    )
    cand = HighlightCandidate(
        candidate_id="c_col",
        video_id="v_col",
        start_seconds=0.0,
        end_seconds=5.0,
        duration_seconds=5.0,
        score=85.0,
        breakdown=ScoreBreakdown(),
        hook_title="Color Test",
    )
    seg = TranscriptSegment(
        segment_id=1,
        start=0.0,
        end=5.0,
        text="Hello world",
        words=[
            WordTimestamp(word="Hello", start=0.5, end=1.5),
            WordTimestamp(word="world", start=1.6, end=2.5),
        ]
    )
    transcript = Transcript(video_id="v_col", language="en", duration_seconds=5.0, text="Hello world", segments=[seg])
    out_ass = str(tmp_path / "test_colors.ass")
    gen.generate_ass(cand, transcript, out_ass)

    content = open(out_ass, "r", encoding="utf-8").read()
    # Ensure no malformed double ampersands
    assert "&&" not in content
    assert "{\\c&H" in content


