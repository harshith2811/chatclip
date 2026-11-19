"""
Unit tests for YouTube Clipping Intelligence Web Studio Dashboard & REST API.
"""

import os
import glob
import shutil
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from yt_clipping.web.server import app, active_render_jobs
from yt_clipping.cli.commands.studio import cmd_studio


@pytest.fixture
def client():
    return TestClient(app)


def test_studio_dashboard_serves_html(client):
    """Verifies that root '/' returns the live interactive studio dashboard HTML."""
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "YouTube Clipping Intelligence Platform" in response.text
    assert "Live Studio" in response.text
    assert "btn-preview" in response.text
    assert "btn-primary" in response.text


def test_studio_health_endpoint(client):
    """Verifies that '/api/v1/health' returns system diagnostics, GPU readiness, and model status."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "timestamp" in data
    assert "gpu_available" in data
    assert "ffmpeg_ready" in data
    assert "models" in data
    assert "yunet_onnx" in data["models"]
    assert "yolov8n_seg" in data["models"]
    assert "gemini_active" in data["models"]
    assert "storage" in data
    assert "clips_count" in data["storage"]


def test_studio_clips_list_endpoint(client):
    """Verifies that '/api/v1/clips' returns a JSON list of rendered clips."""
    response = client.get("/api/v1/clips")
    assert response.status_code == 200
    clips = response.json()
    assert isinstance(clips, list)
    if clips:
        clip = clips[0]
        assert "filename" in clip
        assert "url" in clip
        assert "size_mb" in clip


def test_studio_render_status_not_found(client):
    """Verifies that requesting a nonexistent task ID returns 404."""
    response = client.get("/api/v1/render/status/nonexistent-task-999")
    assert response.status_code == 404
    assert "Task ID not found" in response.json()["detail"]


def test_studio_render_status_existing(client):
    """Verifies that querying a known active task ID returns progress and status."""
    active_render_jobs["test-task-123"] = {
        "task_id": "test-task-123",
        "video_id": "test_vid",
        "status": "IN_PROGRESS",
        "progress": 65,
        "message": "Applying face tracking...",
    }
    try:
        response = client.get("/api/v1/render/status/test-task-123")
        assert response.status_code == 200
        data = response.json()
        assert data["task_id"] == "test-task-123"
        assert data["status"] == "IN_PROGRESS"
        assert data["progress"] == 65
    finally:
        active_render_jobs.pop("test-task-123", None)


def test_studio_preview_invalid_url(client):
    """Verifies that invalid video identifiers are rejected with 400."""
    response = client.post("/api/v1/preview", json={"video_id_or_url": "invalid!id"})
    assert response.status_code == 400


def test_cmd_studio_invocation():
    """Verifies that cmd_studio parses host and port and invokes start_server."""
    args = MagicMock()
    args.host = "127.0.0.1"
    args.port = 8888

    with patch("yt_clipping.cli.commands.studio.start_server") as mock_start:
        ret = cmd_studio(args)
        assert ret == 0
        mock_start.assert_called_once_with(host="127.0.0.1", port=8888)


def test_api_metadata_endpoint(client):
    """Verifies that POST /api/v1/metadata returns enriched video information."""
    # Test invalid URL
    bad_res = client.post("/api/v1/metadata", json={"video_id_or_url": "invalid_url_here"})
    assert bad_res.status_code == 400

    # Test valid mock video metadata
    mock_info = {
        "video_id": "nEaJMdM1djM",
        "title": "Mock Video Title",
        "description": "Mock Description",
        "channel_title": "Mock Channel",
        "view_count": 1000,
        "like_count": 50,
        "comment_count": 10,
        "duration": 120.0,
        "canonical_url": "https://www.youtube.com/watch?v=nEaJMdM1djM",
        "metadata_provider": "youtube_data_api_v3",
        "extraction_status": "success",
    }
    with patch("yt_clipping.web.server.metadata_service.get_metadata") as mock_get:
        from yt_clipping.discovery.video_metadata import EnrichedVideoInfo
        mock_get.return_value = EnrichedVideoInfo.from_dict(mock_info)
        res = client.post("/api/v1/metadata", json={"video_id_or_url": "nEaJMdM1djM"})
        assert res.status_code == 200
        data = res.json()
        assert data["video_id"] == "nEaJMdM1djM"
        assert data["title"] == "Mock Video Title"


def test_api_jobs_and_cancellation(client):
    """Verifies job status and cancellation endpoints."""
    reg_res = client.post(
        "/api/v1/rights/register",
        json={
            "video_id": "nEaJMdM1djM",
            "basis": "OWNED",
            "status": "VERIFIED",
            "owner": "Studio Fixture Owner",
            "proof_reference": "test-fixture-owned-render-job",
        },
    )
    assert reg_res.status_code == 200

    # Trigger render
    render_req = {
        "video_id_or_url": "nEaJMdM1djM",
        "max_clips": 1,
        "layout": "active_speaker",
        "subtitle_preset": "hormozi",
        "gpu": False,
    }
    with patch("yt_clipping.web.server._run_render_worker"):
        res = client.post("/api/v1/render", json=render_req)
        assert res.status_code == 200
        data = res.json()
        job_id = data["job_id"]
        assert job_id.startswith("job-")

        # Query job status
        job_res = client.get(f"/api/v1/jobs/{job_id}")
        assert job_res.status_code == 200
        job_data = job_res.json()
        assert job_data["job_id"] == job_id
        assert job_data["status"] in ("queued", "discovering", "rendering")

        # Cancel job
        cancel_res = client.post(f"/api/v1/jobs/{job_id}/cancel")
        assert cancel_res.status_code == 200
        assert cancel_res.json()["status"] == "cancelled"


def test_api_job_sse_stream(client):
    """Verifies Server-Sent Events (SSE) streaming endpoint."""
    # Non-existent job
    err_res = client.get("/api/v1/jobs/missing-job/stream")
    assert err_res.status_code == 200
    assert "event: error" in err_res.text

    reg_res = client.post(
        "/api/v1/rights/register",
        json={
            "video_id": "nEaJMdM1djM",
            "basis": "OWNED",
            "status": "VERIFIED",
            "owner": "Studio Fixture Owner",
            "proof_reference": "test-fixture-owned-sse-stream",
        },
    )
    assert reg_res.status_code == 200

    # Existing completed/cancelled job
    render_req = {
        "video_id_or_url": "nEaJMdM1djM",
        "max_clips": 1,
        "layout": "active_speaker",
        "subtitle_preset": "hormozi",
        "gpu": False,
    }
    with patch("yt_clipping.web.server._run_render_worker"):
        res = client.post("/api/v1/render", json=render_req)
        job_id = res.json()["job_id"]
        # Cancel so it ends stream promptly
        client.post(f"/api/v1/jobs/{job_id}/cancel")

        stream_res = client.get(f"/api/v1/jobs/{job_id}/stream")
        assert stream_res.status_code == 200
        assert "data:" in stream_res.text
        assert "event: end" in stream_res.text


def test_api_projects_endpoints(client):
    """Verifies GET /api/v1/projects endpoint."""
    res = client.get("/api/v1/projects")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_api_media_range_streaming(client, tmp_path):
    """Verifies that media endpoint supports HTTP Range 206 Partial Content requests for seeking."""
    import os
    test_file = tmp_path / "test_stream.mp4"
    # Create 10000 bytes dummy mp4
    test_content = b"0123456789" * 1000
    test_file.write_bytes(test_content)

    from yt_clipping.orchestration.project_store import ClipSidecarRecord
    from yt_clipping.web.server import project_store

    sidecar = ClipSidecarRecord(
        clip_id="test_stream_id",
        project_id="proj_test",
        video_id="v_test",
        file_path=str(test_file),
        relative_url="/clips/test_stream.mp4",
        start_seconds=0.0,
        end_seconds=10.0,
        duration_seconds=10.0,
        score=85.0,
        file_size_bytes=len(test_content),
    )
    project_store.save_clip_sidecar(sidecar)

    # 1. Full stream
    try:
        full_res = client.get("/api/v1/clips/test_stream_id/media")
        assert full_res.status_code == 200
        assert full_res.headers["content-length"] == str(len(test_content))

        # 2. Range request: bytes=0-499
        range_res = client.get("/api/v1/clips/test_stream_id/media", headers={"Range": "bytes=0-499"})
        assert range_res.status_code == 206
        assert range_res.headers["content-length"] == "500"
        assert range_res.headers["content-range"] == f"bytes 0-499/{len(test_content)}"
        assert range_res.content == test_content[0:500]
    finally:
        import shutil, glob
        shutil.rmtree(project_store.get_project_dir("proj_test"), ignore_errors=True)
        for f in glob.glob(os.path.join(project_store.rendered_clips_dir, "*test_stream_id*")):
            try: os.remove(f)
            except OSError: pass


def test_path_traversal_protection(client):
    """Verifies that path traversal payloads are rejected with 400 Bad Request."""
    bad_clips = [
        "../../etc/passwd",
        "..\\..\\windows\\win.ini",
        "....//....//boot.ini",
    ]
    for bad in bad_clips:
        res = client.get(f"/api/v1/clips/{bad}/download")
        assert res.status_code in (400, 404)


def test_api_regenerate_caption_endpoint(client, tmp_path):
    """Verifies that POST /api/v1/clips/{clip_id}/regenerate_caption creates a fresh caption package."""
    from yt_clipping.orchestration.project_store import ClipSidecarRecord
    from yt_clipping.web.server import project_store

    dummy_file = tmp_path / "dummy.mp4"
    dummy_file.write_bytes(b"dummy mp4 valid content test " * 100)

    sidecar = ClipSidecarRecord(
        clip_id="test_regen_clip",
        project_id="proj_regen",
        video_id="test_mock_video_99",
        file_path=str(dummy_file),
        relative_url="/clips/dummy.mp4",
        start_seconds=10.0,
        end_seconds=35.0,
        duration_seconds=25.0,
        score=88.0,
        file_size_bytes=len(dummy_file.read_bytes()),
        caption_package={"hook_title": "Old Title", "full_copy_caption": "Old Caption"},
        source_metadata={"video_id": "test_mock_video_99", "channel_title": "Tech Creator", "title": "Tech Talk"},
    )
    project_store.save_clip_sidecar(sidecar)

    # 1. Nonexistent clip returns 404
    bad_res = client.post("/api/v1/clips/nonexistent_clip_xyz/regenerate_caption")
    assert bad_res.status_code == 404

    try:
        # 2. Existing clip succeeds and updates sidecar
        res = client.post("/api/v1/clips/test_regen_clip/regenerate_caption")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "regenerated"
        assert "caption_package" in data
        assert "intelligence" in data
        assert data["caption_package"]["hook_title"] != ""
        assert "Tech Creator" in data["caption_package"]["creator_credit"]
    finally:
        import shutil, glob
        shutil.rmtree(project_store.get_project_dir("proj_regen"), ignore_errors=True)
        for f in glob.glob(os.path.join(project_store.rendered_clips_dir, "*test_regen_clip*")):
            try: os.remove(f)
            except OSError: pass
        for f in [os.path.join(project_store.rendered_clips_dir, "dummy.json")]:
            try: os.remove(f)
            except OSError: pass


def test_api_clips_includes_playback_and_validation(client, tmp_path):
    """Verifies GET /api/v1/clips includes playback_url and validation_status."""
    from yt_clipping.orchestration.project_store import ClipSidecarRecord
    from yt_clipping.web.server import project_store

    mp4_file = tmp_path / "pb.mp4"
    mp4_file.write_bytes(b"dummy mp4 content mock test " * 100)

    sidecar = ClipSidecarRecord(
        clip_id="test_clip_playback",
        project_id="proj_pb",
        video_id="vid_pb",
        file_path=str(mp4_file),
        relative_url="/clips/pb.mp4",
        start_seconds=5.0,
        end_seconds=25.0,
        duration_seconds=20.0,
        score=91.0,
        status="COMPLETED",
        file_size_bytes=len(mp4_file.read_bytes()),
    )
    project_store.save_clip_sidecar(sidecar)

    try:
        res = client.get("/api/v1/clips")
        assert res.status_code == 200
        clips = res.json()
        target = next((c for c in clips if c["clip_id"] == "test_clip_playback"), None)
        assert target is not None
        assert target["playback_url"] == "/api/v1/clips/test_clip_playback/media"
        assert target["download_url"] == "/api/v1/clips/test_clip_playback/download"
        assert target["validation_status"] == "COMPLETED"
    finally:
        import shutil, glob
        shutil.rmtree(project_store.get_project_dir("proj_pb"), ignore_errors=True)
        for f in glob.glob(os.path.join(project_store.rendered_clips_dir, "*test_clip_playback*")):
            try: os.remove(f)
            except OSError: pass
        for f in [os.path.join(project_store.rendered_clips_dir, "pb.json")]:
            try: os.remove(f)
            except OSError: pass


def test_api_settings_endpoints(client):
    """Verifies GET and POST /api/v1/settings."""
    res = client.get("/api/v1/settings")
    assert res.status_code == 200
    data = res.json()
    assert "gemini_model" in data
    assert "layout_mode" in data

    # Update settings
    post_res = client.post("/api/v1/settings", json={"contact_email": "ops@customdomain.com"})
    assert post_res.status_code == 200
    assert post_res.json()["settings"]["contact_email"] == "ops@customdomain.com"


def test_api_clip_poster_endpoint(client, tmp_path):
    """Verifies GET /api/v1/clips/{clip_id}/poster returns poster or 404."""
    # Nonexistent
    bad_res = client.get("/api/v1/clips/nonexistent_clip_xyz/poster")
    assert bad_res.status_code == 404






def test_api_trending_top10m_endpoint(client):
    """Verifies GET /api/v1/trending/top10m returns verified 10M+ channel videos."""
    res = client.get("/api/v1/trending/top10m?limit=5")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) > 0
    first = data[0]
    assert "video_id" in first
    assert "channel_subscribers" in first
    assert first["channel_subscribers"] >= 10_000_000
    assert "url" in first


def test_active_job_eviction_protection():
    """Regression test for L12: In-progress jobs must never be evicted from tracking."""
    from yt_clipping.web.server import active_render_jobs, _prune_active_render_jobs, _active_jobs_lock

    with _active_jobs_lock:
        active_render_jobs.clear()
        # Register 120 in-progress jobs
        for i in range(120):
            active_render_jobs[f"active_job_{i}"] = {
                "status": "RENDERING",
                "progress": 50,
                "video_id": f"vid_{i}",
            }
        # Also register 10 completed jobs
        for i in range(10):
            active_render_jobs[f"done_job_{i}"] = {
                "status": "COMPLETED",
                "progress": 100,
                "video_id": f"done_{i}",
            }

    # Prune with max_entries=100
    _prune_active_render_jobs(max_entries=100)

    with _active_jobs_lock:
        # All 120 in-progress jobs MUST still be present
        for i in range(120):
            assert f"active_job_{i}" in active_render_jobs, f"Active job {i} was incorrectly evicted!"
        # Completed jobs should have been pruned
        pruned_completed = [f"done_job_{i}" for i in range(10) if f"done_job_{i}" not in active_render_jobs]
        assert len(pruned_completed) > 0
        active_render_jobs.clear()


def test_active_jobs_thread_safety():
    """Regression test for P06: Concurrent updates to active_render_jobs don't crash with RuntimeError."""
    import threading
    from yt_clipping.web.server import active_render_jobs, _prune_active_render_jobs, _active_jobs_lock

    errors = []

    def writer(tid):
        try:
            for i in range(50):
                with _active_jobs_lock:
                    active_render_jobs[f"job_{tid}_{i}"] = {"status": "RENDERING", "progress": i}
                if i % 10 == 0:
                    _prune_active_render_jobs(max_entries=50)
        except Exception as e:
            errors.append(e)

    def reader():
        try:
            for _ in range(50):
                with _active_jobs_lock:
                    _ = list(active_render_jobs.items())
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=writer, args=(t,)) for t in range(4)]
    threads.extend([threading.Thread(target=reader) for _ in range(4)])
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(errors) == 0, f"Thread safety errors occurred: {errors}"
    with _active_jobs_lock:
        active_render_jobs.clear()


