# Product Design System: Creative Video Intelligence Workstation

**Product:** YouTube Clipping Intelligence Engine & OmniPost Ecosystem  
**Design System Codename:** *Obsidian Studio Architecture*  
**Specification Version:** 2.0.0  
**Target Compliance:** WCAG 2.2 AA / AAA Standards  

---

## 1. Design Philosophy & Visual Identity

The YouTube Clipping Intelligence Engine is not an administrative dashboard, nor is it a generic AI SaaS wrapper. It is a **professional video intelligence workstation** engineered for video editors, social media strategists, and high-velocity content operations teams.

### Core Tenets
1. **Tool-First Ergonomics:** Interface elements exist to serve the media, the timeline, the virality metrics, and the publishing queue. Chrome recedes; content and analytics command attention.
2. **Tactile Dimensionality Without Gimmicks:** Surfaces possess subtle elevation, precise 1px surgical borders, and delicate inner bevel highlights (`subtle-border`). We strictly reject gratuitous purple-pink AI gradients, glowing cards, and decorative floating blobs.
3. **Information Density with Breathing Room:** Dense, legible data presentation with calibrated tabular figures (`font-mono tnum`) enables rapid scanning of timestamps, virality scores, and pipeline throughput.
4. **Authentic Platform Emulation:** Vertical video previews accurately replicate the physical form factor of modern smartphones (aluminum frame, bezel, dynamic island) and the actual interface obstruction overlays of TikTok, Instagram Reels, and YouTube Shorts.

---

## 2. Typography Architecture

### 2.1 Font Selections
- **Display & Interface Family:** Premium variable sans-serif hierarchy utilizing calibrated geometric / humanist proportions:
  - Font Stack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
  - Calibrated letter-spacing: Headings `-0.025em` (tight, authoritative), body text `0em`, captions `+0.01em` (clear, readable).
- **Technical & Metric Family (Tabular Figures):**
  - Font Stack: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`
  - Enforced CSS: `font-variant-numeric: tabular-nums` (`tnum`) for all timestamps, duration readouts, bitrates, frame rates, and virality percentages. This completely eliminates layout jitter during video playback and timeline scrubbing.

### 2.2 Typographic Hierarchy
| Level | Size | Weight | Tracking | Line Height | Usage |
|---|---|---|---|---|---|
| **H1 Workspace** | 28px (1.75rem) | 700 (Bold) | -0.025em | 1.2 | Workspace primary titles |
| **H2 Section** | 20px (1.25rem) | 600 (Semibold) | -0.02em | 1.3 | Card titles, major panel headers |
| **H3 Subsection** | 15px (0.9375rem)| 600 (Semibold) | -0.01em | 1.4 | Group headings, metric categories |
| **Body Standard** | 14px (0.875rem) | 400 (Regular) | 0 | 1.5 | General UI copy, descriptions |
| **Body Compact** | 13px (0.8125rem)| 500 (Medium) | 0 | 1.4 | Navigation items, table data, buttons |
| **Caption / Meta** | 11px (0.6875rem)| 500 (Medium) | +0.01em | 1.3 | Badges, timestamps, secondary hints |
| **Micro Monospace**| 10px (0.625rem) | 700 (Bold) | +0.02em | 1.0 | Overlay tags, safe zone flags |

---

## 3. Calibrated Color Architecture

### 3.1 Light Theme Palette (*Architectural Slate & Crisp White*)
Designed as an elegant, calm, high-contrast creative studio environment without harsh blinding glare.

| Semantic Token | Hex Value | Role & Architectural Purpose | WCAG Contrast Ratio |
|---|---|---|---|
| `--background` | `#f8fafc` | Cool Slate-50 application canvas | Base |
| `--foreground` | `#090a0f` | Deep Obsidian primary text | 18.9:1 vs canvas (AAA) |
| `--foreground-secondary` | `#334155` | Slate-700 supporting labels | 9.8:1 vs canvas (AAA) |
| `--muted-foreground` | `#475569` | Slate-600 metadata & captions | 7.2:1 vs canvas (AAA) |
| `--card` | `#ffffff` | Pure white working panel surfaces | 1.08:1 vs canvas |
| `--panel` | `#ffffff` | Navigation dock and header surface | Clean separation |
| `--border` | `#e2e8f0` | Slate-200 structural panel borders | 1.25:1 vs canvas |
| `--border-subtle` | `#f1f5f9` | Slate-100 internal dividers | Subtle division |
| `--primary` | `#2563eb` | Electric Sapphire action accent | 5.2:1 vs white text (AA) |
| `--primary-hover` | `#1d4ed8` | Deep Sapphire hover state | 6.8:1 vs white text (AAA)|
| `--success` | `#047857` | Emerald-700 status & high virality | 5.5:1 vs white (AA) |
| `--warning` | `#b45309` | Amber-700 warnings & cautions | 4.8:1 vs white (AA) |
| `--destructive` | `#dc2626` | Ruby-600 errors & critical actions | 4.6:1 vs white (AA) |

