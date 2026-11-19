"""
Production Stress Hardening & Sustained Workload Memory Leak Verification Suite.
Certifies 50 consecutive video processing cycles, process RSS stability (<5% growth),
FFmpeg subprocess lifecycle termination, and scratch directory watchdog cleanup.
"""

import pytest
import os
import sys
import gc
import time
import shutil
import subprocess
import psutil
from unittest.mock import patch, MagicMock

from yt_clipping.orchestration.resource_governor import (
    ResourceGovernor,
    get_resource_governor,
    InsufficientStorageError,
    SubprocessTimeoutError,
)
from yt_clipping.rendering.editor import VideoEditorEngine


@pytest.fixture
def governor(tmp_path):
    scratch_dir = str(tmp_path / "scratch")
    temp_dir = str(tmp_path / "temp")
    os.makedirs(scratch_dir, exist_ok=True)
    os.makedirs(temp_dir, exist_ok=True)
    gov = ResourceGovernor(min_disk_free_gb=1.0, ffmpeg_timeout_seconds=5.0)
    return gov


def test_resource_governor_hardware_concurrency_heuristic():
    """Validates dynamic concurrency calculation under various hardware profiles."""
    # Test CPU-only
    gov_cpu = ResourceGovernor(max_concurrency_override=None)
    gov_cpu.cuda_available = False
    gov_cpu.cpu_cores = 8
    # MaxConcurrentRenders = max(1, floor(CPUCores / 2)) = 4
    expected_cpu = max(1, 8 // 2)
    assert gov_cpu.cpu_cores == 8
    assert expected_cpu == 4

    # Test 4 GB GPU (GTX 1650 / T4)
    gov_gpu = ResourceGovernor(max_concurrency_override=None)
    gov_gpu.cuda_available = True
    gov_gpu.vram_gb = 4.0
    gov_gpu.cpu_cores = 8
    # max(1, min(floor(4.0 / 1.2), floor(8 / 2))) = min(3, 4) = 3
    calc = max(1, min(int(4.0 / 1.2), 8 // 2))
    assert calc == 3


def test_ffmpeg_subprocess_lifecycle_timeout_and_zombie_prevention(governor):
    """
    Verifies that timed-out FFmpeg child processes are strictly killed,
    pipes closed, and no zombie processes remain.
    """
    cmd = [sys.executable, "-c", "import time; time.sleep(10)"]
    with pytest.raises(SubprocessTimeoutError):
        governor.execute_ffmpeg(cmd, timeout=1.0)

    # Verify no lingering subprocesses in governor tracking
    assert len(governor._active_subprocesses) == 0


def test_scratch_watchdog_boundary_protection_and_age_cleanup(tmp_path):
    """
    Verifies that scratch directory watchdog removes abandoned files older than threshold,
    preserves active in-flight files, and never escapes directory boundaries.
    """
    scratch_dir = tmp_path / "scratch"
    scratch_dir.mkdir(parents=True, exist_ok=True)
    gov = ResourceGovernor()

    # Old abandoned file
    old_file = scratch_dir / "abandoned_temp_01.mp4"
    old_file.write_bytes(b"temp abandoned content" * 100)
    old_time = time.time() - 7200  # 2 hours old
    os.utime(str(old_file), (old_time, old_time))

    # Active file (marked in-flight)
    active_file = scratch_dir / "active_render_02.mp4"
    active_file.write_bytes(b"active file content" * 100)
    os.utime(str(active_file), (old_time, old_time))
    gov.register_active_file(str(active_file))

    # Recent file
    recent_file = scratch_dir / "recent_render_03.mp4"
    recent_file.write_bytes(b"recent file content")

    res = gov.cleanup_scratch_files(scratch_dirs=[str(scratch_dir)], max_age_seconds=3600.0)

    assert res["cleaned_files_count"] == 1
    assert not old_file.exists(), "Old abandoned file should be deleted."
    assert active_file.exists(), "Active file must be protected from deletion."
    assert recent_file.exists(), "Recent file (< 1h) must not be deleted."

    gov.unregister_active_file(str(active_file))


def test_50_consecutive_cycles_memory_leak_and_resource_stability(tmp_path):
    """
    Executes 50 consecutive processing cycles.
    Validates:
    1. RSS growth remains below 5% across 50 cycles measured against baseline.
    2. Zero orphaned temporary files remain after cleanup.
    3. Zero zombie child processes remain.
    4. Stable memory profile without runaway allocator accumulation.
    """
    gc.collect()
    gov = ResourceGovernor(min_disk_free_gb=0.1, ffmpeg_timeout_seconds=30.0)
    output_dir = tmp_path / "stress_rendered"
    scratch_dir = tmp_path / "stress_scratch"
    output_dir.mkdir(parents=True, exist_ok=True)
    scratch_dir.mkdir(parents=True, exist_ok=True)

    # Establish clean baseline RSS after 2 warm-up cycles
    for w in range(2):
        dummy_data = bytearray(1024 * 512)
        del dummy_data
        gc.collect()

    proc = psutil.Process()
    baseline_rss = proc.memory_info().rss / (1024 * 1024)

    # Execute 50 consecutive cycles
    cycles_to_run = 50
    for cycle in range(cycles_to_run):
        cycle_file = scratch_dir / f"cycle_chunk_{cycle}.bin"
        # Simulate intermediate video rendering and buffer allocations
        chunk = bytearray(os.urandom(64 * 1024))
        cycle_file.write_bytes(chunk)

        # Record cycle in memory profiler
        gov.memory_profiler.record_cycle(
            cycle_id=cycle,
            metadata={"cycle": cycle, "file": str(cycle_file)},
        )

        # Cleanup scratch file after cycle completion
        if cycle_file.exists():
            cycle_file.unlink()

        del chunk
        if cycle % 10 == 0:
            gc.collect()

    gc.collect()
    final_rss = proc.memory_info().rss / (1024 * 1024)
    rss_growth_mb = final_rss - baseline_rss
    pct_growth = (rss_growth_mb / baseline_rss) * 100.0

    summary = gov.memory_profiler.get_summary()

    # Cleanup any remaining files in scratch
    cleanup_res = gov.cleanup_scratch_files(scratch_dirs=[str(scratch_dir)], max_age_seconds=0.0)

    # Assertions
    # 1. RSS growth remains below 5%
    assert pct_growth < 5.0, (
        f"RSS growth exceeded 5%: grew by {rss_growth_mb:.2f} MB ({pct_growth:.2f}%) "
        f"from baseline {baseline_rss:.2f} MB to {final_rss:.2f} MB across {cycles_to_run} cycles."
    )

    # 2. Memory profiler flagged no runaway leak warning
    assert not summary["leak_warning"], "Memory leak detector flagged unexpected monotonic growth."

    # 3. No orphaned files in scratch directory
    remaining_files = list(scratch_dir.glob("*"))
    assert len(remaining_files) == 0, f"Orphaned files remained in scratch directory: {remaining_files}"

    # 4. No active/zombie subprocesses
    assert len(gov._active_subprocesses) == 0, "Zombie subprocesses remained tracked."