def test_legal_officer_config_endpoints(client):
    """Verifies GET and POST /api/v1/config/legal-officer endpoints."""
    # Test GET
    res = client.get("/api/v1/config/legal-officer")
    assert res.status_code == 200
    data = res.json()
    assert "enabled" in data
    assert "mode" in data

    # Test POST toggle off
    res_off = client.post("/api/v1/config/legal-officer", json={"enabled": False})
    assert res_off.status_code == 200
    assert res_off.json()["enabled"] is False
    assert res_off.json()["mode"] == "UNRESTRICTED_BYPASS"

    # Test POST toggle on
    res_on = client.post("/api/v1/config/legal-officer", json={"enabled": True})
    assert res_on.status_code == 200
    assert res_on.json()["enabled"] is True
    assert res_on.json()["mode"] == "STRICT_COMPLIANCE"


def test_governor_status_endpoint(client):
    """Verifies GET /api/v1/system/governor-status endpoint."""
    res = client.get("/api/v1/system/governor-status")
    assert res.status_code == 200
    data = res.json()
    assert "hardware_concurrency" in data
    assert data["hardware_concurrency"] >= 1
    assert "free_disk_gb" in data
    assert "zero_memory_leak_certified" in data
    assert "legal_officer_enabled" in data


def test_ai_video_tenants_and_jobs_endpoints(client):
    """Verifies GET /api/v1/external/ai-video/tenants and /jobs endpoints."""
    res_t = client.get("/api/v1/external/ai-video/tenants")
    assert res_t.status_code == 200
    assert "tenants" in res_t.json()

    res_j = client.get("/api/v1/external/ai-video/jobs")
    assert res_j.status_code == 200
    assert "jobs" in res_j.json()


