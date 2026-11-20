# Implementation Roadmap & Phase Milestones
## Project Dominance: Dependency-Aware Execution Plan

---

| Phase | Milestone Name | Scope & Core Deliverables | Status |
|---|---|---|---|
| **Phase 0** | **Repository Audit & Baseline** | Full architecture component map, test baseline verification, licensing audit in `THIRD_PARTY_NOTICES.md`. | ✅ Completed |
| **Phase 1** | **Timeline & Transcription Precision** | `snap_clip_to_words()` in `timeline.py`, `merge_continuation_words()` in `transcriber.py`, canonical timeline schema. | ✅ Completed |
| **Phase 2** | **Local Media Intelligence** | Energy/VAD speech detection, scene change detection, silence region identification, local candidate pre-filtering. | ⚡ In Progress |
| **Phase 3** | **Editorial Intelligence** | Gemini 2-pass contextual evaluation (2-Second Hook Test, Hook Playbook, 8 Virality Signals), token-cost caching. | ⚡ In Progress |
| **Phase 4** | **Automated Cinematography** | True lip-motion active speaker tracking (`active_speaker.py`), dynamic split-screen coordinates, audio punch-in zoom. | ✅ Completed |
| **Phase 5** | **Professional Captions & Audio** | ASS split-seam anchoring (`\an5` / `alignment: 5`), contrast pill-box styles, Pillow `line_fitter`, loudness normalization. | ✅ Completed |
| **Phase 6** | **Trend Intelligence** | YouTube Data API v3 quota-governed chart collector, historical velocity snapshot store, content opportunity engine. | ✅ Completed |
| **Phase 7** | **Rendering & Independent QA** | Multi-GPU hardware detection (NVENC/QSV/AMF/CPU), atomic finalization, 12-check automated QA validation. | 📋 Scheduled |
| **Phase 8** | **Studio Integration** | Text-based editing in Next.js, interactive transcript scrubbing, real-time 9:16 phone preview, authentic data guarantee. | 📋 Scheduled |
| **Phase 9** | **Benchmark & Certification** | Regression test certification, word-boundary precision benchmarks, zero-mock production audit. | 📋 Scheduled |

---

## Technical Debt & Defect Resolution Tracking

| Defect / Debt Item | Root Cause | Resolution Module | Target Phase | Status |
|---|---|---|---|---|
| **Audio Mid-Word Cutoff** | Float timestamps sliced between syllables | `snap_clip_to_words()` in `timeline.py` | Phase 1 | ✅ Resolved |
| **Broken Compound Subtitles** | `strip()` applied before merging continuation tokens | `merge_continuation_words()` in `transcriber.py` | Phase 1 | ✅ Resolved |
| **Pseudo-Active Speaker** | Naive largest-face selection without speech verification | Lip-motion frame diff + audio RMS gating in `active_speaker.py` | Phase 4 | ✅ Resolved |
| **Hardcoded Split Screen** | Static left `0:0` and right `iw-ow:0` crop coordinates | Dynamic face-centroid offsets in `renderer.py` | Phase 4 | ✅ Resolved |
| **Left-Side Crop Jumps** | False-positive micro-detections starting at edge coordinates | Minimum face dimension floor + center anchor in `trajectory.py` | Phase 4 | ✅ Resolved |
| **Dead FLUX Code** | Deprecated creative evaluation blocks in pipeline | Removed from pipeline; clean removal of dead endpoints | Phase 0 | ✅ Resolved |
