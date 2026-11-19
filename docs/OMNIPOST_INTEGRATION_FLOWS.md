# OmniPost 2.0 & YT-Clipping Intelligence: Integration Architecture & Flows

## Universal Short-Form Video Distribution Pipeline

This document defines the production integration architecture between **`yt-clipping-intelligence`** (the Upstream Video Processing & AI Clipping Engine) and **`OmniPost 2.0`** (the Downstream Universal Social Media Distribution & Publishing Infrastructure).

---

## 1. Architectural Division of Responsibilities

The pipeline cleanly decouples **content production** from **content distribution**:

```mermaid
flowchart LR
    subgraph Upstream ["yt-clipping-intelligence (First Half)"]
        A[YouTube Source / Live Stream] --> B[Audio Diarization & Whisper]
        B --> C[Hook Scorer & Viral Analysis]
        C --> D[Active Speaker Re-framing 9:16]
        D --> E[Burn Subtitles & Render Clip]
        E --> F[QA Verifier & Rights Clearance]
        F --> G[Human Approval Gate]
    end

    subgraph Downstream ["OmniPost 2.0 Universal Publisher (Second Half)"]
        H[POST /api/v2/ingest Gateway]
        I[Idempotency & Deduplication Ledger]
        J[Gemini AI Metadata Auto-Enrichment]
        K[Durable Distributed Queue]
        L[AES-256-GCM OAuth Token Vault]
        M[Multi-Platform Publishing Drivers]
        N[Analytics Aggregator & Feedback]
    end

    G -->|Zero-RAM Streaming Transfer| H
    H --> I
    I --> J
    J --> K
    K --> L
    L --> M
    M -->|YouTube Shorts| Y[YouTube API]
    M -->|Instagram Reels| IG[Meta Graph API]
    M -->|Facebook Reels| FB[Meta Graph API]
    M -->|LinkedIn Post| LI[LinkedIn API]
    M -->|Threads Post| TH[Threads API]
    Y & IG & FB & LI & TH --> N
    N -.->|Performance Feedback Loop| C
```

### Upstream (`yt-clipping-intelligence`) Responsibilities:
1. **Source Ingestion**: Downloading high-resolution source video/audio streams.
2. **Audio & Transcript Alignment**: Whisper transcription, silence pruning, diarization.
3. **Hook & Arc Detection**: Gemini virality scoring, moment selection, pacing analysis.
4. **Visual Editing**: Active speaker 9:16 face tracking, subtitle burning (Hormozi presets), outro cards.
5. **Gating & Governance**: Human approval authorization, rights clearance verification, QA report validation.

### Downstream (`OmniPost 2.0`) Responsibilities:
1. **Universal Upstream Gateway**: Accepting versioned content payloads (v1.0) via HTTP REST, multipart uploads, or remote media URLs.
2. **Zero-RAM Media Ingestion**: Direct O(1) buffer streaming for large media assets (up to 500 MB) without heap spikes.
3. **SSRF & Security Isolation**: Strict IP filtering and redirect validation blocking loopback (`127.0.0.1`), LAN, and cloud metadata (`169.254.169.254`).
4. **Idempotency & Deduplication Ledger**: Cross-platform SHA-256 checksums and source identity tracking (`workspace:system:asset_id`) to prevent accidental duplicate publishing.
5. **Gemini Metadata Auto-Enrichment**: Multi-platform title and caption adaptation tuned for each platform's culture and character limits.
6. **Distribution Intelligence**: Selecting compatible platforms based on media duration, aspect ratio, and distribution policies (`shorts_distribution`).
7. **Durable Distributed Queue**: Atomic job claiming, worker heartbeats, exponential backoff with jitter, dead-letter recovery.
8. **Credential Vault**: AES-256-GCM encrypted token storage with automatic OAuth 2.0 token refresh before publish.
9. **Analytics Feedback Loop**: Aggregating views, likes, shares, and engagement across all channels.

---

## 2. Ingestion API Specification (`POST /api/v2/ingest`)

### Endpoint
`POST /api/v2/ingest`

### Headers
| Header | Description |
| :--- | :--- |
| `Authorization` | `Bearer <OMNIPOST_API_KEY>` |
| `x-api-key` | `<OMNIPOST_API_KEY>` (Alternative) |
| `Content-Type` | `multipart/form-data` OR `application/json` |

---

### Option A: Direct Multipart Upload (Recommended for Local Pipeline)
Used when `yt-clipping-intelligence` has rendered the clip to local disk and streams it directly to OmniPost:

