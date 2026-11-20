"""
Tests for media QA verification: structural stream validation, duration tolerances, and error classification.
"""

import pytest
import os
from src.yt_clipping.contracts.models import RenderedClip, HighlightCandidate, ScoreBreakdown
from src.yt_clipping.qa.verifier import MediaQualityVerifier


@pytest.mark.parametrize("overrides", [
    {"has_audio": False}, {"width": 1920, "height": 1080},
    {"duration": 0}, {"duration": 33}, {"video_codec": "vp9"},
    {"pixel_format": "yuv444p"}, {"audio_codec": "opus"},
])
def test_strict_short_validation_rejects_unusable_outputs(tmp_path, monkeypatch, overrides):
    from src.yt_clipping.qa.verifier import validate_rendered_short

    artifact = tmp_path / "short.mp4"
    artifact.write_bytes(b"x" * 2048)
    probe = dict(readable=True, has_video=True, has_audio=True,
                 width=1080, height=1920, duration=30, fps=30)
    probe.update(overrides)
    monkeypatch.setattr(MediaQualityVerifier, "_probe_media", lambda self, path: probe)
    result = validate_rendered_short(str(artifact), expected_duration=30, strict=True)
    assert result["valid"] is False
    assert result["status"] == "FAILED"


def test_opencv_fallback_does_not_invent_audio(monkeypatch):
    from unittest.mock import Mock
    import cv2

    def missing_binary(*args, **kwargs):
        raise FileNotFoundError("probe unavailable")

    monkeypatch.setattr("src.yt_clipping.qa.verifier.subprocess.run", missing_binary)
    capture = Mock()
    capture.isOpened.return_value = True
    capture.get.side_effect = lambda key: {
        cv2.CAP_PROP_FPS: 30, cv2.CAP_PROP_FRAME_COUNT: 900,
        cv2.CAP_PROP_FRAME_WIDTH: 1080, cv2.CAP_PROP_FRAME_HEIGHT: 1920,
    }[key]
    capture.read.return_value = (True, object())
    monkeypatch.setattr(cv2, "VideoCapture", lambda _: capture)
    probe = MediaQualityVerifier(strict=True)._probe_media("video.mp4")
    assert probe["has_video"] is True
    assert probe["has_audio"] is False
    capture.release.assert_called_once()


@pytest.mark.parametrize("has_audio,duration", [(False, 30.0), (True, 31.5)])
def test_strict_qa_rejects_silent_or_out_of_tolerance_export(tmp_path, monkeypatch, has_audio, duration):
    artifact = tmp_path / "export.mp4"
    artifact.write_bytes(b"x" * 2048)
    clip = RenderedClip(
        clip_id="clip", job_id="job", candidate_id="candidate",
        file_path=str(artifact), file_hash="", duration_seconds=30.0,
        width=1080, height=1920, manifest_path="", rendered_at="",
    )
    candidate = HighlightCandidate(
        candidate_id="candidate", video_id="video", start_seconds=0.0,
        end_seconds=30.0, duration_seconds=30.0, score=80,
        breakdown=ScoreBreakdown(), hook_title="Hook",
    )
    verifier = MediaQualityVerifier(strict=True)
    monkeypatch.setattr(verifier, "_probe_media", lambda _: {
        "readable": True, "has_video": True, "has_audio": has_audio,
        "duration": duration, "width": 1080, "height": 1920,
    })
    report = verifier.verify_clip(clip, candidate)
    assert report.status == "FAILED"
    assert any(("Missing audio" if not has_audio else "Duration mismatch") in e for e in report.errors)


def test_qa_verifier_passes_valid_artifact(tmp_path):
    verifier = MediaQualityVerifier(strict=False)
    test_mp4 = str(tmp_path / "valid_clip.mp4")

    # Create dummy mp4 file with standard ftyp box
    with open(test_mp4, "wb") as f:
        f.write(b'\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2mp41' + (b'\x00' * 5000))

    clip = RenderedClip(
        clip_id="c1",
        job_id="j1",
        candidate_id="cand1",
        file_path=test_mp4,
        file_hash="",
        duration_seconds=35.0,
        width=1080,
        height=1920,
        manifest_path="manifest.json",
        rendered_at="2026-10-29T12:00:00Z",
    )
    cand = HighlightCandidate(
        candidate_id="cand1",
        video_id="v1",
        start_seconds=0.0,
        end_seconds=35.0,
        duration_seconds=35.0,
        score=85.0,
        breakdown=ScoreBreakdown(),
        hook_title="Test Hook",
    )

    report = verifier.verify_clip(clip, cand)
    assert report.status in ["PASSED", "WARNING"]
    assert report.video_stream_ok is True
    assert report.file_size_bytes > 1024
    assert len(report.errors) == 0


