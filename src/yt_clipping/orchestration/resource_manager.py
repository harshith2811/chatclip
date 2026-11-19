"""
Hardware-Aware Resource Manager & Processing Concurrency Governor.
Protects system RAM, CPU cores, and GPU VRAM from runaway concurrency.

Dynamically probes hardware (VRAM capacity, CPU core count), calculates safe
concurrency boundaries, and enforces bounded execution across Whisper models,
YuNet face tracking, and FFmpeg/NVENC rendering sessions.
"""

from typing import Optional, Dict, Any
from contextlib import contextmanager
import threading
import logging
import os

logger = logging.getLogger(__name__)


class HardwareCapabilities:
    """Probes system compute and memory capabilities."""

    def __init__(self):
        self.cuda_available = False
        self.gpu_name = "None"
        self.vram_total_mb = 0
        self.cpu_cores = os.cpu_count() or 4
        self._probe_hardware()

    def _probe_hardware(self) -> None:
        try:
            import torch
            if torch.cuda.is_available():
                self.cuda_available = True
                self.gpu_name = torch.cuda.get_device_name(0)
                props = torch.cuda.get_device_properties(0)
                self.vram_total_mb = int(props.total_memory / (1024 * 1024))
        except Exception:
            self.cuda_available = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cuda_available": self.cuda_available,
            "gpu_name": self.gpu_name,
            "vram_total_mb": self.vram_total_mb,
            "cpu_cores": self.cpu_cores,
        }


class ResourceManager:
    """
    Coordinates access to high-demand GPU and CPU processing resources.
    Prevents CUDA out-of-memory and NVENC session allocation crashes.
    """

    _instance: Optional["ResourceManager"] = None
    _singleton_lock = threading.Lock()

    def __init__(
        self,
        max_gpu_concurrency: Optional[int] = None,
        max_cpu_concurrency: Optional[int] = None,
    ):
        self.hardware = HardwareCapabilities()

        # Conservative GPU limits based on VRAM capacity
        if max_gpu_concurrency is not None:
            self.gpu_limit = max_gpu_concurrency
        elif not self.hardware.cuda_available:
            self.gpu_limit = 1
        elif self.hardware.vram_total_mb <= 4096:
            # 4 GB VRAM (e.g. GTX 1650, RTX 3050 mobile): Strictly 1 concurrent GPU job
            self.gpu_limit = 1
        elif self.hardware.vram_total_mb <= 8192:
            # 6-8 GB VRAM: 2 concurrent GPU jobs
            self.gpu_limit = 2
        else:
            # > 8 GB VRAM: Up to 3 concurrent GPU jobs
            self.gpu_limit = 3

        # CPU processing limits
        if max_cpu_concurrency is not None:
            self.cpu_limit = max_cpu_concurrency
        else:
            self.cpu_limit = max(1, min(self.hardware.cpu_cores - 1, 4))

        self._gpu_semaphore = threading.BoundedSemaphore(value=self.gpu_limit)
        self._cpu_semaphore = threading.BoundedSemaphore(value=self.cpu_limit)

        self._active_gpu_jobs = 0
        self._active_cpu_jobs = 0
        self._state_lock = threading.Lock()

        logger.info(
            f"ResourceManager initialized: GPU concurrency limit={self.gpu_limit} "
            f"({self.hardware.gpu_name}, {self.hardware.vram_total_mb}MB), "
            f"CPU concurrency limit={self.cpu_limit} ({self.hardware.cpu_cores} cores)."
        )

    @classmethod
    def get_instance(cls) -> "ResourceManager":
        with cls._singleton_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @contextmanager
    def acquire_gpu_slot(self, job_id_or_timeout: Any = None, timeout: Optional[float] = 300.0):
        """
        Acquires a GPU processing slot with timeout. Releases cleanly on success or failure.
        """
        actual_timeout = timeout
        if isinstance(job_id_or_timeout, (int, float)):
            actual_timeout = float(job_id_or_timeout)
        acquired = self._gpu_semaphore.acquire(timeout=actual_timeout)
        if not acquired:
            raise TimeoutError(f"Timed out waiting {actual_timeout}s for available GPU processing slot.")
        with self._state_lock:
            self._active_gpu_jobs += 1
        try:
            yield
        finally:
            with self._state_lock:
                self._active_gpu_jobs = max(0, self._active_gpu_jobs - 1)
            self._gpu_semaphore.release()

    @contextmanager
    def acquire_cpu_slot(self, job_id_or_timeout: Any = None, timeout: Optional[float] = 300.0):
        """
        Acquires a CPU processing slot with timeout. Releases cleanly on success or failure.
        """
        actual_timeout = timeout
        if isinstance(job_id_or_timeout, (int, float)):
            actual_timeout = float(job_id_or_timeout)
        acquired = self._cpu_semaphore.acquire(timeout=actual_timeout)
        if not acquired:
            raise TimeoutError(f"Timed out waiting {actual_timeout}s for available CPU processing slot.")
        with self._state_lock:
            self._active_cpu_jobs += 1
        try:
            yield
        finally:
            with self._state_lock:
                self._active_cpu_jobs = max(0, self._active_cpu_jobs - 1)
            self._cpu_semaphore.release()


    def get_status(self) -> Dict[str, Any]:
        with self._state_lock:
            return {
                "gpu": {
                    "limit": self.gpu_limit,
                    "active": self._active_gpu_jobs,
                    "available": max(0, self.gpu_limit - self._active_gpu_jobs),
                },
                "cpu": {
                    "limit": self.cpu_limit,
                    "active": self._active_cpu_jobs,
                    "available": max(0, self.cpu_limit - self._active_cpu_jobs),
                },
                "hardware": self.hardware.to_dict(),
            }


def get_resource_manager() -> ResourceManager:
    """Convenience accessor for singleton ResourceManager."""
    return ResourceManager.get_instance()
