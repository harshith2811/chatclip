"""
Integration and Unit Tests for SupoClip Capabilities and REST Endpoints.
Verifies:
- SupoClipAdapter initialization and status check
- 7 animated caption templates (default, hormozi, mrbeast, minimal, tiktok, neon, podcast)
- 5 workflow models (highlights, series, topic, recap, trailer)
- 4-dimensional virality scoring and hook title synthesis
- ASS subtitle generation with karaoke tags and hook title
- Reframing geometry calculation
- Clip editor actions: trim, split, merge, presets, ZIP packaging
- FastAPI REST endpoints under /api/v1/supoclip/...
"""

import pytest
import os
import subprocess
import uuid
import zipfile
from fastapi.testclient import TestClient

from yt_clipping.web.server import app, CLIPS_DIR, TEMP_DIR
from yt_clipping.supoclip import (
    get_supoclip_adapter,
    CAPTION_TEMPLATES,
    get_template,
    get_template_info,
    WorkflowPlanner,
    WorkflowOptions,
    SupoClipScorer,
    AssSubtitleBuilder,
    SupoClipReframer,
    PLATFORM_PRESETS,
    SupoClipEditorEngine,
)


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(scope="module")
def dummy_video(tmp_path_factory):
    """Generates a 3-second synthetic test video using lavfi."""
    tmp_dir = tmp_path_factory.mktemp("supoclip_fixtures")
    video_path = os.path.join(tmp_dir, "test_supoclip_source.mp4")
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "lavfi",
        "-i", "testsrc=duration=3:size=1280x720:rate=25",
        "-f", "lavfi",
        "-i", "sine=frequency=1000:duration=3",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        video_path,
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    return video_path


# ============================================================================
# Unit Tests for SupoClip Core Modules
# ============================================================================

def test_caption_templates():
    templates = get_template_info()
    assert len(templates) >= 7
    ids = {t["id"] for t in templates}
    for expected in ["default", "hormozi", "mrbeast", "minimal", "tiktok", "neon", "podcast"]:
        assert expected in ids

    # Check Hormozi template specifics
    hormozi = get_template("hormozi")
    assert hormozi["word_box"] is True
    assert hormozi["uppercase"] is True
    assert hormozi["highlight_color"] == "#00FF66"


def test_workflow_planning():
    # 1. Highlights
    h_plan = WorkflowPlanner.plan("highlights", duration=120.0)
    assert h_plan.workflow == "highlights"
    assert len(h_plan.segments) >= 1
    assert "viral_highlight" in h_plan.segments[0].workflow_role

    # 2. Series
    s_plan = WorkflowPlanner.plan("series", duration=150.0, options=WorkflowOptions(part_count=3))
    assert s_plan.workflow == "series"
    assert s_plan.total_parts == 3
    assert s_plan.segments[0].part_number == 1
    assert s_plan.segments[1].part_number == 2
    assert s_plan.segments[2].part_number == 3

    # 3. Topic
    t_plan = WorkflowPlanner.plan("topic", duration=100.0, options=WorkflowOptions(topic="Artificial Intelligence"))
    assert t_plan.workflow == "topic"
    assert len(t_plan.segments) >= 1
    assert "ARTIFICIAL INTELLIGENCE" in t_plan.segments[0].hook_title.upper()

    # 4. Trailer
    tr_plan = WorkflowPlanner.plan("trailer", duration=90.0)
    assert tr_plan.workflow == "trailer"
    assert tr_plan.total_parts == 1
    assert tr_plan.segments[0].workflow_role == "teaser_trailer"

    # 5. Recap
    r_plan = WorkflowPlanner.plan("recap", duration=120.0)
    assert r_plan.workflow == "recap"
    assert r_plan.total_parts == 1
    assert tr_plan.segments[0].duration <= 60.0


def test_virality_scorer():
    text = "The secret truth about making money that nobody ever told you! Stop making this crazy mistake."
    score = SupoClipScorer.score_segment(text, duration=35.0, pacing_wpm=145.0, audio_energy=0.8)
    assert 0 <= score.hook_score <= 25
    assert 0 <= score.engagement_score <= 25
    assert 0 <= score.value_score <= 25
    assert 0 <= score.shareability_score <= 25
    assert round(score.hook_score + score.engagement_score + score.value_score + score.shareability_score, 1) == score.virality_score
    assert len(score.hook_title.split()) >= 3


