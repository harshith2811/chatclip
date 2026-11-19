# MASTER DIRECTIVE: MULTI-TENANT AI VIDEO INGESTION, RESOURCE HARDENING & BI-DIRECTIONAL OMNIPOST INTEGRATION

```text
====================================================================================================
MISSION: Multi-Tenant AI Video Pipeline Bridge, Stress Hardening, Memory/CPU Profiling & OmniPost Sync
ECOSYSTEM: YouTube Clipping Intelligence Engine (Python 3.12/FastAPI) + OmniPost (Node.js/Express/Vite)
ROLE: Principal Systems Architect, Lead SRE, Media Pipeline Engineer & AI Infrastructure Specialist
EXECUTION MODE: Production Remediation, Stress Certification, and Modular Feature Extension
====================================================================================================
```

---

## 1. MISSION CHARTER & ARCHITECTURAL OBJECTIVE

You are charged with upgrading and stress-hardening the **YouTube Clipping Intelligence Engine** and its companion social automation platform **OmniPost**. 

Your objective is twofold:
1. **End-to-End Resource & Memory Hardening**: Stress test and harden the entire pipeline under relentless concurrent workloads (FFmpeg, OpenCV, YuNet/YOLO, Gemini AI, SQLite WAL) to guarantee zero memory leaks, bounded CPU usage, strict VRAM limits (<4GB), and zero orphaned temporary files.
2. **Two-Way Multi-Tenant Integration Architecture**:
   - **Upstream Bridge (AI Video Creator)**: Enable external AI video generation engines (e.g., ComfyUI, Runway, Luma, Sora, custom AI pipelines) to seamlessly ingest pre-generated video content and project manifests into a multi-tenant workspace with isolated API keys, user quotas, and metadata attribution.
   - **Tail-End Sync (OmniPost Multi-Account Gateway)**: Dynamically route rendered vertical clips to tenant-specific social media accounts in OmniPost, with bi-directional webhook callbacks reporting publication status, platform analytics, and takedown/revocation events back to the upstream user.

---

## 2. STRICT NON-NEGOTIABLE ENGINEERING CONSTRAINTS

1. **Preserve All Existing Hardening**: Do not break or regress the 587 passing Python pytest tests or the 112 passing OmniPost tests. All previous security gates (`X-API-Key`, SSRF filtering, SHA-256 validation, QA verifiers, `OUTCOME_UNKNOWN` double-post guards, and `LEGAL_OFFICER` toggle) must remain intact.
2. **No Memory Leaks**: Memory footprint must remain stable over 24-hour continuous stress runs. All FFmpeg child processes, OpenCV `cv2.VideoCapture` descriptors, PyTorch tensors, and SQLite connections must be explicitly closed and collected.
3. **Hardware Ceiling**: Must operate predictably on hardware with $\le 4\text{ GB}$ VRAM (NVIDIA GTX 1650/T4) and multicore CPUs. If GPU allocation approaches 85% VRAM, it must gracefully throttle or fallback to CPU threads without crashing.
4. **Tenant Isolation**: User A must never access, view, publish through, or interfere with User B's assets, render jobs, API quotas, or connected social channels.
5. **Fail-Closed Security**: Unauthenticated requests to external ingest endpoints must immediately return `401 Unauthorized`. Ingested external URLs must undergo strict SSRF validation (blocking loopback, link-local, and RFC-1918 private ranges unless explicitly whitelisted).

---

## 3. CORE ARCHITECTURE SPECIFICATIONS

### 3.1 Upstream AI Video Ingestion Bridge (`/api/v1/external/ai-video/*`)

Provide a unified REST & Webhook interface for external AI content generation tools:

```
[External AI Video Generator] (e.g., Runway / Sora / ComfyUI)
              │
              ▼ (POST /api/v1/external/ai-video/ingest with X-Tenant-Key)
┌────────────────────────────────────────────────────────┐
│ YouTube Clipping Intelligence (Multi-Tenant Engine)   │
│  ├── 1. Tenant Authentication & Quota Enforcement      │
│  ├── 2. SSRF Check & Async Stream Ingestion / Temp Dir │
│  ├── 3. Rights & Provenance Registration (AI_ORIGINAL) │
│  ├── 4. Highlight & Virality Reframing (YuNet 9:16)    │
│  ├── 5. Kinetic Subtitles, Audio Mix & B-Roll / CTA    │
│  ├── 6. 12-Point Automated QA Gate (FFmpeg Validation) │
│  └── 7. Tenant Social Routing Dispatcher               │
└────────────────────────────────────────────────────────┘
              │
              ▼ (POST /api/v2/ingest with HMAC & Tenant Channel Bindings)
┌────────────────────────────────────────────────────────┐
│ OmniPost Multi-Channel Social Engine                   │
│  ├── 1. Channel Matching (User A -> User A's Accounts) │
│  ├── 2. Staged File Verification & Idempotency Check   │
│  ├── 3. Scheduled / Live Social Dispatch               │
│  └── 4. Webhook Callback -> Python Engine Receipt      │
└────────────────────────────────────────────────────────┘
```

#### Data Contracts:
- **`Tenant`**: `tenant_id`, `name`, `api_key_hash`, `rate_limit_per_min`, `max_concurrent_jobs`, `storage_quota_mb`, `created_at`.
- **`ExternalAIVideoPayload`**:
  ```json
  {
    "project_id": "ai-proj-98214",
    "video_url": "https://storage.provider.com/renders/scene_01.mp4",
    "video_file_base64": null,
    "source_engine": "comfyui_flux_luma",
    "prompt_metadata": {
      "prompt": "Cyberpunk detective monologue in rainy neo-Tokyo",
      "style": "photorealistic",
      "negative_prompt": "blurry, low quality"
    },
    "transcript": [
      {"start": 0.0, "end": 3.4, "text": "The rain in Sector 4 never cleanses anything."},
      {"start": 3.5, "end": 7.2, "text": "It just washes the neon into the gutters."}
    ],
    "target_aspect_ratio": "9:16",
    "audio_treatment": {
      "generate_voiceover": false,
      "duck_original_audio": 0.3,
      "bg_music_genre": "ambient_synth"
    },
    "omnipost_routing": {
      "workspace_id": "workspace-tenant-alpha",
      "channels": ["tiktok", "youtube_shorts", "instagram_reels"],
      "schedule_time": null,
      "publish_immediately": true
    }
  }
  ```

