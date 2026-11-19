# YouTube Clipping Intelligence Platform — Master Documentation Portal
## Universal Multi-Tenant Architecture, AI Pipelines, Governance & Engineering Specifications

Welcome to the definitive documentation portal for the **YouTube Clipping Intelligence Platform** and **OmniPost Universal Publishing Engine**. This repository provides an end-to-end autonomous content production, kinetic vertical reframing, AI highlight intelligence, resource-governed rendering, and multi-tenant social publishing ecosystem.

---

## 📚 Master Documentation Map

```text
docs/
├── README.md                                          # Master Documentation Hub (This Portal)
│
├── ARCHITECTURE.md                                    # Core System Topology, Pipeline Data Flow & Engine Design
├── MULTI_TENANT_AI_PIPELINE_AND_RESOURCE_GOVERNANCE.md# Multi-Tenant AI Ingestion Bridge, Governor Heuristic & Runbook
├── OMNIPOST_INTEGRATION_FLOWS.md                      # Bi-Directional OmniPost Architecture, HMAC Webhooks & Rollup
├── OMNIPOST_INTEGRATION_ARCHITECTURE.md               # Social Platform Adapters & State Machine Design
│
├── ACTIVE_SPEAKER_AND_CAPTIONS.md                     # Face Tracking, Kinematic Trajectory & Subtitle Presets
├── PODCAST_ENGINE.md                                  # 9:8 Stacked Split-Screen, Diarization & Director Switching
├── CLI_REFERENCE.md                                   # Complete Command-Line Interface Manual, Flags & Recipes
├── MODULE_REFERENCE.md                                # Exhaustive Python Module, Class & API Directory
├── VIRALITY_AND_ATTRIBUTION.md                        # Virality Multiplier, Velocity Scoring & Attribution Engine
├── mcp.md                                             # Model Context Protocol (MCP) JSON-RPC 2.0 Specification
│
├── PRODUCTION_OPERATIONS_AND_BACKUP.md                # Deployment, Disaster Recovery, Backup & Maintenance Runbook
├── FINAL_PRODUCTION_CERTIFICATION_REPORT.md           # Engineering Audit, Security Remediation & Test Telemetry
├── COMPREHENSIVE_TEST_REPORT.md                       # Full Test Suite Verification (712 Certified Passing Tests)
├── RELEASE_READINESS_REPORT.md                        # Production Audit, VRAM Verification & Hardware Matrix
├── FINAL_PHASE_PRODUCTION_UPDATES.md                  # Milestone & Remediation History
│
├── adr/                                               # Architectural Decision Records (ADRs)
│   ├── 0001-clean-room-modular-core.md
│   ├── 0002-hard-rights-gate-enforcement.md
│   ├── 0003-views-vs-retention-separation.md
│   └── 0004-autopost-adapter-contract.md
│
└── research/                                          # Upstream Benchmarks, Research & Provenance
    ├── antigravity_master_yt_clipping_prompt.md
    ├── license-and-provenance.md
    ├── progress.md
    ├── project-baseline.md
    ├── repository-matrix.md
    └── yt_clipping_master_repo_research.md
```

---

## 🚀 Core Architectural Specifications

### 1. [Multi-Tenant AI Video Pipeline & Resource Governance](MULTI_TENANT_AI_PIPELINE_AND_RESOURCE_GOVERNANCE.md)
The definitive guide for external AI video generators and system reliability:
- **Upstream Ingestion Bridge:** Ingest videos from ComfyUI (FLUX.1/SD3.5), Runway Gen-3, Luma Dream Machine, OpenAI Sora, and custom pipelines via `POST /api/v1/external/ai-video/ingest`.
- **SSRF Defense:** Blocks loopback, link-local, RFC-1918 private IPs, and redirect hops.
- **Hardware Concurrency Governor:** Dynamic concurrency heuristic calibrated for $\le 4\text{ GB}$ VRAM GPUs (NVIDIA GTX 1650 / T4) and CPU cores.
- **Zero-Memory-Leak Certification:** Process RSS, VMS, and Python heap allocations tracked across 50 consecutive processing cycles ($\Delta\text{RSS} < 5\%$, observed $0.00\%$).
- **Subprocess & Watchdog Governance:** Guaranteed FFmpeg process termination, stream closure, and PID reaping; scratch watchdog with active-job file locks.