def test_ass_subtitle_builder():
    words = [
        {"word": "Welcome", "start": 0.0, "end": 0.5},
        {"word": "to", "start": 0.5, "end": 0.8},
        {"word": "the", "start": 0.8, "end": 1.1},
        {"word": "future", "start": 1.1, "end": 1.6},
    ]
    ass_script = AssSubtitleBuilder.generate_ass(
        words=words,
        template_name="hormozi",
        hook_title="SHOCKING REVEAL",
        hook_duration=3.0,
    )
    assert "[Script Info]" in ass_script
    assert "Style: HookTitle" in ass_script
    assert "SHOCKING REVEAL" in ass_script
    assert r"{\k" in ass_script
    assert "FUTURE" in ass_script  # Hormozi forces uppercase


def test_reframer_crop_calculation():
    reframer = SupoClipReframer()
    params = reframer.compute_crop_parameters(
        source_width=1920,
        source_height=1080,
        target_width=1080,
        target_height=1920,
        face_center_x=0.6,
    )
    assert params["crop_h"] == 1080
    assert params["crop_w"] == int(round(1080 * 9 / 16)) or params["crop_w"] == 606 or params["crop_w"] == 608
    assert params["crop_w"] % 2 == 0
    assert 0 <= params["crop_x"] <= (1920 - params["crop_w"])


def test_editor_presets():
    presets = SupoClipEditorEngine.get_presets()
    assert "tiktok" in presets
    assert "reels" in presets
    assert "shorts" in presets
    assert presets["tiktok"]["aspect_ratio"] == "9:16"


def test_editor_trim_and_split(dummy_video, tmp_path):
    trim_out = os.path.join(tmp_path, "trimmed.mp4")
    ok = SupoClipEditorEngine.trim_clip(dummy_video, trim_out, 0.5, 2.0)
    assert ok is True
    assert os.path.exists(trim_out)
    assert os.path.getsize(trim_out) > 0

    p1, p2 = SupoClipEditorEngine.split_clip(dummy_video, str(tmp_path), 1.5, "split_test")
    assert os.path.exists(p1)
    assert os.path.exists(p2)


def test_editor_zip_packaging(dummy_video, tmp_path):
    zip_path = os.path.join(tmp_path, "test_clips.zip")
    clips = [
        {"clip_id": "clip_01", "file_path": dummy_video, "title": "Test Clip 01"},
    ]
    out_zip = SupoClipEditorEngine.create_zip_archive(clips, zip_path, {"test": True})
    assert os.path.exists(out_zip)
    with zipfile.ZipFile(out_zip, "r") as zf:
        names = zf.namelist()
        assert "manifest.json" in names
        assert any(n.startswith("clips/") for n in names)


# ============================================================================
# REST API Endpoint Tests (/api/v1/supoclip/...)
# ============================================================================

def test_api_supoclip_status(client):
    res = client.get("/api/v1/supoclip/status")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ready"
    assert data["engine"] == "supoclip"
    assert data["templates_count"] >= 7
    assert "workflows" in data
    assert "editor_presets" in data


def test_api_supoclip_workflows(client):
    res = client.get("/api/v1/supoclip/workflows")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    wfs = {w["id"] for w in data["workflows"]}
    assert {"highlights", "series", "topic", "recap", "trailer"}.issubset(wfs)


def test_api_supoclip_templates(client):
    res = client.get("/api/v1/supoclip/templates")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    t_ids = {t["id"] for t in data["templates"]}
    assert {"default", "hormozi", "mrbeast", "tiktok", "neon"}.issubset(t_ids)


def test_api_supoclip_fonts(client):
    res = client.get("/api/v1/supoclip/fonts")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert isinstance(data["fonts"], list)
    assert len(data["fonts"]) > 0


