# Local-First Hybrid Architecture V3 — Comprehensive Specification & System Notes

This directory contains the modularized, in-depth architectural specifications, operational blueprints, and codebase bridge plans derived from **`YT_Clipper_Architecture_V3.md`** for **YouTube Clipping Intelligence** (`yt-clipping-intelligence`).

---

## Modular Documentation Sitemap

| Module | File | Core Topics Covered |
|---|---|---|
| **00** | [00_EXECUTIVE_SUMMARY_AND_DECISIONS.md](file:///c:/Users/cshar/Downloads/yt-clipping-intelligence/docs/hybrid_architecture_v3/00_EXECUTIVE_SUMMARY_AND_DECISIONS.md) | V1 vs V2 vs V3 evolution, ADR-01 through ADR-10, operating modes (Standalone, Connected, Metered), ₹0 cost mandate. |
| **01** | [01_TOPOLOGY_AND_TRUST_BOUNDARIES.md](file:///c:/Users/cshar/Downloads/yt-clipping-intelligence/docs/hybrid_architecture_v3/01_TOPOLOGY_AND_TRUST_BOUNDARIES.md) | System topology diagram (Mermaid), network flows, component ownership matrix, free-tier envelopes (Render + Supabase). |
| **02** | [02_EDGE_DATA_PLANE_AND_GPU_PIPELINE.md](file:///c:/Users/cshar/Downloads/yt-clipping-intelligence/docs/hybrid_architecture_v3/02_EDGE_DATA_PLANE_AND_GPU_PIPELINE.md) | 11-stage pipeline, CTranslate2 vs PyTorch 4GB VRAM puzzle, isolated subprocesses, audio-first acquisition, YuNet ONNX, NVENC. |
| **03** | [03_NATIVE_VS_DOCKER_DEPLOYMENT.md](file:///c:/Users/cshar/Downloads/yt-clipping-intelligence/docs/hybrid_architecture_v3/03_NATIVE_VS_DOCKER_DEPLOYMENT.md) | Why Native Supervised Python is the Windows baseline, Windows Job Objects, Credential Manager, optional Docker specs, 15-point parity gate. |
| **04** | [04_PERSISTENCE_STATE_AND_LEASES.md](file:///c:/Users/cshar/Downloads/yt-clipping-intelligence/docs/hybrid_architecture_v3/04_PERSISTENCE_STATE_AND_LEASES.md) | Dual-persistence (Cloud Postgres vs Edge SQLite WAL), monotonic fencing tokens, atomic skip-locked query, two-phase disk commit. |
| **05** | [05_API_SPEC_AND_SYNC_PROTOCOL.md](file:///c:/Users/cshar/Downloads/yt-clipping-intelligence/docs/hybrid_architecture_v3/05_API_SPEC_AND_SYNC_PROTOCOL.md) | Browser REST endpoints, worker sync protocol (`POST /worker/sync`), adaptive polling schedule (180s idle / 30s active), cold start handling. |
| **06** | [06_BANDWIDTH_AND_PREVIEW_POLICY.md](file:///c:/Users/cshar/Downloads/yt-clipping-intelligence/docs/hybrid_architecture_v3/06_BANDWIDTH_AND_PREVIEW_POLICY.md) | Traffic routing matrix, NetworkGovernor byte pacing, 100-video monthly budget accounting, metadata-first review, on-demand 360p proxies. |
| **07** | [07_SOCIAL_PUBLISHING_ADAPTERS.md](file:///c:/Users/cshar/Downloads/yt-clipping-intelligence/docs/hybrid_architecture_v3/07_SOCIAL_PUBLISHING_ADAPTERS.md) | Residential IP advantage, YouTube/IG/FB/Threads adapters, split OAuth, two-stage approval gate, `RECONCILE_REQUIRED` zero-blind-retry guard. |
| **08** | [08_SECURITY_QUOTAS_AND_CIRCUIT_BREAKERS.md](file:///c:/Users/cshar/Downloads/yt-clipping-intelligence/docs/hybrid_architecture_v3/08_SECURITY_QUOTAS_AND_CIRCUIT_BREAKERS.md) | Layered request admission, token bucket vs Postgres counters, provider circuit breakers (429, 401, 403, 5xx), threat model & mitigations. |
| **09** | [09_IMPROVISATIONS_AND_REPO_BRIDGE_PLAN.md](file:///c:/Users/cshar/Downloads/yt-clipping-intelligence/docs/hybrid_architecture_v3/09_IMPROVISATIONS_AND_REPO_BRIDGE_PLAN.md) | 5 architectural improvisations, concrete mapping to existing codebase modules, 5-phase execution roadmap. |

---

## Core System Principles at a Glance

1. **₹0 Infrastructure Cost:** Operates 100% within free tiers (Render Free Web Service + Static Site, Supabase Free PostgreSQL/Auth/Storage). No credit card required.
2. **Audio-First Acquisition:** Ingests only ~30–45 MB mono audio for transcription and scoring. Downloads only the selected 45-second video spans, slashing bandwidth by 95%+.
3. **Sequential GPU VRAM Staging:** Faster-Whisper runs in an isolated subprocess that terminates completely, returning 100% VRAM to the OS before YuNet face tracking and FFmpeg NVENC (180–240 FPS) begin.
4. **Outbound-Only Pull Architecture:** Zero inbound ports on the user's workstation. Edge worker polls `POST /api/v1/worker/sync` with atomic database row-level locking and monotonic fencing tokens.
5. **Residential IP Social Publishing:** Dispatches approved Shorts to YouTube, Instagram, and Facebook directly from the user's home IP, bypassing cloud datacenter bot detection, protected by a fail-closed human approval release gate.
