# MASTER SYSTEM & FULL-STACK AUDIT DIRECTIVE
**Target Application**: YouTube Clipping Intelligence (FastAPI Backend `:8000` + Next.js 15 Studio `:3050`)  
**Execution Standard**: Zero-Mock Compliance, Real End-to-End API Verification, Single-Screen Viewport Ergonomics, High-Contrast Light Theme Integrity.

---

## 🎯 AGENT MISSION OBJECTIVE
You are acting as the Principal Lead Quality Assurance & Systems Integration Engineer. Your mandate is to conduct an uncompromising, tab-by-tab end-to-end verification of all **7 primary sidebar views** of the YouTube Clipping Intelligence platform. 

Every UI control, interactive widget, video canvas, button, slider, and data metric rendered on screen must have a tangible purpose, operate without runtime errors, and correctly bind to genuine FastAPI backend endpoints. You must eliminate all non-functional stubs, mock fallbacks, theme contrast defects, and layout overflows.

---

## 🛡️ STRICT OPERATIONAL GROUND RULES
1. **Zero-Mock Policy**: If data can be fetched from the backend or derived from genuine video media, mock or dummy arrays (e.g., hardcoded `"THE SECRET"` subtitles or static placeholder clips) are strictly forbidden.
2. **Theme Contract (Light Mode Priority)**: The application must operate flawlessly in the user's active theme. No hardcoded dark patches (`bg-black/95`, `bg-zinc-950`) on cards, panels, or transcript rows in Light Theme. Video viewports themselves remain black to preserve contrast, but all surrounding decks, controls, borders, and typography must use theme tokens (`bg-card`, `text-foreground`, `border-border/80`).
3. **Viewport Discipline**: No interactive action (such as playhead scrubbing or transcript sentence tracking) may auto-scroll or drag the parent browser window. All list-based views must use container-scoped scrolling (`container.scrollTo()`).
4. **Empirical Verification**: Do not claim an endpoint or UI control works until you have verified it with a live HTTP request, test suite execution, or component build validation (`npm run build` and `pytest`).

---

## 📋 TAB-BY-TAB AUDIT MATRIX & VERIFICATION PROTOCOL

### TAB 1: VIRAL DISCOVERY (`/` or `activeTab === 'discovery'`)
**Core Components**: `UrlIngestionBar`, `TrendingModal`, `RetentionCurve`, `CandidateGrid`, `MetadataCard`  
**Backend Endpoints**: `POST /api/v1/metadata`, `POST /api/v1/preview`, `GET /api/v1/trending/top10m`

- [ ] **1.1 URL Ingestion Bar & Regex Parser**:
  - Test valid YouTube URLs: standard watch (`v=...`), short links (`youtu.be/...`), Shorts (`/shorts/...`), and raw 11-character video IDs (`hdMszZ2ah5Q`, `KTDJ1VpSDTI`).
  - Verify invalid input triggers immediate inline warning without throwing uncaught client exceptions.
  - Verify `Recent:` history chips populate, switch active video on click, and allow single-click removal.
- [ ] **1.2 Top 10M Viral Trending Modal**:
  - Verify modal opens, triggers `GET /api/v1/trending/top10m`, and renders genuine trending cards (thumbnails, channels, view counts).
  - Test 1-click ingest: clicking "Analyze" must feed the video ID directly into the analysis pipeline.
- [ ] **1.3 Video Metadata Card & Global Render Trigger**:
  - Verify metadata displays: Title, Channel, Duration, View count, Like count, and Published date.
  - Test "Render Clips" button: verifies NVENC/CPU render dispatch via `POST /api/v1/render`, registering a task in `useTaskStore`.
- [ ] **1.4 Audience Retention Curve**:
  - Verify SVG Catmull-Rom spline path renders genuine retention telemetry (`points` or modeled Gaussian candidate peaks).
  - Verify interactive scrubber: hover reveals timestamp and retention percentage tooltip; clicking a peak hotspot highlights corresponding candidate.
  - Ensure zero division or `NaN` errors when video duration is loading.