def test_routes_studio_and_login_serve_html(client):
    """Verifies that /studio and /login return the expected interfaces."""
    res_studio = client.get("/studio")
    assert res_studio.status_code == 200
    assert "text/html" in res_studio.headers["content-type"]
    assert "YT Clip Studio" in res_studio.text or "Live Studio" in res_studio.text
    assert "themeToggleBtn" in res_studio.text
    assert "navDropdownMenu" in res_studio.text

    res_login = client.get("/login")
    assert res_login.status_code == 200
    assert "text/html" in res_login.headers["content-type"]
    assert "Client & Operator Portal" in res_login.text


def test_docs_hub_endpoints_and_rendering(client):
    """Verifies that /docs, /docs/{file}, and documentation API endpoints operate reliably."""
    # 1. Main documentation hub HTML
    res_docs = client.get("/docs")
    assert res_docs.status_code == 200
    assert "text/html" in res_docs.headers["content-type"]
    assert "Documentation Hub" in res_docs.text

    # 2. Specific document load
    res_readme = client.get("/docs/README.md")
    assert res_readme.status_code == 200
    assert "README.md" in res_readme.text

    # 3. Documentation listing API
    res_list = client.get("/api/v1/docs/list")
    assert res_list.status_code == 200
    data = res_list.json()
    assert "docs" in data
    assert data["total"] > 0
    filenames = [d["filename"] for d in data["docs"]]
    assert "ARCHITECTURE.md" in filenames or "README.md" in filenames

    # 4. Render markdown content endpoint
    res_content = client.get("/api/v1/docs/content/ARCHITECTURE.md")
    assert res_content.status_code == 200
    cdata = res_content.json()
    assert "html" in cdata
    assert "markdown" in cdata
    assert len(cdata["html"]) > 100

    # 5. Path traversal protection
    res_trav = client.get("/api/v1/docs/content/../../etc/passwd")
    assert res_trav.status_code in (403, 404)

    # 6. Swagger API endpoint
    res_swagger = client.get("/api/docs")
    assert res_swagger.status_code == 200




