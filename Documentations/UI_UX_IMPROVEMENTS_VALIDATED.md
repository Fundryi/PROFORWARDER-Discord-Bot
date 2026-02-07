# ProForwarder Web Admin - Validated UI/UX Improvement Spec

Date: 2026-02-07  
Scope: `web/public/*`, `web/server.js`  
Intent: Give another AI an implementation-safe, designer-grade plan to make the UI cohesive, unique, and polished without breaking behavior.

## 1) What This Document Is

This is a code-validated replacement/addendum for `UI_UX_IMPROVEMENTS.md`.

- It keeps the same dark/sleek direction.
- It is stricter about safety and rollout order.
- It corrects a few points from the previous spec that were too broad or risky.

## 2) Verified Findings (Current Code)

### 2.1 Design tokens exist but are barely used
- `--surface`, `--surface-strong`, `--surface-muted` are defined in `web/public/styles.css:6`, `web/public/styles.css:7`, `web/public/styles.css:8`.
- Main surfaces still use hardcoded `rgba(...)` (examples: `web/public/styles.css:112`, `web/public/styles.css:119`, `web/public/styles.css:329`, `web/public/styles.css:381`, `web/public/styles.css:444`).

### 2.2 Real visual mismatches are present
- Button/input radius mismatch:
  - `.button` radius is `11px` (`web/public/styles.css:186`)
  - inputs use `var(--radius-input)` (12px) (`web/public/styles.css:241`)
- Logs filter selects are missing `.input` class:
  - `web/server.js:803`
  - `web/server.js:806`
  - (search input already has `.input` at `web/server.js:812`)
- Search fields are smaller than other inputs (`.select-search { font-size: 0.84rem; }` at `web/public/styles.css:276`).
- Table action buttons jump on hover due to global translateY:
  - `.button:hover` at `web/public/styles.css:198`
  - many table buttons use `.button` (`web/public/styles.css:365`)

### 2.3 Color consistency is fragmented
- Multiple red tones are in use:
  - `#ff9eb0`, `#ff9cab`, `#ff9cad`, `#ffb5c0`, `#ffd1d8`, plus inline JS `#e74c3c`.
- Inline hardcoded error color in JS:
  - `targetCell.style.color = '#e74c3c';` (`web/public/configs.js:102`)

### 2.4 Focus/accessibility needs improvement
- Global form controls remove outline (`web/public/styles.css:247`).
- Only `:focus` styles are used; `:focus-visible` is missing (`web/public/styles.css:251`).
- Tabs are not ARIA-wired:
  - nav/tab markup currently plain buttons (`web/server.js:547` to `web/server.js:553`)
  - app tab switching toggles classes but not ARIA (`web/public/app.js:64`, `web/public/app.js:67`)

### 2.5 Interaction polish gaps
- Native `confirm()` dialogs still used at:
  - `web/public/configs.js:132`
  - `web/public/configs.js:680`
  - `web/public/logs.js:229`
  - `web/public/settings.js:225`
  - `web/public/settings.js:338`
  - `web/public/guilds.js:181`
- Loading/empty/error states are mostly plain text (`Loading...`, `No ... found` across tabs).

### 2.6 Previous spec correction
- Previous file said `--danger` was defined but unused.  
  This is incorrect now: `--danger` is used (examples: `web/public/styles.css:459`, `web/public/styles.css:688`).

## 3) Non-Negotiable Safety Rules

- Do not rename/remove existing IDs used by JS.
- Do not rename/remove existing JS-hook class names (`.tab-panel`, `.status-badge`, `.error-text`, `.muted-text`, `.is-hidden`, etc.).
- Keep API routes and request payloads unchanged.
- Prefer additive CSS and token migration over structural rewrites.
- Make small, testable batches; do not do a single massive restyle commit.

## 4) Visual Direction (Dark, Unique, Not Generic)

Keep current dark base but make it more intentional:

- Palette style: deep navy/graphite surfaces + ice-cyan accent + subtle teal success + warm amber warning + controlled coral danger.
- Avoid purple accents. Keep brand identity around cool-cyan steel tones.
- Keep current fonts (`Space Grotesk` + `JetBrains Mono`) and improve hierarchy via a cleaner type scale, not more font families.
- Reduce noisy one-off values (radii, spacing, font-size decimals).

## 5) Implementation Plan (Safe Order)

## Phase A - Foundation Tokens + Consistency (low risk, high impact)

1. Expand `:root` token system in `web/public/styles.css`:
- Keep existing token names for compatibility.
- Add explicit surface tiers, border tiers, semantic bg/border tokens, spacing scale, motion tokens.

2. Migrate hardcoded surfaces/colors to tokens gradually:
- Start with cards, table wrappers, tab nav, stat cards, settings blocks.
- Replace one-off red/blue tints with semantic or text tokens.

3. Normalize radius + type + spacing scale:
- Buttons/inputs same radius.
- Consolidate micro font sizes into a small scale.
- Replace odd spacing values (`5`, `7`, `9`, `11`, `13`, `15`) with a 4px-base scale where visually safe.

## Phase B - Component Fixes (targeted)

