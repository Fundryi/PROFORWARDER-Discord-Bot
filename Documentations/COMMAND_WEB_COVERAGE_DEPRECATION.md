# Command Deprecation Coverage (Web Admin)

Date: 2026-02-07
Status: Post-phase audit (near-full parity)

## Goal
Move day-to-day management from slash commands to web admin without losing critical capabilities.

## Audit Notes (2026-02-07)
- `RESOLVED`: Web-managed `/proforward` command set now has parity or better behavior in web admin.
- `RESOLVED`: `/proforward telegram-discover` was retired as a slash-command helper; web Telegram target input + verification is the supported path.
- `RESOLVED`: Web Debug tab now includes message drilldown (`/api/debug/message-search`) with both full matches and edit-handler-aligned success subset.
- `NOTE`: `/debug` web diagnostics remain intentionally gated by `WEB_ADMIN_DEBUG=true`.

## Current State Snapshot (Break Handoff)
### Web Admin coverage now in place
- [x] Forward create UX clears inputs and shows explicit success feedback.
- [x] Config removal also removes related `message_logs` rows.
- [x] Configs tab supports source/target selectors with search and reader-bot source visibility.
- [x] Config forms were redesigned into side-by-side source/target groups for denser setup flow.
- [x] Auto Publish tab exists and is functional in web admin.
- [x] Logs tab supports target-type context (`Discord` vs `Telegram`), message-ID search, and source-message retry action.
- [x] Logs failed-entry delete UX was improved; `Delete Failed Older` was removed.
- [x] Bot Settings is existing-keys-only from web (new key creation removed/blocked).
- [x] `uploaded_emoji_names` is rendered as individual entries with per-emoji remove actions.
- [x] Manual emoji add/edit flow was removed from web settings; whole-key deletion for `uploaded_emoji_names` is blocked.
- [x] Settings helper copy was cleaned up and emoji entry readability improved.

### Telegram discovery/status hardening
- [x] Telegram chat labels now keep full text in selector.
- [x] Discovery cache invalidates on Telegram config create/remove to prevent stale `[configured]` entries.
- [x] Discovery excludes private user chats and keeps group/supergroup/channel targets (plus configured negative chat IDs only).
- [x] Telegram discovery remains best-effort from updates + existing config data.
- [x] Telegram forward create flow verifies target chat access before config creation (frontend + backend enforcement).
- [x] Telegram target input supports numeric chat IDs, `@username`, and `t.me` links.
- [x] Telegram target UI is manual-first (Target Chat input first, tracked chats below).
- [x] Tracked Telegram chats can now be removed from web UI, with guardrails that block removal while a chat is still referenced by active forward configs.

### Log maintenance hardening
- [x] Startup orphan cleanup now deletes only when source-message absence is verifiable.
- [x] This avoids accidental log loss after restart when channels/messages are temporarily unverifiable.
- [x] Reader-bot source logs are now protected from false orphan cleanup when only main-bot verification is available.
- [x] Verification logic now treats unknown channel/guild/access as inconclusive (keep DB row), and only treats unknown message as verifiable-missing.
- [x] Startup maintenance now runs after reader-bot initialization, and receives reader client context for verification when available.

## Command Phase Progress
### Phase A
- [x] Covered `/proforward` subcommands show deprecation notice to Web Admin.

### Phase B
- [x] Web-managed `/proforward` subcommands hidden from slash registration/help.

### Phase C
- [x] Covered `/proforward` subcommands disabled at runtime and redirected to Web Admin.

### Phase D
- [x] Web Logs now has message-ID search.
- [x] Web Logs now has source-message retry action.
- [x] `/proforward retry` is now web-managed/disabled and hidden from slash registration.
- [ ] Disable remaining commands only after final web parity for gaps below.

