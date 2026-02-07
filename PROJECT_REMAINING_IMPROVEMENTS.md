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

### Phase 4 (2026-02-07) - Source Bot Selection in Web Config Create ✅
- Added explicit source bot selectors in Discord + Telegram create forms (`Main Bot` / `Reader Bot`).
- Extended `/api/form-options` payload with per-guild source-bot channel maps (`sourceBots`) and defaults.
- Updated source channel pickers to refresh by selected source bot permissions.
- Persisted source intent from web create flow via `sourceBot` request field and `useReaderBot` config flag.
- Kept backward compatibility:
  - auto-selects available bot when only one exists
  - retains legacy fallback behavior if source-bot metadata is absent
- Validation run:
  - `node --check web/server.js`
  - `node --check web/public/configs.js`

### Phase 5 (2026-02-07) - Lightweight Web Security Hardening ✅
- Added optional strict mode (`WEB_ADMIN_SECURITY_STRICT=true`) for internet-exposed deployments.
- Added CSRF validation for mutating `/api` routes (`POST/PUT/PATCH/DELETE`) using session token + `X-CSRF-Token`.
- Added simple in-memory rate limiting in strict mode:
  - auth-sensitive routes
  - mutating API requests
- Added lightweight mutation audit logging (actor, method, path, status, duration) in strict mode.
- Exposed CSRF token in `/api/me` and updated frontend request helper to send it on mutating requests.
- Kept defaults simple for non-mass/local usage (strict mode is opt-in).
- Validation run:
  - `node --check web/server.js`
  - `node --check web/public/app.js`
  - `node --check web/lib/config.js`
  - `node --check config/config.js`

### Phase 6 (2026-02-07) - `/debug database` Web Parity ✅
- Added a dedicated `Debug` tab in web admin, visible only when `WEB_ADMIN_DEBUG=true`.
- Added read-only `GET /api/debug/database` (gated by web debug flag + authenticated admin session).
- Exposed curated diagnostics only:
  - table counts (`message_logs`, `bot_settings`, `telegram_chats`, `translation_threads`)
  - message log status counts
  - Telegram `discoveredVia` distribution
  - recent message log slice
  - recent failed log slice
  - recent bot setting update slice
  - forward config summary
- No raw SQL input or mutating debug actions were added.
- Validation run:
  - `node --check web/server.js`
  - `node --check web/public/debug.js`
  - `node --check web/public/app.js`

### Phase 7 (2026-02-07) - Command vs Web Parity Audit ✅
- Completed a full audit of all command surfaces (current + legacy/deprecated) against web admin.
- Confirmed web-managed/deprecated command parity is complete for:
  - `/proforward setup`
  - `/proforward telegram`
  - `/proforward list`
  - `/proforward remove`
  - `/proforward test`
  - `/proforward auto-publish`
  - `/proforward retry`
- Confirmed active command helpers remain intentionally available in Discord for quick ops:
  - `/proforward status`
  - `/proforward reader-status`
  - `/debug database`
  - `/debug search`
- Parity result: **near-full** overall; no blocking capability regressions found.
- Updated docs/backlog with remaining low-priority parity differences.

### Phase 8 (2026-02-07) - Retire `/proforward telegram-discover` ✅
- Marked `/proforward telegram-discover` as web-managed deprecated (hidden from slash registration and disabled at runtime with web redirect notice).
- Kept behavior safe and simple:
  - no change to Telegram forward runtime logic
  - command users are redirected to Web Admin flow
- Updated Telegram-related command helper text to point at Web Admin target formats (`Chat ID`, `@username`, `t.me`).
- Validation run:
  - `node --check commands/proforwardCommand.js`

### Phase 9 (2026-02-07) - `/debug search` Web Drilldown Parity ✅
- Added debug-gated read-only endpoint: `GET /api/debug/message-search?messageId=...`.
- Added Debug tab "Message Drilldown" panel:
  - message ID input + search action
  - all-match results (`originalMessageId` OR `forwardedMessageId`)
  - edit-handler-aligned subset (`originalMessageId` + `status='success'`)
  - total vs shown summary for truncated result sets
- Kept behavior safe:
  - endpoint is authenticated and available only when `WEB_ADMIN_DEBUG=true`
  - no raw SQL input and no mutating actions
- Validation run:
  - `node --check web/server.js`
  - `node --check web/public/debug.js`

### Phase 10 (2026-02-07) - Retire Remaining Slash Helpers ✅
- Moved remaining helper commands to web-managed mode:
  - `/proforward status`
  - `/proforward reader-status`
  - `/debug database`
  - `/debug search`
- Updated slash registration behavior:
  - `/proforward` is not registered when all subcommands are web-managed
  - `/debug` is intentionally unregistered
- Kept safe stale-command behavior during Discord propagation:
  - stale `/proforward ...` and `/debug ...` calls return clear redirect notices to Web Admin
- Validation run:
  - `node --check commands/proforwardCommand.js`
  - `node --check index.js`

### Phase 11 (2026-02-07) - Single Portal Command + Command Code Cleanup ✅
- Added a single slash command: `/proforwarder`.
- `/proforwarder` replies with dynamic web portal links from runtime config:
  - always provides Web Admin URL from `webAdmin.baseUrl`
  - provides direct login URL when OAuth mode + HTTPS base URL are configured
  - falls back to local-mode guidance when local auth is active
- Removed legacy command modules from codebase:
  - `commands/proforwardCommand.js`
  - `commands/debugCommands.js`
- Kept safe stale-command behavior:
  - stale `/proforward` and `/debug` interactions return web redirect notices
- Validation run:
  - `node --check commands/proforwarderCommand.js`
  - `node --check index.js`

## Remaining TODOs
- None currently.

## Removed From TODO (Already Web-Equal or Better)
- Reader diagnostics simplified parity delivered in web (`/api/reader-status` + dashboard panel).
- Emoji remove parity delivered (Discord app emoji delete + DB sync via dedicated endpoint).
- Telegram `discoveredVia` semantics cleanup delivered (standardized values + safe legacy backfill).
- Source bot selection ambiguity fixed in web config create flow.
- Lightweight web security hardening delivered with opt-in strict mode.
- `/debug database` web parity delivered with debug-gated curated diagnostics tab/API.
- Telegram target create flow verification is enforced in frontend and backend.
- Telegram target input supports Chat ID, `@username`, and `t.me` links.
- Telegram target UI is manual-first and supports tracked-chat removal with safety guardrails.
- Parity audit confirmed all web-managed/deprecated `/proforward` command paths are now web-equal or better.
- `/proforward telegram-discover` retired in favor of Web Admin Telegram target input + verification flow.
- `/debug search` web parity delivered via debug-gated Message Drilldown panel/API.
- Remaining slash helper commands retired; day-to-day operations are now web-only.
- Legacy command code removed; `/proforwarder` retained only as Web Admin portal shortcut.
