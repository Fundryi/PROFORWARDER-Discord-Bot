# Web Admin Setup + Auto-Publish Phase Plan

Date: 2026-02-06  
Scope: simplify forward setup UX with searchable dropdowns + add auto-publish management tab

---

## Objectives

1. Replace manual ID-heavy setup flows with guided selectors.
2. Add searchable dropdown behavior for server/channel/chat selection.
3. Keep manual fallback only where discovery cannot be guaranteed (Telegram chat ID).
4. Add a dedicated Auto Publish tab in web admin.
5. Deliver in small, commit-safe phases.

---

## Phase 1 - Planning + Backend Data Endpoints

Deliverables:
- New web-admin form-options API for setup forms:
  - manageable source servers,
  - source channels,
  - target servers/channels (main bot writable channels),
  - Telegram chat candidates (best effort from updates + configured chat IDs).
- New auto-publish APIs:
  - list manageable announcement channels with enabled state,
  - set enable/disable state explicitly.
- Config manager support for explicit auto-publish state set (not only toggle).

Commit:
- Backend/API only.

---

## Phase 2 - Config Setup UX Rewrite (Configs Tab)

Deliverables:
- Discord forward form converted to selectors:
  - Source Server -> Source Channel -> Target Server -> Target Channel.
- Telegram forward form converted to selectors:
  - Source Server -> Source Channel -> Target Chat selector (+ manual chat ID fallback).
- Client-side searchable filtering for each dropdown.
- Keep existing configs table behavior untouched.

Commit:
- Markup + frontend JS + necessary styling for form UX.

---

## Phase 3 - Auto Publish Tab (UI + Wiring)

Deliverables:
- New tab in web admin navigation.
- Auto Publish management UI:
  - searchable server/channel selectors,
  - current state indicator,
  - enable/disable action,
  - table of enabled announcement channels with quick disable.
- Integrate with new auto-publish APIs.

Commit:
- Tab markup + JS module + styling + API consumption.

---

## Phase 4 - Validation + Polish

Deliverables:
- Syntax checks for changed JS files.
- Quick interaction sanity for:
  - creating Discord forward from selectors,
  - creating Telegram forward from selectors,
  - toggling auto-publish from new tab.
- Final documentation note in plan about any known Telegram discovery limits.

Commit:
- Any final polish fixes only.

---

## Known Constraints

1. Telegram does not provide a reliable “list all chats bot is in” endpoint.
2. Chat dropdown will use best-effort discovery:
   - `getUpdates` chats,
   - already configured Telegram target chat IDs.
3. Manual chat ID input remains available as a fallback.

---

## Implementation Status (2026-02-06)

- [x] Phase 1 complete
- [x] Phase 2 complete
- [x] Phase 3 complete
- [x] Phase 4 validation complete

Implemented commit sequence:
- `7b06f02` backend setup-options + auto-publish APIs
- `57060e8` searchable setup selectors in Configs tab
- `284fc99` Auto Publish tab UI and wiring

Validation run:
- `node --check web/server.js`
- `node --check web/public/configs.js`
- `node --check web/public/autopublish.js`
- `node --check utils/configManager.js`