- [ ] **1.5 Highlight Candidate Grid**:
  - Check candidate cards: Virality score badge, hook title, start/end timestamps, virality metric progress bars.
  - Test actions on card: "Open in Editor" (transfers timecode and switches to Tab 3), "Render Short" (dispatches single cut render), "Regenerate Captions" (calls `POST /api/v1/clips/{id}/regenerate_caption`).

---

### TAB 2: STUDIO WORKSPACE (`/studio` or `activeTab === 'studio'`)
**Core Components**: `StudioWorkspace`, `PhonePlayer`, `SupoClipControls`, `ViralityDiagnostics`, `CaptionsAttribution`  
**Backend Endpoints**: `GET /api/v1/clips`, `GET /api/v1/clips/{id}/media`, `POST /api/v1/supoclip/plan`, `POST /api/v1/supoclip/score`, `POST /api/v1/analytics/feedback`

- [ ] **2.1 SupoClip AI Engine Workflow Controller**:
  - Verify Workflow Objectives (Viral Highlights, Episodic Series, Topic Deep-Dive, Executive Recap).
  - Verify 9:16 Video Composition selector: Active Speaker (AI Smart Crop), Ambient Flowing Blur, Split Screen Stack.
  - Verify Animated Caption Style presets (Hormozi, MrBeast, Minimal, TikTok, Neon, Podcast).
  - Test "Plan Workflow": sends objective + instructions to `POST /api/v1/supoclip/plan` and displays planned segment windows.
- [ ] **2.2 Live 9:16 Smartphone Mockup & Media Player**:
  - Verify video stream connects: `GET /api/v1/clips/{id}/media` or source video slice.
  - Test Ambient Flowing Blur: background blurred 9:16 video synchronizes play/pause with foreground sharp letterbox.
  - Test Safe Zone Overlays: toggle Off, TikTok, Instagram Reels, YouTube Shorts to verify overlay guidelines.
  - Test Real-time Subtitle sync: subtitles update in sync with video currentTime without flashing or dropping words.
- [ ] **2.3 Virality Diagnostics Matrix**:
  - Verify 4 core telemetry scores: Hook Strength (0-100%), Narrative Velocity (0-100%), Visual Retention (0-100%), Loop Polish (0-100%).
  - Verify AI Editorial Rationale text renders with proper typography.
  - Test Creator Virality Review (5-star rating): triggers `POST /api/v1/analytics/feedback` and saves calibration.
- [ ] **2.4 Multi-Platform Captions & Attribution**:
  - Verify title and hashtags formatted for YouTube Shorts, TikTok, and Instagram Reels.
  - Test "Copy Caption" button: writes formatted text with emojis and hashtags to clipboard and shows toast.

---

### TAB 3: VIDEO EDITOR (`/editor` or `activeTab === 'editor'`)
**Core Components**: `TimelineEditor`, Dual Canvases, Interactive Crop Box, Acoustic Waveform Scrubber, Descript-style Spoken Transcript  
**Backend Endpoints**: `GET /api/v1/source/{video_id}`, `GET /api/v1/source/{video_id}/transcript`, `POST /api/v1/editor/export`

- [ ] **3.1 Single-Screen Ergonomics & Layout Fit**:
  - Ensure the entire editor (16:9 canvas, transport controls, crop presets, waveform, spoken transcript, 9:16 phone preview, and subtitle styles) fits within ~600px height.
  - Confirm ZERO parent window scrolling occurs during playback or transcript seeks.
- [ ] **3.2 Original 16:9 Master Video Canvas**:
  - Test playback transport: Play/Pause, Rewind -10s, Step -1s, Step +1s, Forward +10s, Jump to Start.
  - Test speed controls: 1.0x, 1.25x, 1.5x, 2.0x.
  - Test Mute/Unmute and Fullscreen toggles.
  - Test interactive 9:16 crop bounding box: draggable across video with live X% coordinate readout.
  - Test AI Framing Presets: AI Smart Center, Left (30%), Center (50%), Right (70%), Ambient Blur.
