from unittest.mock import Mock

import pytest

from src.yt_clipping.contracts.models import Transcript, TranscriptSegment
from src.yt_clipping.orchestration.pipeline import ClippingPipeline


def test_multi_clip_loads_transcript_before_candidate_detection(tmp_path):
    transcript = Transcript(video_id="video", language="en", duration_seconds=30,
        text="A complete thought.", segments=[TranscriptSegment(segment_id=1,
        start=0, end=30, text="A complete thought.", words=[])])
    transcriber = Mock()
    transcriber.load_from_cache.return_value = transcript
    detector = Mock()
    detector.detect_candidates.return_value = []
    pipeline = ClippingPipeline(rights_policy=Mock(), asset_provider=Mock(),
        transcriber=transcriber, detector=detector, scorer=Mock(), renderer=Mock(),
        verifier=Mock(), publisher=Mock(), journal=Mock(), heatmap_analyzer=Mock(),
        output_dir=str(tmp_path))
    pipeline._assert_rights_valid = Mock()
    with pytest.raises(RuntimeError, match="No valid highlight"):
        pipeline.process_video_multi("video")
    assert detector.detect_candidates.call_args.args[0] is transcript
    transcriber.transcribe.assert_not_called()
