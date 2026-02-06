# Command Deprecation Coverage (Web Admin)

Date: 2026-02-06

## Goal
Move day-to-day management from slash commands to web admin without losing critical capabilities.

## Progress Tracker (Updated: 2026-02-06)
### Completed
- [x] Forward-create UX now clears inputs and shows explicit success feedback.
- [x] Config deletion now also removes related `message_logs` entries.
- [x] Logs tab now shows target context (`Discord` vs `Telegram`), improved failed-delete UX, and removed `Delete Failed Older`.
- [x] Bot Settings web UI is now existing-keys-only (new setting creation from web is blocked).
- [x] `uploaded_emoji_names` is shown as individual entries with per-emoji remove actions.
- [x] Generic add-setting and manual emoji-add workflow was removed from web settings UI.
- [x] Deleting the whole `uploaded_emoji_names` key via web API is blocked.
- [x] Settings UI cleanup: removed outdated helper copy and improved emoji-name visibility layout.
- [x] Telegram chat dropdown now keeps full labels and expands as full-width listbox for readable option selection.
- [x] Phase A complete: covered `/proforward` subcommands now show deprecation notice pointing to Web Admin.
- [x] Phase B complete: web-managed `/proforward` subcommands are hidden from slash command registration/help surface.
- [x] Phase C complete: covered `/proforward` subcommands are disabled at runtime and now redirect to Web Admin.
- [x] Config tab create forms were redesigned into side-by-side Source/Target boxes for denser layout.
- [x] Phase D progress: web Logs tab now supports message-ID search and source-message retry action.
- [x] Telegram chat discovery now invalidates cache on config create/remove, so deleted Telegram configs disappear immediately from dropdown options.
- [x] Telegram discovery list now excludes private chats and keeps group/supergroup/channel targets only (plus configured negative chat IDs).
- [x] Startup orphan-log cleanup now only deletes when source-message absence is verifiable (prevents log wipe from unverifiable channels after restart).
- [x] Phase D progress: `/proforward retry` is now web-managed/disabled and hidden from slash registration.

### Still To Do
- [ ] Phase D: disable remaining commands after web parity for remaining gaps.
- [ ] Add reader-bot diagnostics panel equivalent to `reader-status`.
- [ ] Add Telegram username/link discovery option beyond update-history discovery.
- [ ] Decide whether per-emoji remove should also delete the actual Discord application emoji asset (current behavior removes the stored name entry).

## Coverage Matrix
- `/proforward setup`: Covered by `Configs` tab -> `Create Discord Forward`.
- `/proforward telegram`: Covered by `Configs` tab -> `Create Telegram Forward`.
- `/proforward list`: Covered by `Configs` tab -> `Forward Configurations` table.
- `/proforward remove`: Covered by `Configs` tab row action -> `Remove`.
- `/proforward auto-publish`: Covered by `Auto Publish` tab.
- `/proforward test`: Covered by `Configs` tab row action -> `Test TG` (Telegram targets).
- `/proforward status`: Mostly covered by `Dashboard` and `Guilds` tabs.
- `/proforward reader-status`: Partially covered by `Guilds` tab (reader visibility present, but no direct command-style diagnostic output).
- `/proforward telegram-discover`: Partially covered by Telegram chat discovery in `Create Telegram Forward` (update-based discovery only).
- `/proforward retry`: Covered by `Logs` tab -> `Retry Source Message`.
- `/debug database`: Partially covered by `Logs` tab (no raw DB-style multi-entry debug dump).
- `/debug search`: Covered by `Logs` tab -> message-ID search.

## Safe First Deprecation Set
These can be marked deprecated now (warning in command response), then disabled later:
- `/proforward setup`
- `/proforward telegram`
- `/proforward list`
- `/proforward remove`
- `/proforward auto-publish`
- `/proforward test`

## Keep Enabled For Now
- `/proforward telegram-discover`
- `/proforward reader-status`
- `/debug database`
- `/debug search`

## Web Gaps To Implement Before Full Command Shutdown
1. Add reader-bot diagnostics panel equivalent to `reader-status` details.
2. Add Telegram username/link discovery option beyond update-history discovery.

## Bot Settings UI Status
- [x] Focused UI on practical operations.
- [x] No manual emoji add flow in web UI.
- [x] `uploaded_emoji_names` rendered as individual entries.
- [x] Per-emoji remove implemented.
- [x] Generic `Add Setting` workflow removed from web UI.

## Suggested Rollout
1. Phase A: mark covered commands as deprecated in responses.
2. Phase B: hide covered commands from registration/help.
3. Phase C: disable covered commands after 1-2 release cycles.
4. Phase D: disable remaining commands after web parity for listed gaps.
