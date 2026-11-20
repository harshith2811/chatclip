from pathlib import Path

import pytest
from fastapi import HTTPException

from src.yt_clipping.web import server


def test_media_path_requires_true_directory_containment(tmp_path, monkeypatch):
    allowed = tmp_path / "data"
    sibling = tmp_path / "data_evil"
    allowed.mkdir()
    sibling.mkdir()
    inside = allowed / "clip.mp4"
    outside = sibling / "clip.mp4"
    inside.write_bytes(b"inside")
    outside.write_bytes(b"outside")
    monkeypatch.setattr(server, "DATA_DIR", str(allowed))
    monkeypatch.setattr(server, "CLIPS_DIR", str(allowed / "clips"))
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)

    assert Path(server._assert_path_in_data_dir(str(inside))) == inside.resolve()
    with pytest.raises(HTTPException) as exc:
        server._assert_path_in_data_dir(str(outside))
    assert exc.value.status_code == 403