### 2. [OmniPost Bi-Directional Integration Flows](OMNIPOST_INTEGRATION_FLOWS.md)
Universal social distribution engine connecting the clipping pipeline to multi-platform publishing:
- **Multi-Tenant Workspace Resolution:** Workspaces mapped to isolated client accounts across YouTube Shorts, Instagram Reels, TikTok, and X.
- **HMAC-SHA256 Signed Webhook Sync:** OmniPost dispatches cryptographic status events to `/api/v1/webhooks/omnipost`.
- **Crash Resilience:** Fail-closed state machines preventing double-posting on uncertain platform outcomes (`OUTCOME_UNKNOWN`).
- **Emergency Takedowns:** Instant post revocation across all social networks.

### 3. [Core System Architecture](ARCHITECTURE.md)
Detailed breakdown of the entire platform topology, from zero-quota discovery to final NVENC-accelerated FFmpeg compositing:
- High-level topology and Mermaid diagrams.
- 10-stage deterministic data lifecycle.
- Zero-VRAM graceful fallback cascade.
- Crash resilience and durable SQLite WAL job state machine.

### 4. [Podcast Split-Screen Engine](PODCAST_ENGINE.md)
Specialized guide for multi-speaker interview and podcast processing:
- Mathematical 9:8 stacked split-screen layout (host top, guest bottom, center divider).
- Dual-engine speaker diarization (`PyannoteDiarizerAdapter` and 0MB VRAM `AcousticEnergyDiarizer`).
- Automated shot detection and director close-up switching.
- Center-divider anchored animated subtitles (`MarginV = height // 2`).

### 5. [Model Context Protocol (MCP) Server](mcp.md)
Complete specification for LLM agent integration conforming to the `2024-11-05` standard:
- Discrete tool schemas: discovery, rights, transcription, highlight detection, dead-air pruning, vertical rendering, and job status.
- Line-delimited JSON-RPC 2.0 stdio transport guarantees.
- Setup instructions for Claude Desktop, Cursor, Antigravity, and custom LLM workflows.

### 6. [Active Speaker Tracking & Kinetic Captions](ACTIVE_SPEAKER_AND_CAPTIONS.md)
Deep dive into YuNet ONNX face detection, AutoFlip kinematic trajectory optimization (SciPy banded solver), and word-synced ASS subtitle animation presets (`hormozi`, `beast`, `neon`, `minimal`).

### 7. [Virality & Attribution Intelligence](VIRALITY_AND_ATTRIBUTION.md)
In-depth analysis of our outlier virality multiplier, hourly velocity equations, audience resonance gates ($LVR \ge 1.2\%$, $CVR \ge 0.03\%$), and creator compliance ledger.

---

## 🛡️ Production Operations & Test Reports

- **[Production Operations & Backup Guide](PRODUCTION_OPERATIONS_AND_BACKUP.md):** Complete operational runbook for production deployment, automated SQLite WAL backups, disaster recovery, and maintenance procedures.
- **[Comprehensive Test Report](COMPREHENSIVE_TEST_REPORT.md):** Exhaustive test suite telemetry covering all **712 certified passing tests** (597 Python pytest + 112 Node.js OmniPost + 3 Web Studio governance tests) with 100% pass rate.
- **[Final Production Certification Report](FINAL_PRODUCTION_CERTIFICATION_REPORT.md):** Formal audit of copyright enforcement, security barriers, double-post guards, and master `LEGAL_OFFICER` configuration.
- **[Release Readiness Report](RELEASE_READINESS_REPORT.md):** Verification of $\le 4\text{ GB}$ VRAM constraints, CPU fallbacks, zero-quota ingestion, and architectural boundaries.

---

## 🏛️ Architectural Decision Records (ADRs)

- **[ADR 0001: Clean-Room Modular Core](adr/0001-clean-room-modular-core.md)**
- **[ADR 0002: Hard Rights-Gate Enforcement](adr/0002-hard-rights-gate-enforcement.md)**
- **[ADR 0003: Views vs Retention Separation](adr/0003-views-vs-retention-separation.md)**
- **[ADR 0004: Autopost Adapter Contract](adr/0004-autopost-adapter-contract.md)**
