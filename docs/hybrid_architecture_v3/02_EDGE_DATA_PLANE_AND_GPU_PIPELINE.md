# 02 — Edge Data Plane & GPU Pipeline Architecture

## 1. The Stage Lifecycle Contract

The edge compute engine processes media through a deterministic, staged lifecycle. Each stage:
1. Reads its input manifest from the local database or prior checkpoint.
2. Performs an admission check against the **Resource Governor** (memory, VRAM, disk, power).
3. Writes intermediate results to atomic temporary files (`.part`).
4. Validates the output (codecs, checksums, non-empty bounds).
5. Atomically renames the file and commits a stage checkpoint to SQLite.

```mermaid
flowchart LR
    A[1. Probe] --> B[2. Audio Ingest]
    B --> C[3. ASR & VAD]
    C --> D[4. Rank & Score]
    D --> E[5. Clip Selection]
    E --> F[6. Video Acquisition]
    F --> G[7. Face Tracking]
    G --> H[8. FFmpeg NVENC]
    H --> I[9. QA Verification]
    I --> J[10. Preview / Publish]
```

---

## 2. The 11 Pipeline Stages in Detail

| # | Stage Name | Inputs -> Outputs | Resource Strategy & Execution Boundary |
|---|---|---|---|
| **1** | **Probe** | Source URL/file -> Duration, resolution, codecs, track inventory | Lightweight `ffprobe` JSON inspect with 10s strict timeout. No media download. |
| **2** | **Audio Ingest** | Source URL -> 16 kHz Mono AAC/Opus (~20–40 MB) | Downloads **only** audio stream via range-aware HTTP client. Skips all video bytes. |
| **3** | **ASR & VAD** | Mono audio -> Word-level timestamped transcript | **Isolated Subprocess:** Faster-Whisper (`small` or `base` INT8) + Silero VAD. Exits on completion. |
| **4** | **Rank & Score** | Transcript -> Ranked highlight candidate spans | Deterministic local heuristics (hook energy, coherence, pacing). Optional Gemini refinement. |
| **5** | **Selection** | Candidate set -> Approved clip ranges (`start`, `end`) | User selection in UI or automated Top-N decider (`SolidShortsDecider`). |
| **6** | **Video Acquire** | Clip ranges -> Reusable high-res video spans | Downloads **only** the selected time ranges (e.g. 45s each) via HTTP byte ranges, saving 90%+ bandwidth. |
| **7** | **Face Tracking** | Video span -> Smoothed 9:16 crop trajectory keyframes | OpenCV YuNet ONNX running on CPU with downscaled frames (320px wide at 3–5 fps). Zero VRAM usage. |
| **8** | **Render (NVENC)** | Video + Crop Trajectory + Subtitles -> 1080x1920 MP4 | Hardware FFmpeg `h264_nvenc` (180–240 FPS). Zero raw Python frame buffering. |
| **9** | **QA Verify** | Rendered MP4 -> Validation Report | Probes video stream, audio sync, aspect ratio (9:16), duration bounds, and black frame detection. |
| **10** | **Preview Gen** | Master MP4 -> 360p preview video (<3 MB) + WebP poster (30 KB) | Low-bitrate fast encode for remote studio playback. Optional Supabase upload. |
| **11** | **Publish** | Master MP4 + Title/Tags + Destination -> Upload Receipt | Direct streaming upload to YouTube / Instagram / Facebook via residential broadband. |

---

## 3. The 4 GB VRAM Conundrum: CTranslate2 vs PyTorch

### 3.1 The Hardware Reality
The reference edge machine has an **NVIDIA GeForce GTX 1650 (4 GB GDDR6 VRAM)**. In a typical desktop environment:
- Windows DWM (Desktop Window Manager) and browser consume ~0.8–1.2 GB VRAM.
- Available free VRAM is approximately **2.8–3.2 GB**.

### 3.2 The CTranslate2 Memory Trap
- Faster-Whisper does **not** run on native PyTorch; it runs on **CTranslate2** (a custom C++ inference engine).
- Standard PyTorch commands like `torch.cuda.empty_cache()` and `gc.collect()` do **not** release CTranslate2's internal CUDA memory pool back to the operating system!
- If Faster-Whisper remains initialized in the main process, ~1.5 GB VRAM is permanently held. When FFmpeg NVENC or YuNet starts, the system crashes with CUDA Out-Of-Memory (OOM).

### 3.3 The Isolated Subprocess Solution
Architecture V3 mandates an **isolated subprocess lifecycle** for GPU stages:

