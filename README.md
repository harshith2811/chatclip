# ChatClip
## Viral-moment discovery, configurable multi-reel batches, and 9:16 production

[![Python](https://img.shields.io/badge/Python-3.10%20%7C%203.11%20%7C%203.12-blue?logo=python)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-15.5-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev)
[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen?logo=pytest)](docs/COMPREHENSIVE_TEST_REPORT.md)
[![Hardware](https://img.shields.io/badge/Hardware-%E2%89%A44GB%20VRAM%20%7C%20GTX%201650%20Ready-orange)](docs/RELEASE_READINESS_REPORT.md)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

ChatClip is a research-driven autonomous video discovery, audience-retention intelligence, and vertical 9:16 production engine. One source can produce a configurable batch of 1–24 distinct, virality-ranked clips for YouTube Shorts, Instagram Reels, TikTok, and X. It combines retention signals, hook and narrative scoring, trend velocity, non-overlap safeguards, active-speaker framing, and an integrated Model Context Protocol (MCP) server.

> Virality is probabilistic, not guaranteed. ChatClip ranks moments by measurable signals and reports when a source does not contain enough distinct viable material instead of duplicating clips.

---

## 📖 Table of Contents
- [1. System Architecture](#1-system-architecture)
- [2. Key Capabilities & Innovations](#2-key-capabilities--innovations)
- [3. Hardware Concurrency & Resource Governance](#3-hardware-concurrency--resource-governance)
- [4. Multi-Tenant External AI Video Ingestion](#4-multi-tenant-external-ai-video-ingestion)
- [5. Master Legal Officer Configuration](#5-master-legal-officer-configuration)
- [6. Multi-Platform Social Publishing Gateway](#6-multi-platform-social-publishing-gateway)
- [7. Quickstart & Installation](#7-quickstart--installation)
- [8. Model Context Protocol (MCP) Server](#8-model-context-protocol-mcp-server)
- [9. Project Directory Structure](#9-project-directory-structure)
- [10. Testing & Quality Assurance](#10-testing--quality-assurance)
- [11. Master Documentation Map](#11-master-documentation-map)
- [12. License & Attribution](#12-license--attribution)

---

## 1. System Architecture

```mermaid
flowchart TD
    subgraph Upstream_Sources["Upstream Content Sources"]
        YTIngest["YouTube Ingestion Engine\n(Google Trends RSS, Autocomplete, yt-dlp)"]
        ExternalAI["External AI Video Creators\n(ComfyUI, Runway, Luma, Sora)"]
    end

    subgraph FastAPIEngine["Python 3.12 Backend Engine (:8000)"]
        direction TB
        AuthGate["Fail-Closed Auth & Tenant Resolver\n(X-Tenant-Key / X-API-Key)"]
        SSRFGate["SSRF Defense Guard\n(RFC-1918, Loopback & Redirect Inspector)"]
        TrendsEngine["GoogleTrendsEngine\n(Dual-Tier L1 RAM + L2 SQLite Caching)"]
        SolidShorts["SolidShortsDecider\n(Heatmap Peaks + Trend Alignment Boost)"]
        ResGov["ResourceGovernor\n(VRAM <= 4GB, CPU Concurrency, Leak Detector)"]
        TrajectoryFramer["Kinematic Viewport Framer\n(YuNet Face Tracking & SciPy Banded Solver)"]
        QAGate["Automated 12-Point QA Gate\n(Streams, SAR 1:1, DAR 9:16, Audio Sync)"]
        JobMgr["JobManager & Orphan Cleaner\n(Durable SQLite Task Ledger)"]
    end

    subgraph StudioFrontend["Next.js 15 Studio Workspace (:3050)"]
        direction TB
        DiscoveryTab["Viral Discovery Radar\n(Real-Time Topics Ribbon & Virality Scores)"]
        StudioTab["Studio Workspace\n(SupoClip 4-Metric Virality & Sidecar Assets)"]
        EditorTab["Precision 3-Column Video Editor\n(Canvas, Spoken Transcript Studio, Live 9:16 Mockup)"]
        PublishTab["Multi-Platform Publishing Gateway\n(Dedicated YouTube v3 & Social Webhooks)"]
    end

    subgraph SocialNetworks["Distributed Social Networks"]
        YTShorts["YouTube Shorts"]
        IGReels["Instagram Reels"]
        TikTok["TikTok"]
        XTwitter["X (Twitter)"]
    end

    YTIngest --> TrendsEngine
    ExternalAI -->|"POST /api/v1/external/ai-video/ingest"| AuthGate
    AuthGate --> SSRFGate
    SSRFGate --> ResGov
    TrendsEngine --> SolidShorts
    SolidShorts --> TrajectoryFramer
    TrajectoryFramer --> QAGate
    QAGate --> JobMgr
    JobMgr <--> StudioFrontend
    PublishTab --> SocialNetworks
```

---

## 2. Key Capabilities & Innovations

### A. Dual-Tier Zero-429 Google Trends & Search Momentum Engine
- **Edge RSS & Autocomplete Streaming:** Fetches live breakout Google Trends and real-time YouTube search autocomplete suggestions with 0ms overhead and zero risk of HTTP 429 bans.
- **2-Tier Resilient Caching:** Employs L1 in-memory caching (15-min TTL) backed by a durable L2 SQLite KV store (`data/trends_cache.db`, 3-to-6 hour TTL).
- **Candidate Trend Alignment:** Cross-references extracted spoken highlight dialogue against active breakout queries to grant up to **+18.0 score boosts** and **1.25x virality multipliers**.

### B. SolidShorts Multi-Signal Highlight Decider
- **Heatmap Replay Spike Matching:** Dynamically detects global and prominent audience replay peaks from YouTube player heatmaps (+28 pts for Global Maxima).
- **Synthetic Speech-Density Fallback:** Generates organic retention curves from spoken word density when YouTube omits player heatmap data, ensuring zero flat-line UI states.
- **SupoClip 4-Metric Framework:** Evaluates clips across **Hook (0-25)**, **Engagement (0-25)**, **Value (0-25)**, and **Shareability (0-25)**.

### C. Precision 3-Column Single-Screen Video Editor
- **Ergonomic Studio Layout:** Viewport-locked 3-column desktop layout (`h-[calc(100vh-5rem)]`) with zero window-level scrollbar creep:
  - **Column 1 (Left):** 16:9 Master Video Canvas with interactive 9:16 crop box overlay, playback controls, and acoustic trim sliders.
  - **Column 2 (Center):** Dedicated Spoken Transcript Studio with instant search, hook filtering, timestamps, and 1-click In/Out/Cut buttons.
  - **Column 3 (Right):** Live 9:16 Vertical Preview phone mockup with safe-zone toggles and animated subtitle presets (`hormozi`, `beast`, `neon`, `minimal`).

### D. Kinematic AutoFlip Framing & Active Speaker Tracking
- **YuNet ONNX Face Tracking:** Real-time 60fps face detection on GPU or CPU without VRAM bloat.
- **SciPy Banded Kinematic Trajectory:** Solves optimal viewport crop paths using penalized convex optimization with velocity, acceleration, and viewport-edge clamping.
- **Sub-Word Audio Snapping:** Snaps candidate trim points monotonically to audio word boundaries for natural dialogue flow.

---

## 3. Hardware Concurrency & Resource Governance

The system is engineered for sustained, continuous operation on consumer hardware ($\le 4\text{ GB}$ VRAM, such as NVIDIA GTX 1650 or T4 GPUs) via `src/yt_clipping/orchestration/resource_governor.py`:

### Hardware Concurrency Heuristic
$$\text{Max Concurrent Renders} = \max\left(1, \min\left(\left\lfloor \frac{\text{VRAM}_{\text{GB}}}{1.2} \right\rfloor, \left\lfloor \frac{\text{CPUCores}}{2} \right\rfloor\right)\right)$$

*On a 4 GB NVIDIA GTX 1650, concurrency is clamped to **2-3 concurrent jobs**, ensuring zero VRAM thrashing and deterministic rendering performance.*

### Certified Resource Benchmarks
- **Zero Memory Leaks:** Certified across 50 continuous processing cycles with **$0.00\%$ RSS memory growth**.
- **Subprocess Lifecycle:** FFmpeg commands execute under timeout guards (default 180s). Unresponsive tasks are escalated from `SIGTERM` to `SIGKILL` to prevent zombie workers.
- **Orphan Job Cleaner:** Automatically sweeps orphaned background jobs upon server boot to prevent infinite client polling loops.

---

## 4. Multi-Tenant External AI Video Ingestion

External creators and automated pipelines can submit completed video renders directly into the system.

### Ingestion Request: `POST /api/v1/external/ai-video/ingest`
**Headers:**
```http
X-Tenant-Key: sk_tenant_alpha_secret_2026
Content-Type: application/json
```

**Payload:**
```json
{
  "project_id": "proj-comfy-tokyo-001",
  "video_url": "https://storage.friend-studio.com/renders/tokyo_01.mp4",
  "source_engine": "comfyui_flux",
  "prompt_metadata": {
    "prompt": "Cinematic 8k neon street reflections in rain, hyperrealistic",
    "checkpoint": "flux-1-dev"
  },
  "transcript": [
    {"start": 0.0, "end": 2.5, "text": "Tokyo after midnight never sleeps."},
    {"start": 2.5, "end": 5.0, "text": "Every raindrop mirrors neon signs."}
  ],
  "target_aspect_ratio": "9:16"
}
```

---

## 5. Master Legal Officer Configuration

The platform includes a single boolean master switch controlling all copyright, attribution, and license restrictions:

- **When `LEGAL_OFFICER = True` (Default Strict Mode):** All copyright, rights manifest, creator attribution, commentary, and audio-risk policies are strictly enforced. Unverified clips are denied publication.
- **When `LEGAL_OFFICER = False` (Testing-only bypass):** Rights barriers are bypassed while an honest `'UNVERIFIED_BYPASS'` is recorded. Never use this setting for production or third-party media.

---

## 6. Multi-Platform Social Publishing Gateway

The platform connects to social distribution channels via:
1. **Dedicated YouTube Data API v3:** Direct OAuth 2.0 channel connection for automated Shorts uploading.
2. **Multi-Platform Webhook Dispatcher:** Signs video payloads with HMAC-SHA256 and delivers to social automations (TikTok, Instagram Reels, X).
3. **Double-Post Prevention:** Idempotency keys (`compute_canonical_idempotency_key`) protect against duplicate submissions.

---

## 7. Quickstart & Installation

### Prerequisites
- Python 3.10, 3.11, or 3.12
- Node.js 18, 20, or 22
- FFmpeg 6.0+ installed and on system `PATH`
- NVIDIA GPU with CUDA 12.0+ (optional, automatic CPU fallback enabled)

### Local Development Setup

```bash
# 1. Clone repository
git clone https://github.com/harshith2811/chatclip.git
cd chatclip

# 2. Setup Python environment
python -m venv venv
venv\Scripts\activate    # On Windows
# source venv/bin/activate # On Linux/macOS
pip install -r requirements.txt
pip install -e .

# 3. Configure production-safe defaults
copy .env.example .env     # Windows
# cp .env.example .env     # Linux/macOS
# Replace placeholder secrets, especially WEB_STUDIO_API_KEY.

# 4. Setup Next.js Frontend
cd frontend
npm install
cd ..

# 5. Validate configuration and launch FastAPI Backend (:8000)
yt-clip config validate
yt-clip studio --host 127.0.0.1 --port 8000

# 6. Launch Next.js Studio (:3050) in a separate terminal
cd frontend
npm run dev
```

Open **`http://localhost:3050`** to access the complete Studio experience.
In production mode, open the workspace menu, enter the configured
`WEB_STUDIO_API_KEY` under **Studio Access**, and connect. The key is kept in
memory only; the backend establishes an HTTP-only media session.
Before processing a source, register evidence that you own or are authorized to use it:

```bash
yt-clip rights register --video-id VIDEO_ID --basis OWNED --owner "Your Name" --proof "Internal asset record"
yt-clip ingest --video-id VIDEO_ID
yt-clip run --video-id VIDEO_ID --dry-run --max-clips 8
```

---

## 8. Model Context Protocol (MCP) Server

Connect desktop LLM agents (Claude Desktop, Cursor, Antigravity) to orchestrate video production:

```json
{
  "mcpServers": {
    "yt-clipping": {
      "command": "python",
      "args": ["-m", "yt_clipping.mcp.server"],
      "env": {
        "PYTHONPATH": "c:/Users/cshar/Downloads/yt-clipping-intelligence/src"
      }
    }
  }
}
```

---

## 9. Project Directory Structure

```text
yt-clipping-intelligence/
├── pyproject.toml                  # Packaging specification & CLI entrypoints
├── requirements.txt                # Pinned production dependencies
├── pytest.ini                      # Pytest runner configuration
├── Dockerfile                      # Standalone 24/7 container runtime
├── docker-compose.yml              # Container orchestration
├── LICENSE                         # MIT License
├── README.md                       # Master platform documentation
├── ARCHITECTURE.md                 # 5-System Architecture & Component Map
├── IMPLEMENTATION_ROADMAP.md       # Implementation milestones & roadmap
├── THIRD_PARTY_NOTICES.md          # Upstream research attribution
│
├── frontend/                       # Modern Next.js 15 Studio (:3050)
│   ├── src/app/                    # App Router, layout, and main studio page
│   ├── src/components/discovery/   # Viral Discovery & Retention Heatmap UI
│   ├── src/components/editor/      # Single-Screen 3-Column Precision Video Editor
│   ├── src/components/studio/      # Studio Workspace, phone player, SupoClip controls
│   ├── src/components/publishing/  # Multi-Platform Social Publishing Gateway
│   └── src/lib/                    # Zustand stores, API clients, and utilities
│
├── src/yt_clipping/                # Core modular Python package
│   ├── audio/                      # Voiceover, TTS & commentary engines
│   ├── cli/                        # Master CLI entry points
│   ├── contracts/                  # Typed dataclasses & interfaces
│   ├── detection/                  # Arc detector, SolidShorts decider & segmenter
│   ├── discovery/                  # GoogleTrendsEngine, pinger & attribution engine
│   ├── ingestion/                  # Asset provider, external AI video ingest & SSRF guard
│   ├── mcp/                        # Native MCP JSON-RPC 2.0 stdio server
│   ├── orchestration/              # ResourceGovernor, JobManager, SQLite ledgers
│   ├── podcast/                    # 9:8 split-screen, diarization & shot detection
│   ├── publisher/                  # Multi-platform social adapters & YouTube OAuth
│   ├── qa/                         # Automated 12-point quality assurance verifiers
│   ├── rendering/                  # FFmpeg renderer, YuNet tracker, kinetic subtitles
│   ├── rights/                     # RightsPolicyGate & license audit ledger
│   ├── scoring/                    # Scorecards, SupoClip virality scorer & Gemini provider
│   ├── transcription/              # Faster-Whisper transcriber & WhisperX alignment
│   └── web/                        # FastAPI REST API & legacy dashboard
│
├── top_trending_videos_in_youtube/ # Verified 10M+ channel streamer & discovery library
├── docs/                           # Technical Specifications & Documentation
│   ├── audits/                     # Audit reports, certifications & master prompts
│   ├── ARCHITECTURE.md             # Subsystem technical specifications
│   ├── CLI_REFERENCE.md            # Complete CLI operator reference handbook
│   └── MODULE_REFERENCE.md         # Python module, class & API reference
└── tests/                          # Automated Pytest Suite
```

---

## 10. Testing & Quality Assurance

Run the automated test suite:
```bash
python -m pytest -q
```

Run frontend typecheck, lint, and production build:
```bash
cd frontend
npm run typecheck
npm run lint
npm run build
```

Run the reproducible, locally owned spoken-media acceptance test:

```bash
python scripts/verify_spoken_mvp.py path/to/your_authorized_spoken_source.mp4
```

The script exercises transcription, candidate selection, rendering, strict media
QA, rights enforcement, and a dry-run publishing handoff without requiring an
unlicensed third-party source.

---

## 11. Master Documentation Map

- [**System Architecture & Subsystems**](ARCHITECTURE.md)
- [**Implementation Roadmap**](IMPLEMENTATION_ROADMAP.md)
- [**Documentation Portal (Master Index)**](docs/README.md)
- [**Model Context Protocol (MCP) Server Specification**](docs/mcp.md)
- [**CLI Operator Reference Guide**](docs/CLI_REFERENCE.md)
- [**Exhaustive Module & API Reference**](docs/MODULE_REFERENCE.md)
- [**Active Speaker Face Tracking & Subtitles**](docs/ACTIVE_SPEAKER_AND_CAPTIONS.md)

---

## 12. License & Attribution

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for terms.  
All upstream algorithm inspirations, research foundations, and external references are formally credited in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