def test_qa_verifier_strict_rejects_corrupted_container(tmp_path):
    verifier = MediaQualityVerifier(strict=True)
    test_mp4 = str(tmp_path / "corrupt_clip.mp4")
    with open(test_mp4, "wb") as f:
        f.write(b'\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2mp41' + (b'\x00' * 5000))

    clip = RenderedClip(
        clip_id="c_corrupt",
        job_id="j_corrupt",
        candidate_id="cand_corrupt",
        file_path=test_mp4,
        file_hash="",
        duration_seconds=35.0,
        width=1080,
        height=1920,
        manifest_path="manifest.json",
        rendered_at="2026-10-29T12:00:00Z",
    )
    cand = HighlightCandidate(
        candidate_id="cand_corrupt",
        video_id="v1",
        start_seconds=0.0,
        end_seconds=35.0,
        duration_seconds=35.0,
        score=85.0,
        breakdown=ScoreBreakdown(),
        hook_title="Corrupt Hook",
    )

    report = verifier.verify_clip(clip, cand)
    assert report.status == "FAILED"
    assert any("unreadable or corrupted" in e for e in report.errors)


def test_qa_verifier_fails_missing_file():
    verifier = MediaQualityVerifier()
    clip = RenderedClip(
        clip_id="c_missing",
        job_id="j_missing",
        candidate_id="cand_missing",
        file_path="non_existent_file.mp4",
        file_hash="",
        duration_seconds=30.0,
        width=1080,
        height=1920,
        manifest_path="manifest.json",
        rendered_at="2026-10-29T12:00:00Z",
    )
    cand = HighlightCandidate(
        candidate_id="cand_missing",
        video_id="v1",
        start_seconds=0.0,
        end_seconds=30.0,
        duration_seconds=30.0,
        score=80.0,
        breakdown=ScoreBreakdown(),
        hook_title="Missing",
    )

    report = verifier.verify_clip(clip, cand)
    assert report.status == "FAILED"
    assert "does not exist" in report.errors[0]


def test_qa_verifier_fails_empty_file(tmp_path):
    verifier = MediaQualityVerifier(min_file_size_bytes=1024)
    empty_mp4 = str(tmp_path / "empty.mp4")
    with open(empty_mp4, "wb") as f:
        f.write(b"")  # 0 bytes

    clip = RenderedClip(
        clip_id="c_empty",
        job_id="j_empty",
        candidate_id="cand_empty",
        file_path=empty_mp4,
        file_hash="",
        duration_seconds=30.0,
        width=1080,
        height=1920,
        manifest_path="manifest.json",
        rendered_at="2026-10-29T12:00:00Z",
    )
    cand = HighlightCandidate(
        candidate_id="cand_empty",
        video_id="v1",
        start_seconds=0.0,
        end_seconds=30.0,
        duration_seconds=30.0,
        score=80.0,
        breakdown=ScoreBreakdown(),
        hook_title="Empty",
    )

    report = verifier.verify_clip(clip, cand)
    assert report.status == "FAILED"
    assert any("below threshold" in e for e in report.errors)


def test_validate_rendered_short_missing_and_valid(tmp_path):
    from src.yt_clipping.qa.verifier import validate_rendered_short

    # Missing file check
    res_missing = validate_rendered_short(str(tmp_path / "does_not_exist.mp4"))
    assert res_missing["valid"] is False
    assert res_missing["status"] == "FAILED"
    assert res_missing["checks"]["exists"] is False

    # Valid dummy file check
    valid_mp4 = str(tmp_path / "dummy_valid.mp4")
    with open(valid_mp4, "wb") as f:
        f.write(b'\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2mp41' + (b'\x00' * 5000))

    res_valid = validate_rendered_short(valid_mp4, strict=False)
    assert res_valid["checks"]["exists"] is True
    assert res_valid["checks"]["nonzero_size"] is True
    assert res_valid["file_size_bytes"] > 1024
    assert res_valid["sha256"] != ""

