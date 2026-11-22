# 04 — Persistence, Distributed State & Lease Protocol

## 1. The Dual-Persistence Architecture

To guarantee both **zero-cost cloud scalability** and **100% offline edge autonomy**, state is partitioned strictly between two databases:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CLOUD DATABASE: SUPABASE POSTGRESQL                  │
│                                                                        │
│  Owns: Multi-tenant metadata, user auth, device pairing, typed command  │
│        queue, human approval revisions, and quota accounting.          │
│  Size: < 50 MB total (< 10% of free 500 MB limit).                    │
│  Contains ZERO raw media, ZERO file paths, ZERO binary blobs.          │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │
                         Sync via Outbound HTTPS
                         POST /api/v1/worker/sync
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                    EDGE DATABASE: LOCAL SQLITE (WAL)                   │
│                                                                        │
│  Owns: Physical file references, on-disk manifests, stage checkpoints, │
│        local event outbox, resumable chunk offsets, and token vault.   │
│  Mode: PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;               │
│  Single coordinated writer; 100% functional during cloud outages.      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Cloud Relational Model (PostgreSQL)

The cloud database contains 14 normalized, indexed tables governed by Row-Level Security (RLS):

```sql
-- Core Distributed Job Queue Table
CREATE TABLE private.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    job_type TEXT NOT NULL CHECK (job_type IN ('ANALYZE', 'RENDER', 'GENERATE_PREVIEW', 'PUBLISH', 'RECONCILE')),
    state TEXT NOT NULL CHECK (state IN ('QUEUED', 'LEASED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRY_WAIT', 'BLOCKED_RESOURCE', 'BLOCKED_NETWORK', 'BLOCKED_POLICY', 'CANCELED')),
    stage TEXT NOT NULL,
    revision_id UUID REFERENCES public.clip_revisions(id),
    priority INTEGER NOT NULL DEFAULT 5,
    fence BIGINT NOT NULL DEFAULT 0,
    lease_expires_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index for instantaneous atomic queue claims
CREATE INDEX idx_jobs_claimable 
ON private.jobs (device_id, priority DESC, available_at, created_at)
WHERE state = 'QUEUED' AND cancel_requested = FALSE;

-- Index for detecting stale expired leases
CREATE INDEX idx_jobs_expired_leases
ON private.jobs (state, lease_expires_at)
WHERE state IN ('LEASED', 'RUNNING');
```

---

## 3. Atomic Lease Protocol & Monotonic Fencing

### 3.1 The Split-Brain Dilemma
In distributed systems, a slow or stalled worker might resume processing after its lease has expired, overwriting newer revisions or duplicate-rendering clips. Architecture V3 solves this using **Monotonic Fencing Tokens**.

### 3.2 The Atomic Claim Query
When an edge worker polls for a new job, the cloud control plane runs an atomic transaction using row-level locking:

```sql
WITH next_job AS (
    SELECT id 
    FROM private.jobs
    WHERE (device_id = :authorized_device_id OR device_id IS NULL)
      AND workspace_id = :authorized_workspace_id
      AND state = 'QUEUED'
      AND available_at <= now()
      AND cancel_requested = FALSE
    ORDER BY priority DESC, available_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED 
    LIMIT 1
)
UPDATE private.jobs AS j
SET 
    state = 'LEASED',
    device_id = :authorized_device_id,
    fence = j.fence + 1,                                -- Monotonic fencing token
    lease_expires_at = now() + interval '120 seconds',  -- 120s TTL
    attempts = j.attempts + 1,
    updated_at = now()
FROM next_job n 
WHERE j.id = n.id
RETURNING j.id, j.job_type, j.fence, j.lease_expires_at;
```

### 3.3 Lease Renewal & Fence Validation
1. While the edge worker executes a stage, it sends a heartbeat every **30 seconds** in its sync call:
   ```json
   { "leases": [{ "job_id": "j_123", "fence": 8 }] }
   ```