```
[Worker Supervisor Process] (RAM: ~80 MB, VRAM: 0 MB)
            │
            ├─► Spawns Subprocess: `python -m yt_clipping.intelligence.asr_runner`
            │     └─ Allocates 1.4 GB VRAM for Faster-Whisper
            │     └─ Transcribes audio & writes transcript.json to disk
            │     └─ Subprocess exits cleanly (OS forces 100% VRAM release)
            │
            ├─► Supervisor verifies VRAM is free (~3.0 GB available)
            │
            ├─► Spawns YuNet ONNX (Runs on CPU with OpenCV DNN)
            │     └─ Analyzes face landmarks, calculates crop trajectory
            │
            └─► Spawns FFmpeg Subprocess
                  └─ Allocates dedicated Turing NVENC hardware ASIC
                  └─ Encodes 1080x1920 @ 30fps at 200+ FPS with zero VRAM contention
```

---

## 4. Audio-First Selective Acquisition: The 95% Bandwidth Saver

In naive video clipping systems, downloading a 60-minute 1080p source video consumes **~1,800 MB (1.8 GB)** before a single highlight is even evaluated.

Architecture V3 enforces an **Audio-First Acquisition Strategy**:
1. **Audio Track Extraction:**
   - Queries source stream formats.
   - Streams only the audio track (Opus/M4A at 64–128 kbps).
   - A 60-minute audio track is only **~30–45 MB** (a 97.5% bandwidth reduction).
2. **Analysis & Ranking on Audio Alone:**
   - Faster-Whisper transcribes the 45 MB audio track.
   - Text heuristics and audio energy analysis pinpoint the top 3 highlight moments (e.g. Clip 1: 04:15–05:00, Clip 2: 18:20–19:05, Clip 3: 42:10–42:55).
3. **Targeted Video Segment Retrieval:**
   - The edge worker issues HTTP Range requests to fetch only the required video chunks (with 2-second keyframe buffers).
   - Total video bytes downloaded: 3 clips × 45 seconds = 135 seconds of 1080p video (~45 MB).
4. **Total Bandwidth Consumed:** 45 MB (audio) + 45 MB (clips) = **90 MB**, compared to 1,800 MB.

---

## 5. Face Tracking & Subtitle Burning

### 5.1 YuNet ONNX on CPU
- Rather than running heavy CUDA face trackers (like RetinaFace or MediaPipe GPU), YuNet is executed via OpenCV's DNN module on the CPU.
- Input video frames are downscaled to 320×180 for tracking.
- Detection runs at a sampled cadence of 3–5 frames per second.
- Center-of-mass face coordinates are smoothed using a Savitzky-Golay / Exponential Moving Average (EMA) filter with instant cuts on detected scene transitions.

### 5.2 FFmpeg Filtergraph Pipeline
FFmpeg executes as a single-pass filtergraph with hardware NVENC:

```bash
ffmpeg -y -ss 04:15.000 -to 05:00.000 -i source_video.mp4 \
  -filter_complex "[0:v]crop=w=ih*9/16:h=ih:x='trunc(in_w/2-out_w/2)':y=0,scale=1080:1920,ass=subtitles.ass[v]" \
  -map "[v]" -map 0:a \
  -c:v h264_nvenc -preset p4 -cq 19 -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  output_c1.mp4
```

---

## 6. Resource Governor Profiles & Admission Gatekeeper

Before any processing stage is scheduled, the worker evaluates admission criteria:

| Metric / Check | Eco Profile | Balanced Profile (Reference Host) | Performance Profile |
|---|---|---|---|
| **Available Host RAM** | $\ge 2.0\text{ GB}$ | $\ge 4.0\text{ GB}$ | $\ge 6.0\text{ GB}$ |
| **Available VRAM** | CPU-Only Mode | $\ge 2.2\text{ GB}$ (reserves 1 GB for OS) | Measured peak |
| **Max Concurrent Heavy Stages** | 1 | 1 | 1 |
| **FFmpeg CPU Threads** | 2 | 4 | 8 |
| **YuNet Sampling Rate** | 2 fps | 4 fps | 8 fps |
| **Output Target** | 720×1280 @ 30fps | 1080×1920 @ 30fps | 1080×1920 @ 60fps |
| **Min Free Scratch Disk** | $\ge 5.0\text{ GB}$ | $\ge 10.0\text{ GB}$ | $\ge 20.0\text{ GB}$ |

If free memory drops below threshold or thermal throttling is detected, the stage is paused, returning the job to `BLOCKED_RESOURCE` until system headroom recovers.