```http
POST /api/v2/ingest HTTP/1.1
Host: localhost:3300
Authorization: Bearer omnipost-admin-secret-2026
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW

------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="payload"

{
  "schema_version": "1.0",
  "source": {
    "system": "yt-clipping-intelligence",
    "job_id": "job_yt_9872",
    "asset_id": "clip_viral_01"
  },
  "media": {
    "filename": "clip_viral_01.mp4",
    "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "mime_type": "video/mp4",
    "size_bytes": 18450120
  },
  "content": {
    "title": "Why 99% of Developers Fail System Design",
    "description": "The secret difference between senior and junior architectures.",
    "tags": ["software", "coding", "shorts", "tech"],
    "language": "en"
  },
  "publishing": {
    "destinations": ["youtube", "instagram", "facebook"],
    "distribution_policy": "shorts_distribution",
    "schedule_mode": "automatic",
    "priority": "normal"
  },
  "enrichment": {
    "auto_enrich": true,
    "tone": "engaging"
  },
  "callback_url": "http://yt-clipping:8000/api/v1/callbacks/omnipost"
}
------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="file"; filename="clip_viral_01.mp4"
Content-Type: video/mp4

<BINARY VIDEO STREAM DATA>
------WebKitFormBoundary7MA4YWxkTrZu0gW--
```

---

### Option B: Remote URL Ingestion (Recommended for Cloud / CDN)
Used when clips are uploaded to S3, Google Cloud Storage, or Supabase Storage:

```http
POST /api/v2/ingest HTTP/1.1
Host: localhost:3300
Authorization: Bearer omnipost-admin-secret-2026
Content-Type: application/json

{
  "schema_version": "1.0",
  "source": {
    "system": "yt-clipping-intelligence",
    "job_id": "job_yt_9872",
    "asset_id": "clip_viral_02"
  },
  "media": {
    "url": "https://storage.googleapis.com/my-clips-bucket/clip_viral_02.mp4",
    "filename": "clip_viral_02.mp4",
    "checksum": "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e",
    "mime_type": "video/mp4",
    "size_bytes": 22401890
  },
  "content": {
    "title": "Insane AI Discovery in 2026",
    "description": "Watch what happens when you train multimodal models recursively.",
    "tags": ["ai", "tech", "viral"]
  },
  "publishing": {
    "destinations": ["youtube", "instagram"],
    "distribution_policy": "shorts_distribution",
    "schedule_mode": "scheduled",
    "scheduled_time": "2026-11-12T18:00:00.000Z"
  }
}
```

---

## 3. Response Contract & Status Codes

### Success Response (`201 Created` or `200 OK` for duplicate)
```json
{
  "success": true,
  "data": {
    "status": "accepted",
    "ingestion_id": "ing_1762846100123_8f2a1b",
    "asset_id": "ast_1762846100123_4c8d9e",
    "content_id": "P-84610012",
    "idempotency_key": "idemp_5d41402abc4b2a76b9719d911017c592",
    "source": {
      "system": "yt-clipping-intelligence",
      "job_id": "job_yt_9872",
      "asset_id": "clip_viral_01"
    },
    "media": {
      "filename": "clip_viral_01.mp4",
      "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "size_bytes": 18450120,
      "media_type": "video",
      "public_url": "http://localhost:3300/uploads/media/ast_1762846100123_4c8d9e_clip_viral_01.mp4"
    },
    "distribution": {
      "policy": "shorts_distribution",
      "destinations": ["youtube", "instagram", "facebook"],
      "ineligible_destinations": []
    },
    "enrichment": {
      "enriched": true,
      "variations": {
        "youtube": "Why 99% of Developers Fail System Design #shorts\n\nThe secret difference between senior and junior architectures.\n\n#shorts #viral #highlights",
        "instagram": "Why 99% of Developers Fail System Design\n\nThe secret difference between senior and junior architectures.\n\n#reels #shorts #viral #explore",
        "facebook": "Why 99% of Developers Fail System Design\n\nThe secret difference between senior and junior architectures.\n\n#reels #shorts #trending"
      }
    },
    "publishing": {
      "schedule_mode": "automatic",
      "scheduled_time": null,
      "status": "queued"
    }
  }
}
```

### Duplicate Response (`200 OK` - Skipped idempotently)
```json
{
  "success": true,
  "data": {
    "status": "duplicate_skipped",
    "duplicate": true,
    "ingestion_id": "ing_1762846100123_8f2a1b",
    "content_id": "P-84610012",
    "message": "Duplicate ingestion skipped; asset already processed and tracked."
  }
}
```

