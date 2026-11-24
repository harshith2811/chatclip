import pytest

from src.yt_clipping.contracts.models import Transcript
from src.yt_clipping.detection.segmenter import ContextAwareSegmenter
from src.yt_clipping.web.schemas import PreviewRequest, RenderRequest


def test_candidate_ids_are_stable_across_preview_and_render_passes():
    transcript = Transcript(
        video_id="stable12345",
        language="en",
        duration_seconds=180.0,
        text="",
        segments=[],
    )
    segmenter = ContextAwareSegmenter()

    first = segmenter.detect_candidates(transcript)
    second = segmenter.detect_candidates(transcript)

    assert [candidate.candidate_id for candidate in first] == [candidate.candidate_id for candidate in second]
    assert len(first) > 1


def test_render_and_preview_clip_counts_are_bounded():
    assert PreviewRequest(video_id_or_url="stable12345", max_clips=24).max_clips == 24
    assert RenderRequest(video_id_or_url="stable12345", max_clips=8).fill_to_target is True

    with pytest.raises(ValueError):
        RenderRequest(video_id_or_url="stable12345", max_clips=25)

    with pytest.raises(ValueError):
        PreviewRequest(video_id_or_url="stable12345", max_clips=0)