---

### 3.2 Tail-End OmniPost Bi-Directional Synchronization

1. **Outbound Dispatch**:
   - The clipping engine dispatches the finalized, QA-approved vertical clip to OmniPost `/api/v2/ingest`.
   - Passes `tenant_id` and `workspace_id` in headers and body to guarantee target platform isolation.
2. **Inbound Webhooks (`/api/v1/webhooks/omnipost`)**:
   - OmniPost fires status events: `POST_SCHEDULED`, `POST_PUBLISHED`, `POST_FAILED`, `METRICS_UPDATED`, and `TAKEDOWN_ISSUED`.
   - The clipping engine verifies the HMAC signature on the webhook payload, updates `publishing_receipts`, and notifies the external AI video creator via their registered callback URL.

---

### 3.3 Resource, CPU, and Memory Management Subsystem

1. **Subprocess & Worker Pool Governance**:
   - Explicit concurrency limit via `asyncio.Semaphore` based on detected CPU cores and VRAM:
     $$\text{MaxConcurrentRenders} = \max\left(1, \min\left(\lfloor \text{VRAM}_{\text{GB}} / 1.2 \rfloor, \lfloor \text{CPUCores} / 2 \rfloor\right)\right)$$
   - All FFmpeg instances must run with strict timeouts (e.g., $180\text{ s}$ per clip) and clean up pipes (`stdout.close()`, `stderr.close()`, `wait()`).
2. **Memory Leak Detection Harness**:
   - Continuous background memory profiler tracking RSS, VMS, and Python heap allocations via `tracemalloc`.
   - Automatic leak warning if RSS grows monotonically by $>150\text{ MB}$ over 50 consecutive job cycles without garbage collection relief.
3. **Orphaned File Sweeper**:
   - Background disk watchdog clearing scratch chunks and temporary WAV/MP4 files older than 60 minutes.
   - Enforce minimum disk headroom of $5.0\text{ GB}$ before accepting any new external video ingest.

---

## 4. IMPLEMENTATION & TEST PHASES

Execute the following steps in sequence:

### PHASE 1: Multi-Tenant Data Layer & Upstream Bridge
1. Create SQLite migration for `tenants`, `tenant_quotas`, and `external_ai_projects`.
2. Build `ExternalAIVideoIngestService` with:
   - URL download stream handler with chunked SHA-256 calculation and size cap ($500\text{ MB}$).
   - SSRF validator preventing internal IP/host probing.
   - Transcript timecode validator and alignment parser.
   - Rights gate auto-registration with basis `AI_GENERATED_ORIGINAL` and status `VERIFIED` under the tenant's namespace.
3. Expose REST endpoints:
   - `POST /api/v1/external/ai-video/ingest`
   - `GET /api/v1/external/ai-video/status/{job_id}`
   - `POST /api/v1/external/ai-video/bulk-ingest`

### PHASE 2: Tail-End OmniPost Tenant Social Routing
1. Update OmniPost `/api/v2/ingest` to parse `workspace_id` and `tenant_id`.
2. Validate that social accounts linked to `workspace_id` are isolated and cannot be triggered by unauthorized tenant tokens.
3. Add webhook notification dispatcher in OmniPost and listener in the clipping engine (`/api/v1/webhooks/omnipost`) with HMAC-SHA256 signature verification.

### PHASE 3: Resource Hardening & Concurrency Profiler
1. Implement `ResourceGovernor` in `src/yt_clipping/orchestration/resource_governor.py`:
   - Monitors active memory usage, GPU VRAM, CPU load, and disk headroom.
   - Dynamically queues or rejects jobs with HTTP `429 Too Many Requests` or `503 Service Unavailable` if thresholds are exceeded.
2. Build stress harness `tests/test_stress_and_memory_leaks.py`:
   - Simulates 50 continuous video ingestion and rendering cycles.
   - Asserts memory usage before and after stress loop exhibits no significant delta ($\Delta \text{RSS} < 5\%$).
   - Verifies all FFmpeg processes terminate without zombies.
   - Verifies 100% of temporary scratch files are purged.

### PHASE 4: End-to-End Multi-Tenant Certification
1. Execute multi-tenant simulation:
   - Ingest 5 AI videos simultaneously from Tenant Alpha and 5 AI videos from Tenant Beta.
   - Confirm Tenant Alpha clips route only to Alpha's social targets and Beta clips route only to Beta's targets.
   - Verify receipts, metrics, and audit entries maintain strict separation.

---

## 5. VERIFICATION & ACCEPTANCE CRITERIA

A successful run must output clean green signals for:
- [ ] All 587 existing Python tests pass with zero regressions: `python -m pytest -q`
- [ ] All 112 OmniPost tests pass: `npm --prefix omnipost test`
- [ ] New multi-tenant ingest and stress tests pass: `python -m pytest tests/test_stress_and_memory_leaks.py -v`
- [ ] Memory leak audit confirms zero orphaned handles and stable memory baseline.
- [ ] Bi-directional OmniPost webhook round-trip completes within $<500\text{ ms}$.

Execute incrementally, trace all real paths, and certify production readiness.
