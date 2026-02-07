# Project Remaining Improvements

Date: 2026-02-07  
Purpose: Track only items that are still below command parity or provide clear operational value.

## Backlog Rule
- Keep TODOs only when:
- web admin is less detailed/capable than existing command behavior, or
- the work has clear reliability/security impact.
- Remove TODOs when web admin is already equal or better.

## Phase Delivery Log

### Phase 1 (2026-02-07) - Reader Diagnostics Parity (Simplified) ✅
- Added `GET /api/reader-status` with:
  - reader enabled/online state
  - reader guild count
  - per-config source guild/channel access diagnostics for active Discord forwards
- Added Dashboard "Reader Diagnostics" panel with:
  - reader status summary
  - actionable failure hints
  - reader invite link when available
- Kept deep troubleshooting in `/proforward reader-status` command path.
- Validation run:
  - `node --check web/server.js`
  - `node --check web/public/dashboard.js`

### Phase 2 (2026-02-07) - Emoji Remove Parity (DB + Discord Asset) ✅
- Added `DELETE /api/settings/uploaded-emoji/:emojiName` with ordered behavior:
  - resolve matching Discord application emoji by name
  - delete Discord emoji first
  - only then remove name from `uploaded_emoji_names`
- Added actionable API errors when Discord deletion/fetch fails; DB entry is preserved on failure.
- Kept operation idempotent:
  - succeeds when emoji is already absent in Discord and/or DB
  - returns removal status for both Discord and DB
- Updated settings UI remove action to use the new endpoint.
- Validation run:
  - `node --check web/server.js`
  - `node --check web/public/settings.js`

### Phase 3 (2026-02-07) - Telegram `discoveredVia` Semantics Cleanup ✅
- Standardized persisted `discoveredVia` values to:
  - `updates`
  - `manual_verify`
  - `config_create`
  - `forward`
  - `my_chat_member`
- Updated enrichment path to write `config_create` (removed legacy `config_enrichment` writes).
- Added safe legacy-value backfill during DB initialization (known aliases only).
- Added normalization in DB upsert path so new/legacy writes resolve to standardized values.
- Validation run:
  - `node --check utils/database.js`
  - `node --check utils/telegramChatTracker.js`
  - `node --check web/server.js`

## Remaining TODOs

### 1. Web Security Hardening (Conditional Priority)
- Why it stays: strong value when web admin is internet-exposed (OAuth/public domain).
- Complexity: `Medium`
- Impact: `High` (public), `Low-Medium` (localhost-only)
- Decision: `Keep (conditional)`
- Implementation approach:
1. Add CSRF protection to mutating routes (`POST/PUT/PATCH/DELETE` APIs).
2. Add rate limiting for auth and mutation routes.
3. Add lightweight mutation audit logging (user, route/action, target id, timestamp).
4. Gate strict mode by config so localhost workflows can stay simple.

### 2. `/debug database` Web Parity (Low Priority)
- Why it stays: command currently has richer DB diagnostics than web.
- Complexity: `Medium`
- Impact: `Low`
- Decision: `Keep (low priority)`
- Implementation approach:
1. Add read-only debug panel in web only when `WEB_ADMIN_DEBUG=true`.
2. Expose curated diagnostics (no raw SQL input), e.g. latest logs, filtered slices, table counts.
3. Restrict to admin-authorized users.
4. Keep command as primary deep-debug path.

### 3. Source Bot Selection Ambiguity in Web Config Create
- Why it stays: in guilds where both bots exist, web source context defaults to main bot and does not allow explicit reader selection.
- Complexity: `Low-Medium`
- Impact: `Medium` for mixed-permission guilds
- Decision: `Keep (newly discovered)`
- Implementation approach:
1. Add explicit source bot selector (`main`/`reader`) when both are available.
2. Persist source intent (e.g., `useReaderBot`) from web create flow.
3. Ensure source channel dropdown reflects the selected source bot permissions.
4. Keep backward compatibility for existing configs.

## Removed From TODO (Already Web-Equal or Better)
- Reader diagnostics simplified parity delivered in web (`/api/reader-status` + dashboard panel).
- Emoji remove parity delivered (Discord app emoji delete + DB sync via dedicated endpoint).
- Telegram `discoveredVia` semantics cleanup delivered (standardized values + safe legacy backfill).
- Telegram target create flow verification is enforced in frontend and backend.
- Telegram target input supports Chat ID, `@username`, and `t.me` links.
- Telegram target UI is manual-first and supports tracked-chat removal with safety guardrails.

## Suggested Delivery Order
1. Source bot selection ambiguity fix.
2. Security hardening when moving to public/OAuth deployment.
3. Optional web debug parity last.
