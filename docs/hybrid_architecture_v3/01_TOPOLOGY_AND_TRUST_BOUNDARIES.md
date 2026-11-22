# 01 — System Topology & Trust Boundaries

## 1. Physical & Network Topology

The architecture divides the system into three distinct security and runtime zones:
1. **The Remote Client Zone:** Desktop and mobile browsers accessing the studio over public HTTPS.
2. **The Cloud Control Plane:** Hosted on Render.com with Supabase managed services. Operates strictly as a metadata coordinator.
3. **The Local Edge Compute Zone:** The user's workstation running a native supervisor behind home NAT/firewall.

```mermaid
flowchart TB
  subgraph Public Internet
    U[Remote Browser / Mobile Safari]
    SRC[Authorized Video / Audio Source]
    SOC[YouTube / Instagram / Facebook / Threads]
    AI[Optional Gemini Flash API]
  end

  subgraph Cloud Control Plane [Render.com + Supabase Free]
    UI[Render Static Site: Next.js Export]
    API[Render Web API: FastAPI Coordinator]
    PG[(Supabase PostgreSQL: Metadata & Leases)]
    AU[Supabase Auth: User Session JWTs]
    ST[(Supabase Storage: Opt-in 360p Proxies)]
  end

  subgraph Edge Compute Zone [User Workstation: i5-10300H + GTX 1650]
    direction TB
    LUI[Local Studio Browser on 127.0.0.1:8765]
    EW[Native Worker Supervisor: yt_clipping.worker]
    SQ[(Local SQLite WAL: Canonical State & Outbox)]
    FS[(Local NVMe SSD: Media Cache & Exports)]
    ML[ASR Subprocess: Faster-Whisper + Silero VAD]
    FF[Render Subprocess: FFmpeg NVENC + YuNet ONNX]
    PUB[Publishing Engine & OS Credential Vault]
  end

  %% Client interactions
  U -->|HTTPS Static HTML/JS| UI
  U <-->|HTTPS JSON + JWT| API
  U <-->|Auth Sign-in / MFA| AU
  U -->|Signed URL Read: 360p Proxy| ST

  %% Cloud internal links
  API <-->|TLS Pooled Conn (PgBouncer)| PG
  API -->|Generate Scoped Signed Upload URL| ST

  %% Edge pull interactions (Outbound ONLY)
  EW <-->|HTTPS POST /worker/sync (Bearer Token)| API
  EW -->|Direct Upload: 360p Proxy| ST
  SRC -->|Audio/Video Stream (Range chunks)| EW
  EW <-->|Text Prompts Only (Opt-in)| AI
  PUB -->|Direct Resumable Upload (Residential IP)| SOC

  %% Edge internal links
  LUI -->|Loopback HTTP + Ephemeral Token| EW
  EW <--> SQ
  EW <--> FS
  EW -->|Spawns with isolated VRAM| ML
  EW -->|Spawns with hardware encoder| FF
  EW -->|Invokes with local OAuth secrets| PUB

  %% Class styling
  classDef cloud fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
  classDef edge fill:#022c22,stroke:#34d399,stroke-width:2px,color:#f8fafc;
  classDef external fill:#1e1b4b,stroke:#a78bfa,stroke-width:2px,color:#f8fafc;

  class UI,API,PG,AU,ST cloud;
  class LUI,EW,SQ,FS,ML,FF,PUB edge;
  class U,SRC,SOC,AI external;
```

---

## 2. Inbound vs Outbound Data Flow Rules

> [!IMPORTANT]
> **Zero Inbound Ports on the Workstation:** The edge device never opens a public port, never runs an ngrok/Cloudflare tunnel, and never accepts inbound connections from Render or the internet. All communication between the edge worker and the cloud control plane is **outbound-initiated HTTPS** by the edge worker.

