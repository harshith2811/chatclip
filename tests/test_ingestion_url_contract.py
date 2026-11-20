import pytest

from src.yt_clipping.ingestion.asset_provider import extract_youtube_video_id


@pytest.mark.parametrize("value", [
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://notyoutu.be/dQw4w9WgXcQ",
    "https://youtube.com/watch?v=../../secret",
    "some arbitrary text containing dQw4w9WgXcQ",
    "file:///dQw4w9WgXcQ", None,
])
def test_ingestion_rejects_untrusted_or_malformed_video_references(value):
    with pytest.raises(ValueError):
        extract_youtube_video_id(value)


@pytest.mark.parametrize("value", [
    "dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
    "https://youtube.com/shorts/dQw4w9WgXcQ",
])
def test_ingestion_accepts_supported_video_references(value):
    assert extract_youtube_video_id(value) == "dQw4w9WgXcQ"