- [ ] **3.3 Acoustic Waveform Scrubber**:
  - Verify HTML5 canvas draws acoustic bars with dynamic light/dark theme contrast.
  - Test In/Out markers (`[I]` and `[O]` keyboard shortcuts or buttons): updates trim window and calculates `trimDuration`.
  - Test Quick Cut buttons: 30s Cut, 60s Cut, Full Video reset.
- [ ] **3.4 Descript-Style Spoken Transcript Editor**:
  - Verify Whisper word-level timestamps load via `GET /api/v1/source/{video_id}/transcript`.
  - Test dialogue search: filters matching sentences instantly.
  - Test "Hooks Only" filter: filters sentences to high-energy hooks and payoffs.
  - Test sentence actions: clicking sentence seeks playhead; clicking `[ Set In ]` or `[ Set Out ]` snaps trim window; clicking `Cut Sentence` isolates that single sentence as a Short.
- [ ] **3.5 Right Column 9:16 Phone Preview & Style Controls**:
  - Verify synchronized playback with left canvas.
  - Test Viral Hook Title Overlay input: toggle ON/OFF and edit text.
  - Test Animated Caption Style pills: Bold Yellow, Neon Cyan, Gradient Fire, Clean White.
  - Test "Apply Crop & Render": submits export request to `POST /api/v1/editor/export` and starts background task.

---

### TAB 4: PROJECTS ARCHIVE (`/projects` or `activeTab === 'projects'`)
**Core Components**: `ProjectsArchive`, `ProjectCard`, `ProjectFilterBar`, `BatchDownloadModal`  
**Backend Endpoints**: `GET /api/v1/projects`, `GET /api/v1/projects/{id}`, `DELETE /api/v1/projects/{id}`, `GET /api/v1/supoclip/export/zip`

- [ ] **4.1 Projects Grid & Status Tracking**:
  - Verify `GET /api/v1/projects` returns genuine project records with thumbnail, title, clip counts, and timestamp.
  - Test filter bar: search by title/video ID, filter by status (Completed, In Progress, Failed).
- [ ] **4.2 Project Inspection & Clip Playback**:
  - Clicking a project opens project modal with its rendered MP4 clips.
  - Test clip playback inside modal.
  - Test single clip download and "Open in Studio" action.
- [ ] **4.3 Batch Actions & Deletion**:
  - Test "Download All as ZIP": calls `GET /api/v1/supoclip/export/zip` or streams archive.
  - Test project deletion: confirmation prompt followed by `DELETE /api/v1/projects/{id}`, properly invalidating query cache.

---

### TAB 5: OMNIPOST PUBLISHING (`/publishing` or `activeTab === 'publishing'`)
**Core Components**: `OmniPostPublishing`, `ChannelConnector`, `SchedulePicker`, `PublishHistoryTable`  
**Backend Endpoints**: `GET /api/v1/publish/channels`, `POST /api/v1/publish/submit`, `GET /api/v1/publish/history`, `GET /api/v1/auth/google/status`

- [ ] **5.1 Multi-Platform Channel Authorization**:
  - Check connection status for YouTube Shorts, TikTok, and Instagram Reels.
  - Test Google OAuth status endpoint (`GET /api/v1/auth/google/status`).
- [ ] **5.2 Video Selection & Multi-Platform Metadata Package**:
  - Verify selecting a rendered clip auto-fills platform-compliant metadata (title length limits, hashtags, mentions).
  - Verify character counter flags platform limits (e.g., TikTok 2200 chars, YouTube Shorts 100 chars title).
- [ ] **5.3 Scheduling & Instant Dispatch**:
  - Test instant "Publish Now" dispatch: calls `POST /api/v1/publish/submit`.
  - Test "Schedule" date/time picker: validates future timestamp selection.
