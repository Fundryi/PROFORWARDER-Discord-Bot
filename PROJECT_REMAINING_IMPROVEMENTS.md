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

### 2. Telegram `discoveredVia` Semantics Cleanup
- Why it stays: cheap fix with better debugging/operational clarity.
- Complexity: `Low`
- Impact: `Low-Medium`
- Decision: `Keep`
- Implementation approach:
1. Standardize allowed values (`updates`, `manual_verify`, `config_create`, `forward`, `my_chat_member`).
2. Ensure create-flow verification writes `config_create`.
3. Backfill unknown/legacy values where safe.
4. Surface value in debug/diagnostic outputs if needed.

### 3. Emoji Remove Should Delete DB Entry + Discord Asset
- Why it stays: explicit project requirement; current behavior is partial.
- Complexity: `Medium`
- Impact: `Medium`
- Decision: `Keep`
- Implementation approach:
1. Add dedicated endpoint for per-emoji remove (by emoji name).
2. Resolve matching Discord application emoji asset by name.
3. Try deleting Discord emoji asset first.
4. If Discord delete succeeds (or emoji already absent), remove the name from `uploaded_emoji_names` DB setting.
5. If Discord delete fails due permission/API errors, do not remove from DB; return actionable error.
6. Keep operation idempotent and log each outcome.

### 4. `/debug database` Web Parity (Low Priority)
- Why it stays: command currently has richer DB diagnostics than web.
- Complexity: `Medium`
- Impact: `Low`
- Decision: `Keep (low priority)`
- Implementation approach:
1. Add read-only debug panel in web only when `WEB_ADMIN_DEBUG=true`.
2. Expose curated diagnostics (no raw SQL input), e.g. latest logs, filtered slices, table counts.
3. Restrict to admin-authorized users.
4. Keep command as primary deep-debug path.

### 5. Source Bot Selection Ambiguity in Web Config Create
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
- Telegram target create flow verification is enforced in frontend and backend.
- Telegram target input supports Chat ID, `@username`, and `t.me` links.
- Telegram target UI is manual-first and supports tracked-chat removal with safety guardrails.

## Suggested Delivery Order
1. Emoji remove (DB + Discord asset).
2. `discoveredVia` semantics cleanup.
3. Source bot selection ambiguity fix.
4. Security hardening when moving to public/OAuth deployment.
5. Optional web debug parity last.
