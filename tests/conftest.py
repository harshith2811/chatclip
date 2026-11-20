"""
Pytest configuration and environment fixtures for YT Clipping Intelligence.
"""

import os
import tempfile
from pathlib import Path
import pytest

# Server services are constructed during collection, before fixtures run.
# Give those services fresh storage rather than the operator's workspace data.
_test_data_root = Path(tempfile.mkdtemp(prefix="yt-clip-tests-"))
for _variable, _relative in {
    "DATA_DIR": "", "ASSETS_DIR": "assets", "OUTPUT_DIR": "rendered_clips",
    "RENDERED_CLIPS_DIR": "rendered_clips", "CLIPS_DIR": "rendered_clips",
    "DATABASE_PATH": "jobs.db", "DB_PATH": "jobs.db",
    "TRANSCRIPTS_DIR": "transcripts", "HEATMAPS_DIR": "heatmaps",
    "TEMP_DIR": "temp", "RIGHTS_LEDGER_PATH": "rights_ledger.json",
    "AUTOPOST_INBOX": "autopost_inbox",
}.items():
    os.environ[_variable] = str(_test_data_root / _relative)

# Ensure testing execution mode for synthetic test harnesses
os.environ.setdefault("YT_EXECUTION_MODE", "test")
os.environ.setdefault("YT_ALLOW_SYNTHETIC", "1")


@pytest.fixture(autouse=True)
def enforce_rights_by_default(monkeypatch):
    """Keep local dotenv settings from disabling rights regression checks.

    Tests of the explicit bypass can override this with monkeypatch themselves.
    """
    monkeypatch.setenv("LEGAL_OFFICER", "true")
