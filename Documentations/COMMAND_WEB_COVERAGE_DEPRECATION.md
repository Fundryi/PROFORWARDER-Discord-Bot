# Command Deprecation Coverage (Web Admin)

Date: 2026-02-06

## Goal
Move day-to-day management from slash commands to web admin without losing critical capabilities.

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
- `/proforward retry`: Not covered in web admin yet.
- `/debug database`: Partially covered by `Logs` tab (no raw DB-style multi-entry debug dump).
- `/debug search`: Not covered in web admin yet (no direct message-id search UI).

## Safe First Deprecation Set
These can be marked deprecated now (warning in command response), then disabled later:
- `/proforward setup`
- `/proforward telegram`
- `/proforward list`
- `/proforward remove`
- `/proforward auto-publish`
- `/proforward test`

## Keep Enabled For Now
- `/proforward retry`
- `/proforward telegram-discover`
- `/proforward reader-status`
- `/debug database`
- `/debug search`

## Web Gaps To Implement Before Full Command Shutdown
1. Add web action to retry/force-forward by source message ID.
2. Add web logs search by original/forwarded message ID.
3. Add reader-bot diagnostics panel equivalent to `reader-status` details.
4. Add Telegram username/link discovery option beyond update-history discovery.

## Bot Settings UI TODO
1. Adjust Bot Settings web UI to focus on operations we actually need.
2. Do not support manual emoji adds from web UI.
3. Show `uploaded_emoji_names` as individual emoji entries (not only raw JSON).
4. Provide per-emoji remove/delete actions for those entries.
5. Remove/disable generic "Add Setting" and emoji-add workflows in web UI.

## Suggested Rollout
1. Phase A: mark covered commands as deprecated in responses.
2. Phase B: hide covered commands from registration/help.
3. Phase C: disable covered commands after 1-2 release cycles.
4. Phase D: disable remaining commands after web parity for listed gaps.
