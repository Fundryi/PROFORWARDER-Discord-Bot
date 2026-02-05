# Command UX Rework Plan (Low‑Risk, Backwards‑Compatible)

Date: 2026-02-05

## Goals
- Improve usability without breaking existing flows.
- Keep all current slash commands working.
- Introduce richer UX gradually (interactive components).
- Minimize risk by shipping behind flags and in parallel.

## Guiding Principles (Low Risk)
1. **Keep existing slash commands unchanged** (backward compatibility).
2. **Add new UX in parallel** (opt‑in, then default later).
3. **Feature‑flag everything new** so rollback is trivial.
4. **Avoid changing data models** unless strictly necessary.

## Recommended UX Direction
**Use Discord Message Components** (buttons + select menus + modals), not reactions.
- Reactions are legacy and harder to manage; components are the modern standard.
- Components allow scoped, per‑user interactions and clean state.

## Proposed Interaction Model
1. **New entrypoint:** `/proforward ui` (or `/proforward manage`) opens a private control panel.
2. **Panels are ephemeral** and only visible to the issuer.
3. **Actions via buttons/selects**:
   - List configs
   - Create new config
   - Edit config (toggle enabled, change target)
   - Remove config
   - Test Telegram
   - Retry forwarding
4. **Modals for input** (IDs, names, chat IDs) to avoid messy command parameters.

## Phased Plan
### Phase 0: Inventory & Freeze
- Map all current command flows and responses.
- Freeze changes to existing commands (no refactors).
- Add a feature flag: `commandUi.enabled`.
- **Rule:** New UI ships in parallel; old commands remain untouched until final phase.

### Phase 1: Minimal UI Shell (Read‑Only)
- Add `/proforward ui` that shows:
  - Active configs list
  - Status summary
- No mutations yet.
- Use ephemeral message + select menu for config details.

### Phase 2: Safe Mutations (Low Risk)
- Add “Enable/Disable” toggle button.
- Add “Remove” with confirmation button.
- Add “Test Telegram” action.
- All actions write through existing functions (no new DB paths).

### Phase 3: Guided Setup (Higher Value)
- Add “Create config” wizard:
  - Step 1: Choose target type (Discord/Telegram)
  - Step 2: Input IDs via modal
  - Step 3: Confirmation + create
- Reuse existing `addForwardConfig` and validation.

### Phase 4: Deprecation Strategy (Optional)
- Keep old commands indefinitely or soft‑deprecate (docs only).
- If desired, make `/proforward` default to UI and keep `/proforward setup` as a fallback.
 - **Final step (only after UI is proven stable):** remove old commands.

## Safety / Risk Controls
- All new UI actions wrap existing logic (no new code paths for writes).
- Require confirmation for destructive actions.
- Feature flag in `config/env.js` for instant rollback.

## Testing Strategy
1. **Manual tests** per phase:
   - Ensure UI loads
   - Verify all buttons respond only to issuer
   - Confirm destructive actions require confirmation
2. **Shadow mode**:
   - Run UI in parallel with old commands for at least 1–2 weeks.

## Open Questions
- **Decision:** UI should be **admin‑only** (or a specific role), not manage‑channels by default.
- **Decision:** Reader bot remains **read‑only**; no UI actions from reader‑bot context.
- **Decision:** Keep `/debug` as‑is (no UI migration).

---
End of plan.