def test_api_supoclip_score(client):
    res = client.post(
        "/api/v1/supoclip/score",
        json={
            "text": "The greatest secret to building an audience in 2026! Never make this rookie mistake.",
            "duration": 30.0,
            "pacing_wpm": 150.0,
            "audio_energy": 0.75,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    score = data["score"]
    assert "hook_score" in score
    assert "virality_score" in score
    assert "hook_title" in score


def test_api_supoclip_plan(client):
    res = client.post(
        "/api/v1/supoclip/plan",
        json={
            "workflow": "series",
            "duration": 180.0,
            "options": {"part_count": 3},
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["plan"]["workflow"] == "series"
    assert data["plan"]["total_parts"] == 3


def test_api_supoclip_editor_presets(client):
    res = client.get("/api/v1/supoclip/editor/presets")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "tiktok" in data["presets"]
    assert "reels" in data["presets"]


def test_api_supoclip_render(client, dummy_video):
    res = client.post(
        "/api/v1/supoclip/render",
        json={
            "source_path": dummy_video,
            "start_time": 0.0,
            "end_time": 2.0,
            "template_name": "hormozi",
            "hook_title": "SECRET HACK",
            "words": [
                {"word": "SECRET", "start": 0.0, "end": 0.5},
                {"word": "STRATEGY", "start": 0.5, "end": 1.5},
            ],
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "rendered_file" in data
    assert os.path.exists(data["file_path"])
    assert os.path.getsize(data["file_path"]) > 0


def test_api_supoclip_editor_trim(client, dummy_video):
    res = client.post(
        "/api/v1/supoclip/editor/trim",
        json={
            "source_path": dummy_video,
            "start_time": 0.0,
            "end_time": 1.5,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "trimmed_file" in data
    assert os.path.exists(data["file_path"])


def test_api_supoclip_editor_split(client, dummy_video):
    res = client.post(
        "/api/v1/supoclip/editor/split",
        json={
            "source_path": dummy_video,
            "split_timestamp": 1.5,
            "base_name": "api_test_split",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "part1_file" in data
    assert "part2_file" in data
    assert "api_test_split_part1" in data["part1_file"]
    assert "api_test_split_part2" in data["part2_file"]


def test_api_supoclip_editor_merge(client, dummy_video):
    res = client.post(
        "/api/v1/supoclip/editor/merge",
        json={
            "clip_paths": [dummy_video, dummy_video],
            "target_filename": "api_test_merged.mp4",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["merged_file"] == "api_test_merged.mp4"
    assert os.path.exists(data["file_path"])


def test_api_supoclip_render_invalid_timestamps(client, dummy_video):
    res = client.post(
        "/api/v1/supoclip/render",
        json={
            "source_path": dummy_video,
            "start_time": 2.5,
            "end_time": 1.0,
        },
    )
    assert res.status_code == 400


def test_api_supoclip_trim_invalid_timestamps(client, dummy_video):
    res = client.post(
        "/api/v1/supoclip/editor/trim",
        json={
            "source_path": dummy_video,
            "start_time": 2.0,
            "end_time": 1.0,
        },
    )
    assert res.status_code == 400


def test_api_supoclip_score_empty_text(client):
    res = client.post(
        "/api/v1/supoclip/score",
        json={
            "text": "   ",
            "duration": 30.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["score"]["virality_score"] == 0.0


def test_plan_with_transcript_scoring():
    transcript = [
        {"start": 0.0, "end": 20.0, "text": "Just introductory casual talk with no real substance."},
        {"start": 25.0, "end": 55.0, "text": "The secret truth about money and why everyone makes this insane mistake!"},
        {"start": 60.0, "end": 85.0, "text": "In conclusion, remember these key steps for your growth strategy."},
    ]
    plan = WorkflowPlanner.plan("highlights", duration=90.0, transcript_segments=transcript)
    assert len(plan.segments) >= 1
    # Highest scoring segment should be selected
    top_seg = plan.segments[0]
    assert top_seg.start_time == 25.0
    assert "MISTAKE" in top_seg.hook_title.upper() or "SECRET" in top_seg.hook_title.upper()


def test_reframer_narrow_video_crop():
    reframer = SupoClipReframer()
    # 600x1200 is narrower than 9:16
    params = reframer.compute_crop_parameters(600, 1200, 1080, 1920)
    assert params["crop_w"] <= 600
    assert params["crop_h"] <= 1200
    assert params["crop_x"] >= 0 and (params["crop_x"] + params["crop_w"] <= 600)
    assert params["crop_y"] >= 0 and (params["crop_y"] + params["crop_h"] <= 1200)


def test_api_supoclip_export_zip(client, dummy_video):
    res = client.get("/api/v1/supoclip/export/zip")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"
    assert len(res.content) > 0
