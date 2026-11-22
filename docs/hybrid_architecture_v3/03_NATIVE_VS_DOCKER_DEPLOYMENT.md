# 03 — Native vs Docker Deployment Strategy

## 1. The Core Architectural Decision

> [!IMPORTANT]
> **Baseline Decision (ADR-05):** The primary deployment model for the Windows reference workstation is a **Native Supervised Python Process** running directly under the user's OS account. Docker Desktop is maintained as an **optional, secondary profile** for Linux edge nodes or verified advanced workstations.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PRIMARY: NATIVE WORKER                          │
│                                                                        │
│  Windows 10/11 Host                                                    │
│  ├── Python 3.11/3.12 Virtualenv (.venv)                               │
│  ├── Windows Job Object (Child Process Tree & Memory Cap)              │
│  ├── Windows Credential Manager (Encrypted Token Vault)                │
│  ├── Direct NVIDIA Driver (Direct NVENC / CUDA 12.4)                   │
│  └── Native Fast NVMe I/O (No Virtualization Overhead)                 │
│                                                                        │
│  Memory Overhead: ~80 MB RSS | Startup Time: < 1.5 seconds             │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                       SECONDARY: OPTIONAL DOCKER                       │
│                                                                        │
│  Windows 10/11 Host                                                    │
│  └── WSL2 Linux VM (vmmem process: 4 GB – 8 GB RAM)                   │
│      └── Docker Daemon                                                 │
│          └── yt-clipper-edge container (Linux UID 10001)               │
│              ├── WSL2 NVIDIA GPU Passthrough Driver                    │
│              └── Cross-OS Bind Mount I/O (drvfs latency)               │
│                                                                        │
│  Memory Overhead: 4,000+ MB RSS | Startup Time: 15–30 seconds          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Decision Matrix: Native vs Docker Desktop vs Linux Docker

| Evaluation Metric | Native Supervised Worker (Recommended) | Docker Desktop / WSL2 (Windows Host) | Docker Engine (Linux Edge Host) |
|---|---|---|---|
| **RAM Overhead** | **Lowest (~80–120 MB)** | **Extreme (4,000–8,000 MB)** due to WSL2 VM | Low (~150 MB) daemon overhead |
| **GPU / NVENC Reliability** | **Direct native driver**; proven zero-friction NVENC | Dependent on WSL2 DirectX/CUDA translation | NVIDIA Container Toolkit required |
| **Storage Performance** | **100% native NVMe I/O** | Slow on bind-mounted Windows paths (`/mnt/c/`) | Native ext4 / XFS performance |
| **Credential Storage** | **Windows Credential Manager** (`win32cred`) | Plaintext environment or mounted secrets | Linux secret-service / keyring |
| **Process Cleanup** | **Windows Job Object** (`KILL_ON_JOB_CLOSE`) | Container stop signals (`SIGTERM` -> `SIGKILL`) | cgroups and container lifecycle |
| **Installation Friction** | Simple script / one-click launcher | Requires virtualization, WSL2, Docker Desktop | Standard apt/yum/docker packages |
| **Licensing Constraints** | None (Standard Open Source) | Requires Docker Pro/Team license in commercial orgs | Docker CE is open-source Apache 2.0 |

---

## 3. Native Supervisor Implementation (Windows Reference)

### 3.1 Windows Job Object Integration
On Windows, a Python supervisor process can create an operating system **Job Object**. When child processes (such as `ffmpeg.exe` or `asr_runner.py`) are spawned, they are assigned to the Job Object with:
1. `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: If the supervisor process terminates, crashes, or is killed in Task Manager, the operating system kernel instantly terminates all child FFmpeg and Python worker processes, preventing orphaned render tasks.
2. `JOB_OBJECT_LIMIT_PROCESS_MEMORY`: Hard per-process RAM limits.
3. `BELOW_NORMAL_PRIORITY_CLASS`: Keeps the user's interactive workstation smooth and responsive during long rendering passes.

### 3.2 Secure Token Vault via Windows Credential Manager
Social media OAuth refresh tokens (YouTube, Instagram, Facebook) and the edge pairing secret are **never** written to plaintext JSON files. They are saved directly into the Windows Credential Manager (`win32cred` / `keyring` library) under the target `YTClipper/Tokens/{AccountID}`.

### 3.3 The Worker CLI Commands
The native worker is controlled via a simple Python CLI:

```powershell
# 1. Environment Doctor: Verifies GPU driver, NVENC, FFmpeg, and VRAM
python -m yt_clipping.worker doctor