## Coverage Matrix (Current)
- `/proforward setup`: Covered by `Configs` -> `Create Discord Forward`.
- `/proforward telegram`: Covered by `Configs` -> `Create Telegram Forward`.
- `/proforward list`: Covered by `Configs` -> `Forward Configurations`.
- `/proforward remove`: Covered by `Configs` row action -> `Remove`.
- `/proforward auto-publish`: Covered by `Auto Publish`.
- `/proforward test`: Covered by `Configs` row action -> `Test TG`.
- `/proforward retry`: Covered by `Logs` -> `Retry Source Message` (command disabled).
- `/proforward status`: Covered by `Dashboard` + `Guilds` (kept in Discord as quick status helper).
- `/proforward reader-status`: Covered by dashboard `Reader Diagnostics` + `Guilds` invite/status cards.
- `/proforward telegram-discover`: Retired/disabled; web Telegram setup supports `Chat ID`, `@username`, and `t.me` verification directly.
- `/debug search`: Covered by Debug tab message drilldown (`GET /api/debug/message-search`) plus Logs message-ID search.
- `/debug database`: Covered by debug-gated `Debug` tab + `GET /api/debug/database`.

## Remaining Gaps Before Full Command Shutdown
1. Decide whether to keep helper commands (`status`, `reader-status`, `/debug *`) long-term or fully move to web-only workflows.

## Recent Implementation Timeline (Including In-Between/Extra Work)
- `d42bad5` docs: phased hardening plan for web admin/logs/telegram.
- `fc25d56` docs: archived post-rename audit under `Documentations/`.
- `c57244e` web UI: fixed boolean color alignment and status badge width.
- `07fbac4` web admin: added failed-log cleanup controls.
- `c47abb3` DB: self-heal message chain columns before chain inserts.
- `f6f8a45` Telegram: resilient send fallbacks for parse/preview failures.
- `9b3e3bc` web admin: added age-based failed-log cleanup action.
- `9a00787` docs: phased setup-selector + auto-publish plan.
- `7b06f02` web admin: setup-options + auto-publish APIs.
- `57060e8` web admin: searchable setup selectors.
- `284fc99` web admin: auto-publish management tab.
- `87234b2` docs: recorded setup/autopublish phase implementation status.
- `9601755` web admin: reader-bot source guild support for configs/autopublish.
- `801382a` web admin: improved create UX and config-delete log cleanup.
- `b5fa2ce` docs: command-to-web coverage map.
- `0ca846c` web settings: existing-keys-only + per-emoji removal mode.
- `5d1f064` docs: done-vs-pending tracker.
- `b17c8ac` web UI: dropdown labels + emoji settings readability.
- `1f6a000` commands phase A: deprecation notices.
- `0cf96ea` commands phase B: hide web-managed subcommands.
- `b7e47bc` web UI: full Telegram labels and settings copy cleanup.
- `d836e3e` commands phase C: disable web-managed slash subcommands.
- `ce37a72` web admin: split config layout, logs search, logs retry.
- `938ada9` fixes: Telegram discovery cache invalidation + safer orphan log cleanup.
- `331869a` phase D: `/proforward retry` disabled and tracker updated.
- `0b75241` logs hardening: DB-first-safe verification for startup maintenance + reader-client-aware source checks.
- `6b9196c` telegram tracking: persistent chat tracker + startup sync + discovery pipeline baseline.
- `d5ff4a5` telegram UX: moved verify into create flow and simplified UI interactions.
- `578cfb3` telegram web UX: manual-first target layout + tracked chat remove with in-use safety guard.

## Latest Incident Note (Logs Not Showing)
- Symptom reported: Web Logs appeared empty after restart while forwards were being used.
- Direct DB check result at investigation time: `message_logs` table had `0` rows.
- Root cause: startup orphan cleanup could remove rows when source messages were not verifiable from main-bot context (notably reader-bot source guild scenarios).
- Fix approach:
  1. Keep database rows unless source-message absence is conclusively verifiable.
  2. Treat unknown channel/guild/missing-access as inconclusive (no delete).
  3. Only treat unknown message as verifiable missing.
  4. Pass reader bot client into maintenance checks and run maintenance after reader initialization.
- Result: historical logs are preserved by default when verification is ambiguous; DB remains source of truth.

## Known Limitations / Accepted Tradeoffs
- Telegram Bot API does not provide a direct "list all chats bot is in" endpoint; discovery remains best-effort.
- Native browser `<select><option>` popup width behavior can vary by OS/browser and is not fully controllable with CSS.

## Keep Enabled For Now
- `/proforward reader-status`
- `/debug database`
- `/debug search`
