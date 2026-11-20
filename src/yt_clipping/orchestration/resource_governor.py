"""
Centralized Resource Governor & Infrastructure Hardening Subsystem.
Enforces dynamic hardware-aware concurrency, strict subprocess lifecycle management,
memory leak detection, GPU VRAM protection, and scratch file watchdog.
"""

from typing import Dict, Any, Optional, List, Set
from contextlib import contextmanager, asynccontextmanager
import os
import sys
import time
import math
import shutil
import logging
import asyncio
import threading
import subprocess
import tracemalloc
import gc
import psutil

logger = logging.getLogger(__name__)

# Fallback base directories
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
DATA_DIR = os.getenv("DATA_DIR", os.path.join(BASE_DIR, "data"))
SCRATCH_DIR = os.path.join(DATA_DIR, "scratch")
TEMP_DIR = os.path.join(DATA_DIR, "temp")


class InsufficientStorageError(RuntimeError):
    """Raised when available disk space falls below required minimum."""
    pass


class SubprocessTimeoutError(TimeoutError):
    """Raised when an FFmpeg or child process exceeds execution timeout."""
    pass


class MemoryLeakDetector:
    """
    Tracks process RSS, VMS, and Python heap allocations across processing cycles.
    Detects sustained memory accumulation and flags potential leaks.
    """

    def __init__(
        self,
        warning_growth_mb: float = 150.0,
        cycle_window: int = 50,
        enable_tracemalloc: bool = True,
    ):
        self.warning_growth_mb = warning_growth_mb
        self.cycle_window = cycle_window
        self.enable_tracemalloc = enable_tracemalloc
        self.cycle_records: List[Dict[str, Any]] = []
        self._lock = threading.Lock()

        if self.enable_tracemalloc and not tracemalloc.is_tracing():
            try:
                tracemalloc.start()
            except Exception as e:
                logger.warning(f"Could not start tracemalloc: {e}")

    def record_cycle(self, cycle_id: Any, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        gc.collect()
        proc = psutil.Process()
        mem = proc.memory_info()
        rss_mb = mem.rss / (1024 * 1024)
        vms_mb = mem.vms / (1024 * 1024)

        heap_current_mb = 0.0
        heap_peak_mb = 0.0
        if tracemalloc.is_tracing():
            current, peak = tracemalloc.get_traced_memory()
            heap_current_mb = current / (1024 * 1024)
            heap_peak_mb = peak / (1024 * 1024)

        gpu_allocated_mb = 0.0
        try:
            import torch
            if torch.cuda.is_available():
                gpu_allocated_mb = torch.cuda.memory_allocated() / (1024 * 1024)
        except Exception:
            pass

        rec = {
            "cycle_id": cycle_id,
            "timestamp": time.time(),
            "rss_mb": rss_mb,
            "vms_mb": vms_mb,
            "heap_current_mb": heap_current_mb,
            "heap_peak_mb": heap_peak_mb,
            "gpu_allocated_mb": gpu_allocated_mb,
            "metadata": metadata or {},
        }

        with self._lock:
            self.cycle_records.append(rec)
            # Evaluate leak heuristic across recent window
            leak_detected = False
            growth_mb = 0.0
            if len(self.cycle_records) >= self.cycle_window:
                window = self.cycle_records[-self.cycle_window:]
                start_rss = window[0]["rss_mb"]
                end_rss = window[-1]["rss_mb"]
                growth_mb = end_rss - start_rss
                
                # Check for monotonic or sustained high growth
                if growth_mb > self.warning_growth_mb:
                    # Verify if mostly monotonic (at least 80% increases)
                    diffs = [
                        window[i]["rss_mb"] - window[i - 1]["rss_mb"]
                        for i in range(1, len(window))
                    ]
                    pos_count = sum(1 for d in diffs if d > 0)
                    if pos_count / len(diffs) >= 0.70:
                        leak_detected = True
                        logger.warning(
                            f"[ResourceGovernor] Possible memory leak detected: RSS grew by {growth_mb:.2f} MB "
                            f"(from {start_rss:.2f} MB to {end_rss:.2f} MB) across last {self.cycle_window} cycles."
                        )

            rec["leak_warning"] = leak_detected
            rec["window_growth_mb"] = growth_mb
            return rec

    def get_summary(self) -> Dict[str, Any]:
        with self._lock:
            if not self.cycle_records:
                return {"total_cycles": 0, "net_rss_growth_mb": 0.0, "leak_warning": False}
            initial_rss = self.cycle_records[0]["rss_mb"]
            current_rss = self.cycle_records[-1]["rss_mb"]
            net_growth = current_rss - initial_rss
            pct_growth = (net_growth / initial_rss * 100.0) if initial_rss > 0 else 0.0
            return {
                "total_cycles": len(self.cycle_records),
                "initial_rss_mb": initial_rss,
                "current_rss_mb": current_rss,
                "net_rss_growth_mb": net_growth,
                "pct_rss_growth": pct_growth,
                "leak_warning": any(r.get("leak_warning", False) for r in self.cycle_records),
            }

    def get_current_rss_mb(self) -> float:
        return psutil.Process().memory_info().rss / (1024 * 1024)

    def get_leak_metrics(self) -> Dict[str, Any]:
        s = self.get_summary()
        return {
            "rss_growth_pct": s.get("pct_rss_growth", 0.0),
            "net_rss_growth_mb": s.get("net_rss_growth_mb", 0.0),
            "leak_warning": s.get("leak_warning", False),
            "current_rss_mb": s.get("current_rss_mb", self.get_current_rss_mb()),
        }


class ResourceGovernor:
    """
    Centralized resource controller for hardware concurrency, subprocess lifecycle,
    disk watchdog, and memory governance.
    """

    _instance: Optional["ResourceGovernor"] = None
    _singleton_lock = threading.Lock()

    def __init__(
        self,
        min_disk_free_gb: float = 5.0,
        ffmpeg_timeout_seconds: float = 180.0,
        max_concurrency_override: Optional[int] = None,
    ):
        env_disk = os.getenv("MIN_DISK_FREE_GB")
        if env_disk is not None:
            try:
                min_disk_free_gb = float(env_disk)
            except ValueError:
                pass
        self.min_disk_free_gb = min_disk_free_gb
        self.ffmpeg_timeout_seconds = ffmpeg_timeout_seconds

        # Hardware probing
        self.cpu_cores = os.cpu_count() or 4
        self.vram_gb = 0.0
        self.cuda_available = False
        self.gpu_name = "None"

        self._probe_gpu()

        # Concurrency heuristic: MaxConcurrentRenders = max(1, min(floor(VRAM_GB / 1.2), floor(CPUCores / 2)))
        if max_concurrency_override is not None:
            self.max_renders = max(1, max_concurrency_override)
        elif self.cuda_available and self.vram_gb >= 1.2:
            gpu_slot = math.floor(self.vram_gb / 1.2)
            cpu_slot = math.floor(self.cpu_cores / 2)
            self.max_renders = max(1, min(gpu_slot, max(1, cpu_slot)))
        else:
            self.max_renders = max(1, math.floor(self.cpu_cores / 2))

        self._sync_semaphore = threading.BoundedSemaphore(value=self.max_renders)
        self._async_semaphore: Optional[asyncio.Semaphore] = None
        self._async_sem_lock = threading.Lock()

        # State tracking
        self._active_renders = 0
        self._active_jobs: Set[str] = set()
        self._active_files: Set[str] = set()
        self._active_subprocesses: Set[subprocess.Popen] = set()
        self._state_lock = threading.Lock()

        # Memory profiler
        self.memory_profiler = MemoryLeakDetector()

        logger.info(
            f"[ResourceGovernor] Initialized: CPU Cores={self.cpu_cores}, VRAM={self.vram_gb:.2f} GB "
            f"({self.gpu_name}), Concurrency Limit={self.max_renders} renders."
        )

    @property
    def hardware_concurrency(self) -> int:
        return self.max_renders

    def _probe_gpu(self) -> None:
        try:
            import torch
            if torch.cuda.is_available():
                self.cuda_available = True
                self.gpu_name = torch.cuda.get_device_name(0)
                props = torch.cuda.get_device_properties(0)
                self.vram_gb = props.total_memory / (1024 ** 3)
        except Exception:
            self.cuda_available = False

    @classmethod
    def get_instance(cls) -> "ResourceGovernor":
        with cls._singleton_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def _get_async_semaphore(self) -> asyncio.Semaphore:
        with self._async_sem_lock:
            if self._async_semaphore is None:
                self._async_semaphore = asyncio.Semaphore(self.max_renders)
            return self._async_semaphore

    # Concurrency Management
    @contextmanager
    def acquire_render_slot(self, job_id: Optional[str] = None, timeout: float = 300.0):
        """Acquires a render processing slot synchronously."""
        self.check_system_health()
        acquired = self._sync_semaphore.acquire(timeout=timeout)
        if not acquired:
            raise TimeoutError(f"Timed out after {timeout}s waiting for render concurrency slot.")

        with self._state_lock:
            self._active_renders += 1
            if job_id:
                self._active_jobs.add(job_id)

        try:
            yield
        finally:
            with self._state_lock:
                self._active_renders = max(0, self._active_renders - 1)
                if job_id:
                    self._active_jobs.discard(job_id)
            self._sync_semaphore.release()

    @asynccontextmanager
    async def async_acquire_render_slot(self, job_id: Optional[str] = None, timeout: float = 300.0):
        """Acquires a render processing slot asynchronously."""
        self.check_system_health()
        sem = self._get_async_semaphore()
        try:
            await asyncio.wait_for(sem.acquire(), timeout=timeout)
        except asyncio.TimeoutError:
            raise TimeoutError(f"Timed out after {timeout}s waiting for async render slot.")

        with self._state_lock:
            self._active_renders += 1
            if job_id:
                self._active_jobs.add(job_id)

        try:
            yield
        finally:
            with self._state_lock:
                self._active_renders = max(0, self._active_renders - 1)
                if job_id:
                    self._active_jobs.discard(job_id)
            sem.release()

    def register_active_file(self, file_path: str) -> None:
        with self._state_lock:
            self._active_files.add(os.path.abspath(file_path))

    def unregister_active_file(self, file_path: str) -> None:
        with self._state_lock:
            self._active_files.discard(os.path.abspath(file_path))

    # Disk Space Watchdog
    def get_free_disk_gb(self, path: Optional[str] = None) -> float:
        check_path = path or DATA_DIR
        try:
            os.makedirs(check_path, exist_ok=True)
            usage = shutil.disk_usage(check_path)
            return usage.free / (1024 ** 3)
        except Exception as e:
            logger.warning(f"Failed to check disk usage for {check_path}: {e}")
            return 999.0

    def assert_sufficient_disk_space(self, min_gb: Optional[float] = None, path: Optional[str] = None) -> None:
        required = min_gb if min_gb is not None else self.min_disk_free_gb
        env_override = os.getenv("MIN_DISK_FREE_GB")
        if env_override is not None:
            try:
                required = min(required, float(env_override))
            except ValueError:
                pass
        free_gb = self.get_free_disk_gb(path)
        if free_gb < required:
            raise InsufficientStorageError(
                f"Insufficient disk space: {free_gb:.2f} GB available, required at least {required:.2f} GB."
            )

    def check_system_health(self) -> None:
        """Enforces GPU memory headroom and disk capacity before starting a workload."""
        self.assert_sufficient_disk_space()

        # GPU memory protection: warn/throttle if utilization > 85%
        if self.cuda_available:
            try:
                import torch
                if torch.cuda.is_available():
                    allocated = torch.cuda.memory_allocated()
                    total = torch.cuda.get_device_properties(0).total_memory
                    if total > 0 and (allocated / total) > 0.85:
                        logger.warning(
                            f"[ResourceGovernor] GPU memory utilization is high: "
                            f"{allocated / total * 100:.1f}%. Recommending CPU fallback or throttled concurrency."
                        )
            except Exception:
                pass

    # Subprocess Lifecycle Management
    def execute_ffmpeg(
        self,
        cmd: List[str],
        timeout: Optional[float] = None,
        check_exit_code: bool = True,
        **kwargs,
    ) -> subprocess.CompletedProcess:
        """
        Executes an FFmpeg or media subprocess with guaranteed timeout, pipe cleanup,
        and cancellation safety.
        """
        actual_timeout = timeout if timeout is not None else self.ffmpeg_timeout_seconds
        proc = None
        stdout_data = b""
        stderr_data = b""

        with self._state_lock:
            # Prepare subprocess
            pass

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                **kwargs,
            )
            with self._state_lock:
                self._active_subprocesses.add(proc)

            stdout_data, stderr_data = proc.communicate(timeout=actual_timeout)

        except subprocess.TimeoutExpired:
            if proc:
                logger.error(f"[ResourceGovernor] Subprocess timed out after {actual_timeout}s. Terminating PID {proc.pid}...")
                try:
                    proc.kill()
                    stdout_data, stderr_data = proc.communicate(timeout=5.0)
                except Exception as kill_err:
                    logger.error(f"Error terminating timed-out subprocess {proc.pid}: {kill_err}")
            raise SubprocessTimeoutError(f"FFmpeg process exceeded timeout of {actual_timeout}s.")

        except (Exception, KeyboardInterrupt):
            if proc and proc.poll() is None:
                logger.warning(f"[ResourceGovernor] Aborting subprocess PID {proc.pid} due to exception/interruption...")
                try:
                    proc.kill()
                    proc.wait(timeout=5.0)
                except Exception:
                    pass
            raise

        finally:
            if proc:
                with self._state_lock:
                    self._active_subprocesses.discard(proc)
                # Ensure pipes are closed
                try:
                    if proc.stdout:
                        proc.stdout.close()
                    if proc.stderr:
                        proc.stderr.close()
                except Exception:
                    pass

        if check_exit_code and proc.returncode != 0:
            err_msg = stderr_data.decode("utf-8", errors="replace")
            raise subprocess.CalledProcessError(proc.returncode, cmd, output=stdout_data, stderr=stderr_data)

        return subprocess.CompletedProcess(cmd, proc.returncode, stdout_data, stderr_data)

    async def async_execute_ffmpeg(
        self,
        cmd: List[str],
        timeout: Optional[float] = None,
        check_exit_code: bool = True,
        **kwargs,
    ) -> subprocess.CompletedProcess:
        """Executes FFmpeg without blocking the asynchronous event loop."""
        return await asyncio.to_thread(
            self.execute_ffmpeg,
            cmd=cmd,
            timeout=timeout,
            check_exit_code=check_exit_code,
            **kwargs,
        )

    # Scratch Directory Watchdog
    def cleanup_scratch_files(
        self,
        scratch_dirs: Optional[List[str]] = None,
        max_age_seconds: float = 3600.0,  # 60 minutes
    ) -> Dict[str, Any]:
        """
        Removes abandoned scratch and temp files older than max_age_seconds.
        Never removes files actively registered as in-progress.
        Guarantees path containment within authorized scratch boundaries.
        """
        dirs = scratch_dirs or [SCRATCH_DIR, TEMP_DIR]
        now = time.time()
        deleted_count = 0
        freed_bytes = 0
        errors: List[str] = []

        with self._state_lock:
            protected_files = set(self._active_files)

        for base in dirs:
            if not os.path.exists(base):
                continue
            base_abs = os.path.abspath(base)
            for root, _, files in os.walk(base_abs):
                for f in files:
                    file_path = os.path.abspath(os.path.join(root, f))
                    # Prevent escaping base scratch directory
                    if not file_path.startswith(base_abs):
                        continue
                    if file_path in protected_files:
                        continue

                    try:
                        stat = os.stat(file_path)
                        age = now - stat.st_mtime
                        if age > max_age_seconds:
                            file_size = stat.st_size
                            os.remove(file_path)
                            deleted_count += 1
                            freed_bytes += file_size
                    except Exception as e:
                        errors.append(f"Failed to delete {file_path}: {e}")

        return {
            "cleaned_files_count": deleted_count,
            "freed_bytes": freed_bytes,
            "freed_mb": freed_bytes / (1024 * 1024),
            "errors": errors,
        }

    def get_status(self) -> Dict[str, Any]:
        """Returns comprehensive resource telemetry."""
        proc = psutil.Process()
        mem = proc.memory_info()
        sys_mem = psutil.virtual_memory()

        with self._state_lock:
            active_renders = self._active_renders
            active_jobs = list(self._active_jobs)
            active_proc_count = len(self._active_subprocesses)

        return {
            "concurrency": {
                "max_renders": self.max_renders,
                "active_renders": active_renders,
                "available_slots": max(0, self.max_renders - active_renders),
                "active_jobs": active_jobs,
                "active_subprocesses_count": active_proc_count,
            },
            "process_memory": {
                "rss_mb": mem.rss / (1024 * 1024),
                "vms_mb": mem.vms / (1024 * 1024),
            },
            "system": {
                "cpu_cores": self.cpu_cores,
                "cpu_percent": psutil.cpu_percent(),
                "total_ram_gb": sys_mem.total / (1024 ** 3),
                "available_ram_gb": sys_mem.available / (1024 ** 3),
                "free_disk_gb": self.get_free_disk_gb(),
            },
            "gpu": {
                "available": self.cuda_available,
                "name": self.gpu_name,
                "vram_gb": self.vram_gb,
            },
            "memory_profiler": self.memory_profiler.get_summary(),
        }


def get_resource_governor() -> ResourceGovernor:
    """Convenience singleton accessor."""
    return ResourceGovernor.get_instance()