2. The server extends `lease_expires_at = now() + interval '120 seconds'` **only if** the provided `fence` matches `jobs.fence` and `state IN ('LEASED', 'RUNNING')`.
3. If a network disruption lasts longer than 120 seconds and another worker claims the job, the original worker's next sync request is rejected with `409 LEASE_STALE`. The worker immediately halts execution and aborts writing artifacts.

---

## 4. Local SQLite & Filesystem Architecture

### 4.1 Canonical On-Disk Directory Structure
```text
<data-root>/
├── state/
│   ├── worker.sqlite3        # SQLite WAL database (schema, outbox, checkpoints)
│   ├── worker.sqlite3-wal    # Write-Ahead Log
│   └── instance.lock         # Single-process mutual exclusion file
├── models/                   # Immutable AI weights (pinned SHA-256)
│   └── faster-whisper/
│       └── small-int8/
├── cache/
│   ├── audio/                # Content-addressed 16kHz mono audio tracks
│   └── transcripts/          # Cached transcripts (keyed by source_hash + model)
├── projects/
│   └── <project-uuid>/
│       ├── source/           # Downloaded media ranges
│       ├── analysis/         # YuNet face tracking trajectories
│       └── revisions/
│           └── <revision-id>/
│               ├── output.mp4       # Master 1080x1920 60fps Short
│               ├── subtitles.ass    # Hormozi/Beast styled subtitles
│               ├── manifest.json    # Immutability certificate & QA report
│               ├── preview.mp4      # Lightweight 360p video (2.5 MB)
│               └── poster.webp      # 1080x1920 thumbnail (35 KB)
├── scratch/                  # Temporary render chunks (cleaned after render)
└── logs/                     # Structured JSON logs (redacted PII)
```

### 4.2 Two-Phase Disk Commit
To ensure absolute resilience against power loss, blue screens, or worker kills:
1. Every stage writes output to a temporary file: `output.mp4.part`.
2. FFmpeg flushes and closes file handles.
3. The worker verifies file integrity (checks video duration, non-zero file size, and computes `SHA-256`).
4. **Phase 1 (Atomic Rename):** `os.replace("output.mp4.part", "output.mp4")` replaces the destination atomically on the same filesystem.
5. **Phase 2 (SQLite Commit):** In a single SQLite transaction:
   - The stage checkpoint is marked `COMPLETED`.
   - The output artifact record is inserted.
   - An outbox sync event (`STAGE_COMPLETED`) is enqueued.
6. If the worker dies between Step 4 and Step 5, the startup reconciler discovers the valid `output.mp4` on disk, verifies its checksum against the manifest, and cleanly commits Step 5 without re-rendering.

---

## 5. Repository Quirk 1 Resolution: Server Restart Lease Recovery

### The Bug in Previous Code (`job_manager.py:107–116`)
```python
# PREVIOUS UNHEALTHY CODE:
conn.execute(
    """
    UPDATE render_jobs
    SET status = 'failed',
        message = 'Render interrupted by server restart',
        error = 'Process restart'
    WHERE status IN ('rendering', 'queued')
    """
)
```
*Why this broke distributed workers:* If the cloud container restarted or cycled, it marked all in-flight and queued jobs as `failed`, destroying user renders that were actively running on local edge workstations!

### The Architecture V3 Fix
In V3, startup reconciliation never fails active jobs:
```python
# V3 DISTRIBUTED RECOVERY:
conn.execute(
    """
    UPDATE render_jobs
    SET status = 'queued',
        worker_id = NULL,
        lease_expires_at = NULL,
        message = 'Lease reset for worker re-claim after server restart'
    WHERE status = 'rendering'
      AND (lease_expires_at IS NULL OR lease_expires_at < datetime('now'))
    """
)
```
Jobs with expired leases are smoothly returned to `QUEUED`. When the local edge worker heartbeats, it either re-claims the lease or reconciles its completed artifact from disk.