| Route | Initiator | Protocol | Payload Type | High-Bandwidth Media? |
|---|---|---|---|:---:|
| Remote Browser -> Render Static | Browser | HTTPS GET | Compressed JS/CSS/HTML | No |
| Remote Browser <-> Render API | Browser | HTTPS JSON | REST metadata, commands, approvals | No |
| Render API <-> Supabase Postgres | Render API | TLS TCP | SQL statements, leases, state | No |
| **Edge Worker <-> Render API** | **Edge Worker** | **HTTPS POST** | **Sync JSON (heartbeat, outbox, commands)** | **No** |
| Edge Worker -> Media Source | Edge Worker | HTTPS GET | Raw audio streams, video byte ranges | **Yes (Direct)** |
| Edge Worker -> Supabase Storage | Edge Worker | HTTPS PUT | Compressed 360p preview video (<3 MB) | Optional |
| Edge Worker -> Social Providers | Edge Worker | HTTPS POST/PUT | Resumable video upload (final 9:16 Short) | **Yes (Direct)** |
| Local Browser -> Local Worker | Local User | HTTP Loopback | Studio UI & video streaming (`127.0.0.1:8765`) | Local Only |

---

## 3. Component Ownership Matrix

Every architectural component has strict boundaries defining what it owns and what it is forbidden from doing:

| Component | Owns & Manages | Must NEVER Do |
|---|---|---|
| **Render Static Frontend** | - Fast, cached studio UI delivery<br>- Client-side Zustand stores<br>- Word-level subtitle preview scrubbing | - Store platform API keys or OAuth secrets<br>- Execute ML models or video rendering<br>- Assume edge workstation is online |
| **Render Web API Facade** | - User authentication & workspace authorization<br>- Atomic job leasing & monotonic fencing<br>- Quota counters & rate-limiting<br>- Command queue for paired devices | - Download source video or audio bytes<br>- Start FFmpeg or run ML inference<br>- Proxy heavy media bytes to users<br>- Store state on ephemeral local disk |
| **Supabase Cloud** | - PostgreSQL relational metadata<br>- Row-Level Security (RLS) policies<br>- User authentication (JWT issuance)<br>- Private storage for 360p review proxies | - Store raw/final source videos by default<br>- Expose admin service-role keys to clients<br>- Act as a general-purpose file CDN |
| **Edge Worker Supervisor** | - Local SQLite state & outbox<br>- Sequential GPU/CPU stage scheduling<br>- Source downloading & range merging<br>- Hardware FFmpeg rendering & QA<br>- Direct social media uploading | - Accept arbitrary bash or shell commands<br>- Expose public HTTP listeners<br>- Bypass human approval gates<br>- Execute multiple heavy stages concurrently |
| **Publishing Adapters** | - Local OAuth token refresh & vault storage<br>- Provider-specific resumable chunking<br>- Publishing receipt verification<br>- Reconciliation of interrupted posts | - Automatically retry ambiguous uploads<br>- Blindly repost on network timeout<br>- Transmit user social tokens to the cloud |

---

## 4. Free-Tier Envelope & Infrastructure Guardrails

The architecture is explicitly sized to run permanently within the zero-cost free tiers of modern cloud providers:

### 4.1 Render.com Free Tier
- **Static Site:** Free hosting, global CDN, zero cold start.
- **Web Service:** Free instance with **512 MB RAM** and **0.5 vCPU**.
- **Sleep Policy:** Free web services sleep after ~15 minutes of inactivity. When asleep, incoming requests take 30–50 seconds to wake up (cold start).
- **Bandwidth:** 5 GB/month shared across the account.
- **Architectural Safeguard:** The Render API service has an ultra-lean footprint (<120 MB RAM peak). It never downloads media, ensuring it stays well under the 512 MB limit. The edge worker uses adaptive timeouts (75s read timeout) to tolerate cloud cold wake-ups smoothly.

### 4.2 Supabase Free Tier
- **PostgreSQL Database:** 500 MB storage capacity.
- **Auth:** 50,000 monthly active users.
- **File Storage:** 1 GB storage limit, 50 MB per-file upload cap.
- **Egress:** 5 GB/month uncached egress.
- **Inactivity Pausing:** Free projects pause after 7 days of inactivity.
- **Architectural Safeguard:** Relational tables store only compact metadata (an average job record uses <4 KB). Remote previews are capped at 360p (~2.5 MB) with strict 720-hour (3-day) auto-deletion. Total cloud storage stays under 250 MB even with 50 active preview clips.

### 4.3 Google & Meta Developer Quotas
- **YouTube Data API v3:** 10,000 daily quota units baseline (with dedicated insert and search buckets).
- **Meta Graph API:** 200 calls/hour per app user.
- **Architectural Safeguard:** Video search queries are cached for 30 minutes in PostgreSQL. Uploads are streamed directly from edge via resumable chunk protocols, consuming only standard insert quota points without intermediary proxies.
