# Command Deprecation Coverage (Web Admin)

Date: 2026-02-06
Status: In progress (Phase D)

## Goal
Move day-to-day management from slash commands to web admin without losing critical capabilities.

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

### Log maintenance hardening
- [x] Startup orphan cleanup now deletes only when source-message absence is verifiable.
- [x] This avoids accidental log loss after restart when channels/messages are temporarily unverifiable.

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
- `/proforward status`: Mostly covered by `Dashboard` and `Guilds`.
- `/proforward reader-status`: Partially covered; no full command-style diagnostics panel yet.
- `/proforward telegram-discover`: Partially covered by update/config-based discovery only.
- `/debug search`: Covered by `Logs` message-ID search.
- `/debug database`: Partially covered by `Logs`; no raw multi-row debug dump view.

## Remaining Gaps Before Full Command Shutdown
1. Add web reader-bot diagnostics panel equivalent to `/proforward reader-status`.
2. Add Telegram username/link discovery path beyond update-history discovery.
3. Decide whether per-emoji remove should also remove the Discord application emoji asset, not only the DB name entry.
4. Decide whether to keep `/debug database` as terminal-only diagnostics.

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

## Known Limitations / Accepted Tradeoffs
- Telegram Bot API does not provide a direct "list all chats bot is in" endpoint; discovery remains best-effort.
- Native browser `<select><option>` popup width behavior can vary by OS/browser and is not fully controllable with CSS.

## Keep Enabled For Now
- `/proforward telegram-discover`
- `/proforward reader-status`
- `/debug database`
- `/debug search`