1. Buttons (`web/public/styles.css`):
- `.button` radius -> 12px token.
- Add disabled style for `[disabled]`.
- Keep hover lift for major CTAs, disable lift inside table cells (`td .button:hover { transform: none; }`).
- Add clearer `:active` for secondary buttons.

2. Inputs/selects:
- Remove `.select-search` font-size override.
- Add `.input` class to logs filter selects in `web/server.js`:
  - `#logs-config-filter` (`web/server.js:803`)
  - `#logs-status-filter` (`web/server.js:806`)

3. Tables:
- Add subtle zebra striping.
- Improve cell horizontal breathing room.
- Keep sticky headers.

4. Status + semantic UI:
- Unify `.status-badge.*` with semantic variables.
- Replace JS inline color at `web/public/configs.js:102` with a class (example `.text-danger`).
- Make `.emoji-preview-item.missing` visibly dimmer (`opacity` lower than current `0.9` at `web/public/styles.css:811`).

## Phase C - Accessibility + Interaction Semantics

1. Focus handling:
- Replace `outline: none` approach with `:focus-visible` rings.
- Keep keyboard focus very clear on buttons, tabs, and form controls.

2. Tabs ARIA:
- `nav.tab-nav` -> `role="tablist"` in `web/server.js`.
- tab buttons -> `role="tab"`, `aria-selected`, `aria-controls`.
- tab panels -> `role="tabpanel"`.
- Update `switchTab` in `web/public/app.js` to sync `aria-selected`.

3. Status region semantics:
- Add `role="status" aria-live="polite"` to `#status-message` in `web/server.js`.

4. Reduced motion:
- Add `@media (prefers-reduced-motion: reduce)` to disable non-essential animations/transitions.

## Phase D - Distinctive Polish (still safe)

1. Background identity:
- Keep subtle grid overlay, slightly improve legibility/intent.
- Keep depth via layered gradients, avoid flashy effects.

2. Micro-interactions:
- Smooth tab panel transition.
- Optional gentle entrance stagger for stat cards.
- Keep effects lightweight (avoid heavy blur/filter animations on large surfaces).

3. Tab style refinement:
- Use a cleaner active state (accent underline + subtle surface tint) or keep current gradient if preferred.
- Keep visual style consistent across all top-level tabs.

## Phase E - Advanced UX (optional, do last)

1. Replace native `confirm()` with a themed modal utility:
- Add modal markup to `web/server.js`.
- Add shared `showConfirm(...)` helper in `web/public/app.js`.
- Migrate all six call sites listed in section 2.5.

2. Standardize loading/empty/error state components:
- Add reusable classes (`loading-indicator`, `empty-state`, `error-state`).
- Convert text-only states progressively by tab.

## 6) File-by-File Task Map

### `web/public/styles.css`
- Add/extend tokens.
- Migrate hardcoded colors/surfaces.
- Normalize spacing/radii/type sizes.
- Add disabled, focus-visible, zebra rows, semantic status colors, reduced-motion rules.
- Add optional modal/loading/empty/error styles if Phase E is included.

### `web/server.js`
- Add missing `.input` on logs filters (`web/server.js:803`, `web/server.js:806`).
- Add tab ARIA roles/attributes.
- Add status live region attributes to `#status-message`.
- Add confirm modal markup only if Phase E is implemented.

### `web/public/app.js`
- Update tab switching to also maintain `aria-selected`.
- Add shared confirm helper only if Phase E is implemented.
- Keep existing public API shape (`window.AdminApp`) unchanged.

### `web/public/configs.js`
- Replace inline error color (`web/public/configs.js:102`) with class-based styling.
- Optional: migrate confirm dialog call sites to `showConfirm`.
- Optional: update loading text to richer loading state markup.

### `web/public/logs.js`
- Optional: migrate confirm dialog + loading/empty state markup.

### `web/public/settings.js`
- Optional: migrate confirm dialog + empty/error visual states for emoji/settings blocks.

### `web/public/guilds.js`
- Optional: migrate leave-guild confirm dialog + loading state visuals.

### `web/public/dashboard.js`, `web/public/debug.js`, `web/public/autopublish.js`
- Optional: convert text-only loading/empty states to standardized state components.

## 7) Acceptance Checklist

- Tabs switch correctly via mouse and keyboard.
- No JS errors in console.
- Logs filters still function and are visually consistent with other inputs.
- Config create/edit/remove flows unchanged functionally.
- Settings save/delete and emoji remove flows unchanged functionally.
- Guild leave flow unchanged functionally.
- Auto-publish enable/disable unchanged functionally.
- Focus indicators are visible for keyboard users.
- Buttons show clear disabled state.
- Desktop view looks more cohesive and less generic.
- Mobile still works (not pixel-perfect priority, but no broken layout/overflow).

## 8) Recommended Delivery Strategy

- Commit 1: Phase A only (tokens + conservative replacements).
- Commit 2: Phase B + C (component consistency + accessibility).
- Commit 3: Phase D polish.
- Commit 4: Optional Phase E modal/state system.

This sequence minimizes break risk and makes regressions easy to isolate.
