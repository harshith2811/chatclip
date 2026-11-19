# MASTER DIRECTIVE: PRODUCTION-GRADE AUDIT, HARDENING & ZERO-REGRESSION RELEASE
## YOUTUBE CLIPPING INTELLIGENCE ENGINE & OMNIPOST ECOSYSTEM

> **Objective:** Conduct a rigorous, end-to-end audit and hardening pass across the Next.js 15 App Router frontend (`frontend/`) and FastAPI processing backend (`src/yt_clipping/`). Transform the system into an award-winning, bulletproof, enterprise-grade production platform.

---

### EXECUTION PRINCIPLES & GOVERNANCE
1. **Zero-Token Waste & Lean Execution:** Work directly and pragmatically. Do NOT spawn recursive reviewer/sentinel multi-agent swarms. Never loop on continuous verification tests during development; execute verifications only at phase milestones.
2. **Zero-Regression Mandate:** The Python backend (`http://localhost:8000`) and its 123 API contracts are authoritative. Do NOT alter backend API signatures or mutate legacy fallback templates (`src/yt_clipping/web/`).
3. **Evidence-Driven QA:** Every claim of "fixed", "optimized", or "production-ready" must be substantiated with browser screenshots, lighthouse/bundle metrics, or test output.

---

### PHASE 1: JURY & DESIGN TASTE AUDIT (`jury` + `taste-skill`)
*Audit and elevate the user interface to the visual and interaction standard of top-tier products (e.g., Linear, Figma, x.ai).*

- [ ] **Visual Hierarchy & Typography:**
  - Audit font scaling, tracking, leading, and contrast across all viewports (320px to 2560px).
  - Eliminate generic placeholder styling, "AI-slop" card layouts, and uninspired borders.
  - Apply authentic, product-specific micro-interactions: crisp hover states, subtle active press states, and zero layout shift.
- [ ] **Dual-Theme Fidelity (Light & Dark):**
  - Verify WCAG 2.2 AA / AAA contrast ratios in both Light and Dark themes.
  - Ensure zero contrast collisions (e.g., muted text blending into card backgrounds, unreadable badges, harsh pure white `#ffffff` vs slate-50).
  - Enforce zero-FOUC (Flash of Unstyled Content) upon page refresh across themes.
- [ ] **Physical Stage Realism (Studio & Editor):**
  - Verify the 9:16 vertical smartphone preview player: authentic bezel curve, Dynamic Island / notch geometry, and glare-free video viewport.
  - Ensure safe-zone overlays for TikTok, Instagram Reels, and YouTube Shorts accurately reflect real-world native platform UI obstruction zones (profile icon, comment buttons, bottom description bar).

---

### PHASE 2: REACT 19 & NEXT.JS 15 ENGINE PERFORMANCE (`react-best-practices`)
*Audit client-side state, bundle footprints, and browser memory consumption.*

- [ ] **Bundle & Code Splitting:**
  - Enforce First Load JS `< 180 kB`. Shared chunk baseline must remain `< 110 kB`.
  - Lazy-load heavy media controls, canvas waveform renderers, and chart libraries using dynamic imports (`next/dynamic` with `ssr: false`).
- [ ] **Memory Leak Elimination & Decoder Lifecycle:**
  - Audit every `HTMLVideoElement` and `HTMLCanvasElement` across `PhonePlayer`, `TimelineEditor`, and `CandidateGrid`.
  - On component unmount, explicitly call `.pause()`, clear `.src`, invoke `.load()`, and terminate animation frame requests (`cancelAnimationFrame`) to release OS video decoder hardware threads.
- [ ] **Granular State Subscriptions (Zustand & TanStack Query):**
  - Eliminate root re-render cascades. Components must select atomic slices (e.g., `usePlaybackStore(s => s.currentTime)`) instead of subscribing to full store objects.
  - Implement request deduplication, query caching with stale-while-revalidate, and abort controller signals (`AbortSignal`) for background searches and video metadata queries.

---

### PHASE 3: COMPREHENSIVE RESPONSIVENESS & INPUT MATRIX (`audit-originality`)
*Audit layout stability and ergonomic interaction across all form factors.*

- [ ] **Mobile Layout (320px – 480px):**
  - Verify zero lateral overflow (`hasHorizontalScroll === false`).
  - Ensure all grid tracks use `minmax(0, 1fr)` to prevent container blowouts.
  - Verify sticky bottom navigation bar ergonomics: minimum 44x44px touch targets, haptic feedback cues, and proper safe-area padding (`pb-safe`).
- [ ] **Tablet & Foldable Layout (768px – 1024px):**
  - Ensure split views (Studio 9:16 preview + Virality Matrix + Captions) stack or wrap gracefully without horizontal scrollbars.
- [ ] **Desktop & Ultra-wide (1280px – 2560px):**
  - Maintain centered max-width constraint (`max-w-7xl` or `max-w-[1440px]`) with balanced margins and collapsible sidebar docking.

---

### PHASE 4: FULL-STORY END-TO-END VERIFICATION (`verification`)
*Verify complete flow integration: Browser UI → API Request → Engine Execution → Result Delivery.*

- [ ] **Video Ingestion & Virality Detection:**
  - Submit YouTube URL / 11-char ID via `UrlIngestionBar`.
  - Verify request dispatch to `POST /api/v1/preview` or `GET /api/v1/metadata`.
  - Ensure retention curve renders SVG points, peak virality markers, and candidate highlight cards without layout pop-in.
- [ ] **Studio & Playback Sync:**
  - Selecting candidate clip pill (`Clip #1`, `Clip #2`, `Clip #3`) must instantaneously update:
    1. Video playhead start/end bounds.
    2. 2x2 Virality Diagnostics Matrix scores and AI rationale text.
    3. Multi-platform social caption tabs (TikTok, Shorts, Reels, X).
- [ ] **OmniPost Distribution Pipeline:**
  - Verify connected channels shelf status (YouTube, TikTok, Reels, X).
  - Verify 1-click broadcast triggers simulation and updates status to `queued` / `published`.
- [ ] **Compute & Governor Telemetry:**
  - Verify CPU, RAM, and NVENC GPU utilization indicators reflect accurate backend status or graceful mock telemetry when engine is in passive mode.

---

### PHASE 5: PRODUCTION RESILIENCE, SECURITY & ERROR BOUNDARIES
*Harden the platform against real-world failures, network drops, and corrupted inputs.*

- [ ] **Graceful Degradation & Empty States:**
  - When backend (`http://localhost:8000`) is offline or restarting, UI must show clear, non-blocking toast notifications and cached/fallback demonstration data rather than a blank screen or unhandled exception.
  - Wrap every major surface (`Discovery`, `Studio`, `Editor`, `Projects`, `Publishing`, `Pipeline`, `Settings`) in React `ErrorBoundary` with a one-click "Reset Component" fallback.
- [ ] **Input Sanitization & Validation:**
  - Zod schema validation on all user inputs (YouTube URLs, custom titles, caption edits, trimming timestamps).
  - Prevent out-of-bounds trimming (`trimStart >= trimEnd`, `trimEnd > duration`).
- [ ] **Build Certification:**
  - Execute `npm --prefix frontend run build` — must pass with **Exit Code 0**, 0 TypeScript errors, 0 ESLint warnings.

---

### DELIVERABLES
1. **Audit Scorecard:** Numerical ratings (1–100) across Design, Usability, Performance, and Reliability.
2. **Hardened Codebase:** Clean, production-ready code committed with zero regressions.
3. **Visual Proof Pack:** High-resolution screenshots of Desktop (Light & Dark) and Mobile (Light & Dark) confirming flawless execution.
