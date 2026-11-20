# Core clipping MVP verification

This is an evidence ledger, not a blanket certification of every experimental
subsystem. The core rights-aware spoken-content-to-vertical-clip path is verified.

## Architecture observed

The Next.js frontend runs on port 3050 and proxies `/api/v1`, `/clips`, and `/assets`
to FastAPI on port 8000. `web/server.py` exposes discovery, preview, render, editor,
project, rights, publishing, and external-ingestion routes. Studio rendering calls
`build_pipeline()` and `ClippingPipeline.process_video_multi()`.

The core pipeline assembles a rights policy, local/yt-dlp asset provider, cached
transcriber, context-aware segmenter, explainable scorer, FFmpeg renderer, media QA,
SQLite job journal, and publishing adapter. Studio requests dry-run handoff.
The repository also has separate podcast, SupoClip, and external-ingestion paths;
their output quality is not yet verified by this audit.

## Changes and evidence

- Strict media QA rejects missing audio and out-of-tolerance duration. OpenCV no
  longer claims it detected audio; missing dimensions are not invented.
- Studio uses strict final validation and excludes invalid clips from completed
  results. A regression test verifies this failure path.
- Oversized transcript splitting preserves trailing words. Word sanitization
  respects segment ends; silence-removal remapping clamps boundary words and
  preserves speaker and confidence metadata.
- CLI ingestion shares the studio URL validator, rejecting arbitrary text and
  lookalike domains.
- Render files, captions, CTA, and outro intermediates use unique sanitized names
  so repeated exports do not overwrite one another.
- Candidate bounds reject nonfinite and untyped timestamps and source overruns.
- Multi-clip rendering initializes transcription correctly. Batch polling no longer
  cancels work merely because FastAPI owns the worker handle.
- Sustained heatmap peaks retain their measured engagement window instead of being
  shortened around an early sentence payoff.
- Strict QA enforces H.264, yuv420p, and AAC when probe metadata is available.
- Production browser media is no longer anonymously exposed. A successful API-key
  request establishes a Secure, HTTP-only, SameSite session for native video,
  image, and download requests; development media remains available on localhost.
  The workspace menu provides first-run key entry, and the secret is excluded from
  persisted browser storage.
- Docker and Render deployment definitions now pass fail-closed authentication,
  rights, and execution settings. Container storage uses one durable `/app/data`
  volume instead of competing rendered-clip mounts.
- Direct package installation includes the dependencies imported by the Studio,
  resource governor, neural TTS, and subject segmentation paths.

Completed checks:

- Backend repository regression: 681 tests passed in 463.68 seconds. The final
  scheme-aware media-session adjustment also passed all 20 targeted adversarial
  rights/security tests.
- Frontend: `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- Production hardening and container specifications: 13 tests passed.
- Docker Compose configuration resolves successfully; `docker build --check .`
  completed with no warnings.
- Editable package dependency resolution completed successfully with pip's dry-run.
- `python -m yt_clipping doctor` passed all prerequisites. The machine has Python
  3.12, FFmpeg, CUDA visibility, writable stores, YuNet, YOLOv8, and Edge-TTS.

## Authorized spoken-media vertical slice

`scripts/verify_spoken_mvp.py` ran the production components against a locally
generated 40.12-second spoken source. CPU INT8 Faster-Whisper recovered 10 segments
and 102 timed words. Selection chose a complete 25.99-second thought (13.14-39.13),
scored 67.55, with a clean hook and payoff. Rendering produced a 7,740,822-byte
1080x1920 MP4 with burned word captions.

Strict QA passed with no errors or warnings: measured duration 26.00 seconds,
H.264 High video, yuv420p, AAC-LC audio, 30 fps, SAR 1:1, DAR 9:16, and matching
SHA-256 `5ffc60dc15909f53836d47ec017897ba147283c29723c46cae3f147bc15ae6af`.
Audio measured -20.3 dB mean and -0.3 dB peak. Frames at 2, 13, and 24 seconds
were inspected; framing stayed stable and captions were readable within the lower
safe area. The dry-run handoff completed with an idempotency key and verified rights.

## Scope boundaries

1. The real-media acceptance source is locally generated and owned. A third-party
   YouTube download was intentionally not used without explicit rights evidence.
2. Publishing was verified through the safe dry-run handoff. Live posting still
   requires operator credentials, platform approval, and a controlled canary.
3. Podcast, SupoClip, external AI ingest, and optional cloud enrichment remain
   separate feature paths; this ledger does not claim real-media acceptance for them.
4. Docker syntax and deployment configuration were validated, but the multi-gigabyte
   CUDA/model image was not fully built in this local acceptance run.
5. `ffprobe` is absent from this host's PATH. Strict verification successfully used
   the FFmpeg metadata fallback, including codec and pixel-format checks.

## Environment observations

Local Faster-Whisper base weights were exercised successfully. Existing source media
was not used because its rights were not established. The local `.env` legal-officer
setting was not changed; automated acceptance forces strict rights enforcement, and
the shipped configuration/deployment defaults set `LEGAL_OFFICER=true`.