### 3.2 Dark Theme Palette (*Luxury Obsidian & Graphite Studio*)
Engineered specifically for extended low-light video editing sessions. Eliminates eye strain through layered matte surfaces rather than pure stark black.

| Semantic Token | Hex Value | Role & Architectural Purpose | WCAG Contrast Ratio |
|---|---|---|---|
| `--background` | `#090a0f` | Deep Obsidian application canvas | Base |
| `--foreground` | `#f8fafc` | Crisp White primary text | 18.9:1 vs canvas (AAA) |
| `--foreground-secondary` | `#cbd5e1` | Slate-300 supporting labels | 11.2:1 vs canvas (AAA)|
| `--muted-foreground` | `#94a3b8` | Slate-400 metadata & captions | 6.8:1 vs card (AA) |
| `--card` | `#131722` | Layered deep slate card surface | 1.3:1 vs canvas |
| `--panel` | `#0e111a` | Dock rail and application header | Subtle contrast |
| `--popover` | `#181d2a` | Elevated popovers & context menus | 1.6:1 vs canvas |
| `--border` | `#222838` | Surgical Slate-800 structural borders | Clean definition |
| `--border-subtle` | `#191e2b` | Inset partition dividers | Non-distracting |
| `--primary` | `#3b82f6` | Luminous Sapphire action accent | 5.4:1 vs canvas (AA) |
| `--primary-hover` | `#60a5fa` | Vibrant Sapphire hover state | 8.2:1 vs canvas (AAA)|
| `--success` | `#10b981` | Emerald-500 status & high virality | 9.0:1 vs card (AAA) |
| `--warning` | `#f59e0b` | Amber-500 warnings & cautions | 9.4:1 vs card (AAA) |
| `--destructive` | `#ef4444` | Ruby-500 errors & critical actions | 4.9:1 vs card (AA) |

---

## 4. Surfaces, Depth & Geometric Tokens

### 4.1 Spacing & Radius Scale
- **Radius Scale:**
  - `rounded-sm`: 4px — Chips, badges, inner sub-controls
  - `rounded-md`: 6px — Buttons, form inputs, segmented tabs
  - `rounded-lg`: 8px — Standard cards, workspace dialogs
  - `rounded-xl`: 12px — Major workstation panels
  - `rounded-[44px]`: 44px — Smartphone chassis outer frame
  - `rounded-[34px]`: 34px — Smartphone screen viewport
- **Elevation Shadows:**
  - `shadow-xs`: `0 1px 2px 0 rgba(0, 0, 0, 0.05)`
  - `shadow-sm`: `0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)`
  - `shadow-panel`: `0 4px 20px -2px rgba(0, 0, 0, 0.25)`
  - `shadow-chassis`: `0 25px 50px -12px rgba(0, 0, 0, 0.75)`

---

## 5. Interaction & Motion Rules

- **Timing & Curves:**
  - Fast feedback (hover, press, focus): `120ms` cubic-bezier(0.4, 0, 0.2, 1)
  - Layout transitions (tabs, panel collapse): `200ms` cubic-bezier(0.16, 1, 0.3, 1)
- **Reduced Motion:**
  - When `prefers-reduced-motion: reduce` is detected, animations and transform transitions are replaced by instant opacity cuts.
- **Keyboard Shortcuts:**
  - `Space`: Video Play / Pause toggle
  - `Left Arrow` / `Right Arrow`: Timeline frame stepping (0.1s step; Shift + Arrow for 1.0s step)
  - `M`: Toggle audio mute
  - `Cmd+K` / `Ctrl+K`: Open global command search
  - `Esc`: Close open modal / overlay

---

## 6. Accessibility Governance (WCAG 2.2 AA)

1. **Target Contrast Standards:**
   - Normal text (under 18pt): >= 4.5:1
   - Large text (18pt+ or 14pt bold): >= 3:1
   - UI components and focus rings: >= 3:1
2. **Keyboard Navigation:**
   - All interactive controls have visible focus rings (`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`).
   - `#main-content` skip link allows keyboard and screen reader users to bypass the header and sidebar directly to the workspace.
3. **Touch Targets:**
   - On touch viewports (< 768px), all interactive targets maintain a minimum hitbox of 44x44 CSS pixels.
