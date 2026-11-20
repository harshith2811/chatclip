"""Studio must never advertise a failed export as a completed clip."""

from types import SimpleNamespace
from unittest.mock import Mock

from src.yt_clipping.web import server


def test_studio_excludes_failed_validation(tmp_path, monkeypatch):
    artifact = tmp_path / "broken.mp4"
    artifact.write_bytes(b"corrupt")
    job = SimpleNamespace(
        job_id="failed-export", candidate=None, qa_report=None,
        rendered_clip=SimpleNamespace(file_path=str(artifact), duration_seconds=30),
    )
    pipeline = Mock()
    pipeline.process_video_multi.return_value = [job]
    monkeypatch.setattr(server, "build_pipeline", lambda **kwargs: pipeline)
    metadata = Mock()
    metadata.get_metadata.return_value = None
    monkeypatch.setattr(server, "metadata_service", metadata)
    projects = Mock()
    projects.create_or_get_project.return_value = SimpleNamespace(project_id="project")
    monkeypatch.setattr(server, "project_store", projects)
    policy = SimpleNamespace(assert_can_process=Mock())
    monkeypatch.setattr(server, "LocalRightsPolicy", Mock(return_value=policy))
    validation = Mock(return_value={"valid": False, "status": "FAILED", "errors": ["corrupt"]})
    monkeypatch.setattr(server, "validate_rendered_short", validation)

    assert server._render_video_pipeline("video", {"gpu": False}) == []
    assert validation.call_args.kwargs["strict"] is True
    projects.save_clip_sidecar.assert_not_called()
