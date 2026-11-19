"""
Safe and atomic file operations with Windows file locking resilience.
Handles transient locks by virus scanners, previewers, and concurrent readers
using bounded exponential backoff.
"""

from typing import Optional, Callable
import os
import errno
import shutil
import time
import logging

logger = logging.getLogger(__name__)


def safe_remove(path: str, max_attempts: int = 5, initial_delay: float = 0.05) -> bool:
    """
    Safely removes a file, retrying on transient Windows file lock errors (WinError 32).
    Returns True if removed or did not exist, False if failed after max_attempts.
    """
    if not path or not os.path.exists(path):
        return True

    delay = initial_delay
    for attempt in range(max_attempts):
        try:
            os.remove(path)
            return True
        except (PermissionError, OSError) as exc:
            if attempt == max_attempts - 1:
                logger.warning(f"Failed to remove file after {max_attempts} attempts: {path} ({exc})")
                return False
            time.sleep(delay)
            delay = min(delay * 2, 0.5)

    return not os.path.exists(path)


def safe_rmtree(path: str, max_attempts: int = 5, initial_delay: float = 0.05) -> bool:
    """
    Safely removes a directory tree, retrying on transient Windows file locks.
    """
    if not path or not os.path.exists(path):
        return True

    delay = initial_delay
    for attempt in range(max_attempts):
        try:
            shutil.rmtree(path, ignore_errors=False)
            return True
        except (PermissionError, OSError) as exc:
            if attempt == max_attempts - 1:
                # Last resort fallback with ignore_errors=True
                shutil.rmtree(path, ignore_errors=True)
                return not os.path.exists(path)
            time.sleep(delay)
            delay = min(delay * 2, 0.5)

    return not os.path.exists(path)


def atomic_replace(src: str, dst: str, max_attempts: int = 5, initial_delay: float = 0.05) -> str:
    """
    Atomically moves/replaces src to dst.
    On Windows, os.replace can fail if dst is locked by a reader; this function
    retries with bounded backoff.
    Guarantees destination directory exists.
    """
    if not os.path.exists(src):
        raise FileNotFoundError(f"Source file does not exist: {src}")

    dst_dir = os.path.dirname(os.path.abspath(dst))
    os.makedirs(dst_dir, exist_ok=True)

    delay = initial_delay
    for attempt in range(max_attempts):
        try:
            os.replace(src, dst)
            return dst
        except (PermissionError, OSError) as exc:
            is_cross_device = getattr(exc, "errno", None) == errno.EXDEV
            if attempt == max_attempts - 1:
                # Only fall back to copy+remove on cross-device links (EXDEV),
                # never silently bypass PermissionError on read-only targets.
                if is_cross_device:
                    try:
                        shutil.copy2(src, dst)
                        safe_remove(src)
                        return dst
                    except Exception as copy_exc:
                        raise OSError(
                            f"Failed atomic replacement from '{src}' to '{dst}' after {max_attempts} attempts: {exc} (copy fallback also failed: {copy_exc})"
                        ) from exc
                raise PermissionError(
                    f"Failed atomic replacement from '{src}' to '{dst}' after {max_attempts} attempts: {exc}"
                ) from exc
            time.sleep(delay)
            delay = min(delay * 2, 0.5)

    return dst