---

## 4. Python Drop-In Pipeline Implementation

The `yt-clipping-intelligence` project already includes the production-grade publisher adapter at:
[`src/yt_clipping/publisher/omnipost.py`](file:///C:/Users/cshar/Downloads/yt-clipping-intelligence/src/yt_clipping/publisher/omnipost.py).

### How to use it in automated clipping loops:

```python
from yt_clipping.publisher.omnipost import OmniPostPublisher
from yt_clipping.contracts.models import (
    RenderedClip,
    HighlightCandidate,
    RightsManifest,
    QAReport,
)

# 1. Initialize OmniPost Publisher
publisher = OmniPostPublisher(
    base_url="http://localhost:3300",
    api_key="omnipost-admin-secret-2026",
    default_platforms=["youtube", "instagram", "facebook"]
)

# 2. Check OmniPost Engine Health & Connected Channels
health = publisher.preflight_check()
if health.get("status") == "offline":
    print("WARNING: OmniPost server offline - clips will queue locally.")

# 3. Publish clip after QA & Human Approval
receipt = publisher.publish_clip(
    rendered_clip=rendered_clip,
    candidate=candidate,
    rights_manifest=rights_manifest,
    qa_report=qa_report,
    approved_by_user=True,  # Strict Human Authorization Gate
    platforms=["youtube", "instagram", "facebook"],
    scheduled_time="2026-11-12T17:00:00Z"  # Optional: None = publish immediately
)

print(f"Receipt ID: {receipt.receipt_id}")
print(f"Status: {receipt.status}")
print(f"Content ID: {receipt.response_payload.get('content_id')}")
```

---

## 5. Zero-RAM Streaming & Authentication Reliability

### Memory Management Best Practices
When processing batches of 10-50 shorts per video, memory conservation is critical:
- **No in-memory video buffers**: Never read full video files into Python or Node RAM (`video_bytes = f.read()`).
- **Stream directly from disk**: Use `open(file_path, "rb")` with chunked transfer encoding.
- **Immediate temporary unlinking**: When OmniPost encounters duplicate submissions or validation errors, temporary staged files are unlinked immediately via `safeDiscardStaged()` to prevent disk bloat.
- **Persistent Media Storing**: Upon acceptance, clips are moved to `web/uploads/media/<assetId>_<filename>` (or Supabase Storage), so scheduled jobs can publish days later without depending on ephemeral staging directories.

### Authentication & Token Rotation
- OmniPost encrypts all channel OAuth tokens using **AES-256-GCM** in `web/data/connected_accounts.json`.
- Tokens are automatically checked and refreshed **before each publishing attempt**.
- `yt-clipping-intelligence` only needs a single server-to-server API key (`AUTOMATION_SECRET_KEY`), completely isolating social media refresh tokens from the upstream clipping workers.

---

## 6. Asynchronous Webhook Signatures

When `callback_url` is provided in the ingestion payload, OmniPost sends signed event webhooks back to `yt-clipping-intelligence`:

### Verification in Python:
```python
import hmac
import hashlib

def verify_omnipost_webhook(payload_bytes: bytes, signature_header: str, secret: str) -> bool:
    expected = hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

### Supported Webhook Events:
- `asset.accepted`: Clip successfully ingested, verified, and queued.
- `post.published`: Clip successfully published to social destinations.
- `post.failed`: Publishing failed; retry policy or DLQ activated.

---

## 7. Operational Troubleshooting

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| `HTTP 401 Unauthorized` | Invalid or missing API key | Check `OMNIPOST_API_KEY` in `.env`. Ensure header is `Authorization: Bearer <key>` or `x-api-key: <key>`. |
| `HTTP 413 LIMIT_FILE_SIZE` | Video file exceeds 500 MB | Compress video or check why clip is > 500 MB (90s 1080x1920 clips should be 15-40 MB). |
| `HTTP 422 CHECKSUM_MISMATCH` | Corrupted upload or wrong hash | Verify upstream SHA-256 calculation matches file bytes before sending. |
| `DUPLICATE_SKIPPED` | Asset previously submitted | By design; idempotent protection prevented re-posting identical clip. |
| `NO_ELIGIBLE_DESTINATIONS` | Aspect ratio or duration mismatch | Ensure video duration <= 90s for Shorts/Reels and format is MP4/MOV/WebM. |

---

*Authored by Antigravity Engineering for OmniPost 2.0 & YT-Clipping Intelligence.*