- [ ] **5.4 Publication History & Retry Engine**:
  - Verify `GET /api/v1/publish/history` lists past dispatches with status badges (Published, Queued, Failed).
  - Test retry button for failed dispatches: calls `POST /api/v1/publish/retry/{receipt_id}`.

---

### TAB 6: PROCESSING PIPELINE (`/pipeline` or `activeTab === 'pipeline'`)
**Core Components**: `ProcessingPipeline`, `TaskQueueList`, `WorkerGpuMetrics`, `PipelineStageTimeline`  
**Backend Endpoints**: `GET /api/v1/render/status/{task_id}`, `GET /api/v1/jobs/{job_id}/stream`, `POST /api/v1/jobs/{job_id}/cancel`, `GET /api/v1/ops/health`

- [ ] **6.1 Hardware & GPU Acceleration Telemetry**:
  - Verify NVENC / CUDA / CPU status badges via `GET /api/v1/ops/health` or `GET /api/v1/health`.
  - Display active worker count, active memory footprint, and encoder type (`h264_nvenc` vs `libx264`).
- [ ] **6.2 Live Task Queue & Real-Time SSE Stream**:
  - Test queue rendering from global `useTaskStore`.
  - Verify SSE streaming (`GET /api/v1/jobs/{job_id}/stream`) updates progress bar (0% -> 100%) and stage descriptions in real time without browser lockup.
- [ ] **6.3 Stage-by-Stage Breakdown**:
  - Verify visual progression of pipeline stages: Ingestion -> Whisper Word-Level ASR -> Retention Topology -> Face/Motion Tracking -> 9:16 Crop Synthesis -> Burn-in Subtitles -> Final QC Packaging.
- [ ] **6.4 Job Cancellation & Error Handling**:
  - Test "Cancel Task" button: sends `POST /api/v1/jobs/{job_id}/cancel` and transitions UI state to `cancelled` with clear notification.

---

### TAB 7: SETTINGS & TELEMETRY (`/settings` or `activeTab === 'settings'`)
**Core Components**: `SettingsDashboard`, `ApiKeyConfig`, `GovernorThresholds`, `FluxSettings`, `SystemPurge`  
**Backend Endpoints**: `GET /api/v1/settings`, `POST /api/v1/settings`, `GET /api/v1/system/governor-status`, `POST /api/v1/system/storage-cleanup`

- [ ] **7.1 API Configuration & Connectivity Tests**:
  - Validate Gemini API Key input (with show/hide password toggle).
  - Validate YouTube Data API Key input.
  - Test "Test Connection" button: performs a live health handshake against the external provider and returns pass/fail badge.
- [ ] **7.2 System Governor & Disk Cache Management**:
  - Verify `GET /api/v1/system/governor-status` reports disk storage used, cache size, and memory usage.
  - Test "Clean Temp Cache": triggers `POST /api/v1/system/storage-cleanup` and updates free storage metrics.
- [ ] **7.3 AI B-Roll & FLUX Router Settings**:
  - Verify FLUX image generator provider configuration (`GET /api/v1/flux/status`).
  - Test fallbacks (Cloudflare Workers AI -> Local Fallback -> Stock B-Roll).
- [ ] **7.4 Persistent Preferences**:
  - Test saving settings: submits `POST /api/v1/settings` and verifies changes persist across browser refreshes.

---

## 🛠️ FINAL SYSTEM VERIFICATION GATES
Before declaring the system ready, the executing agent must verify:
1. `npm run build` inside `frontend/` executes with **0 errors and 0 type warnings**.
2. `pytest tests/` runs and passes all critical backend tests (`test_rendering_and_captions.py`, `test_word_snapping_precision.py`, etc.).
3. Both processes (`FastAPI :8000` and `Next.js :3050`) are healthy and responsive with HTTP 200 responses.
4. Browser console contains **zero uncaught exceptions, zero unhandled promise rejections, and zero missing asset 404s**.