# 2. Run Worker in Balanced Profile (Default)
python -m yt_clipping.worker run --profile balanced

# 3. Run Standalone Studio (Loopback Web UI on port 8765)
python -m yt_clipping.worker studio --port 8765
```

---

## 4. Optional Docker Deployment Profile

For headless servers, Linux edge boxes, or users requiring container isolation, a multi-stage Docker architecture is specified:

### 4.1 Base Container Configuration (`compose.yaml`)
```yaml
services:
  edge:
    image: yt-clipper-edge:v3-cpu
    user: "10001:10001"
    init: true
    restart: unless-stopped
    stop_grace_period: 60s
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - "no-new-privileges:true"
    cpus: 3.5
    mem_limit: 5g
    memswap_limit: 5g
    pids_limit: 128
    tmpfs:
      - /tmp:size=256m,mode=1777
    volumes:
      - ${EDGE_DATA_ROOT:-./data}:/data
    environment:
      EDGE_DATA_ROOT: /data
      EDGE_PROFILE: balanced
      EDGE_API_URL: ${EDGE_API_URL:-https://api.yourstudio.com/api/v1}
      EDGE_BIND: 0.0.0.0:8765
    ports:
      - "127.0.0.1:8765:8765"
    healthcheck:
      test: ["CMD", "python", "-m", "yt_clipping.worker", "healthcheck"]
      interval: 60s
      timeout: 5s
      retries: 3
```

### 4.2 GPU Overlay Configuration (`compose.gpu.yaml`)
```yaml
services:
  edge:
    image: yt-clipper-edge:v3-cuda
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu, video]
    environment:
      NVIDIA_DRIVER_CAPABILITIES: compute,utility,video
      EDGE_GPU_ENABLED: "true"
```

### 4.3 WSL2 Resource Tuning (`%UserProfile%\.wslconfig`)
If Docker Desktop must be used on Windows, the user must constrain WSL2 memory to prevent it from starving Windows:
```ini
[wsl2]
memory=8GB
processors=4
swap=2GB
localhostForwarding=true
```

---

## 5. Mandatory Deployment Parity Gate

Before Docker can be certified as an active runner on any workstation, it must pass the **15-Point Parity Gate**:

1. [ ] **Hardware NVENC Probing:** `ffmpeg -encoders` reports operational `h264_nvenc`.
2. [ ] **Actual Hardware Encode:** Successfully renders a 10-second test video using NVENC at >150 FPS.
3. [ ] **CUDA Model Execution:** Faster-Whisper transcribes a 10-second sample on GPU float16.
4. [ ] **Clean Memory Release:** Host free VRAM returns to baseline after ASR subprocess exit.
5. [ ] **Non-Root Execution:** Container runs strictly as unprivileged UID `10001`.
6. [ ] **Read-Only Root Filesystem:** Root container FS is mounted `read_only: true`.
7. [ ] **Atomic File Renames:** SQLite WAL and `.part` temporary files function correctly across volume mounts.
8. [ ] **Process Cancellation:** Terminating a job terminates FFmpeg within 2.0 seconds.
9. [ ] **Crash Resilience:** Killing worker mid-render leaves no corrupted `.mp4` marked completed.
10. [ ] **Encrypted Vault Access:** Tokens are encrypted at rest with user-supplied key or OS vault.
11. [ ] **Loopback Isolation:** Web UI is bound strictly to `127.0.0.1`, not `0.0.0.0`.
12. [ ] **Memory Limit Enforcement:** Hard RAM cap limits process memory without machine freezing.
13. [ ] **PID Ceilings:** Fork bombs or runaway threads blocked by PID cap (`pids_limit: 128`).
14. [ ] **Offline Operation:** Disconnecting Ethernet allows 100% of local jobs to complete.
15. [ ] **Performance Parity:** Docker render throughput is within 10% of native Windows throughput.
