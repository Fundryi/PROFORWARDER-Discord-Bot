# ProForwarder Discord Bot - New Code Review Issues

Date: 2026-02-05
Last Updated: 2026-02-05

This document tracks NEW issues found after the archived review.
For previous issues and fixes, see `Documentations/CODE_REVIEW_ISSUES.md`.

---

## Fixed Issues

### [FIXED] Reader bot export remains stale (High)
- **Severity:** High
- **File:** `index.js`
- **Issue:** `readerBot` is exported by value at module load time; later reassignment doesn't update importers. Reader-bot commands always see `null`.
- **Fix:** Added `module.exports.readerBot = readerBot` immediately after creating the `ReaderBot` instance in the `clientReady` callback. All importers use `require('../index')` inside function bodies (not at module top level), so they always get the live value from the mutated exports object.

### [FIXED] Reader-bot edits never propagate (High)
- **Severity:** High
- **File:** `readerBot.js`
- **Issue:** `handleMessageUpdate(oldMessage, newMessage)` calls `handleMessageUpdate(originalMessage, originalMessage)` which makes edit detection a no-op.
- **Fix:** `handleMessageUpdate` now passes `oldMessage` as a 4th argument to `sendToMainBot`. The `sendToMainBot` method accepts the `oldMessage` parameter and passes it correctly as the first argument to the main bot's `handleMessageUpdate(oldMessage, newMessage, client)`.

### [FIXED] Telegram message chains not scoped per config (High)
- **Severity:** High
- **File:** `utils/database.js`, `events/messageEvents.js`
- **Issue:** `getMessageChain()` / `deleteMessageChain()` only filter by `originalMessageId`, so multiple Telegram targets for the same source can clobber each other.
- **Fix:** Both `getMessageChain(originalMessageId, configId)` and `deleteMessageChain(originalMessageId, configId)` now accept an optional `configId` parameter. When provided, queries include `AND configId = ?` to scope results. All 4 call sites in `messageEvents.js` now pass `logEntry.configId`. Without `configId`, behavior is unchanged (backwards compatible).

### [FIXED] Telegram chain edits assume media + 2 messages (High)
- **Severity:** High
- **File:** `handlers/telegram/telegramUtils.js`, `handlers/telegramHandler.js`, `events/messageEvents.js`
- **Issue:** `editMessageChain()` assumes first message is media (caption edit) and only edits/deletes the second message. Text-only chains and chains with >2 parts break.
- **Fix:** Added a `hasMedia` parameter that flows from `messageEvents.js` through `telegramHandler.js` to `telegramUtils.editMessageChain()`. The first message is now edited with `editMessageCaption` (media) or `editMessageText` (text-only) based on this flag. The first message's length limit is now correct: caption limit for media, 4000 for text. Extra messages beyond 2 parts are deleted when the chain shrinks.

### [FIXED] Telegram edit "delete and resend" breaks on split captions (High)
- **Severity:** High
- **File:** `events/messageEvents.js`
- **Issue:** `deleteAndResendTelegram()` assumes `sendMediaWithCaption()` returns a single message. When it returns `{ isSplit, messageChain }`, `newMessageId` is `undefined` and `toString()` throws.
- **Fix:** `deleteAndResendTelegram` now checks for `result.isSplit && result.messageChain`. When detected, it cleans up the old DB entry with config-scoped `deleteMessageChain` and logs the new chain via `logMessageChain`. For non-split results, the original extraction logic is preserved with safer `Array.isArray` checking.

### [FIXED] Media group forwards only log the first message (Medium)
- **Severity:** Medium
- **File:** `handlers/forwardHandler.js`
- **Issue:** Telegram `sendMediaGroup` returns multiple IDs but only the first is logged. Edit/delete leaves orphaned media messages.
- **Fix:** In `forwardToTelegram`, when `telegramResult` is an array with >1 elements (media group response), all message IDs are extracted and logged as a chain via `logMessageChain()`. Edit/delete operations now correctly find and clean up all messages in the media group.

### [FIXED] Possible DB startup race on fresh install (Medium)
- **Severity:** Medium
- **File:** `utils/database.js`
- **Issue:** `fs.mkdir()` is async and not awaited before opening SQLite; first run can fail if `data/` doesn't exist yet.
- **Fix:** Changed `require('fs').promises` to `require('fs')` and replaced the async `fs.mkdir()` (which was not awaited) with synchronous `fs.mkdirSync()`. The directory is now guaranteed to exist before SQLite tries to open the database file. No other code in this file used async `fs`.

### [FIXED] AI edit flow uses original message ID for thread lookup (Medium)
- **Severity:** Medium
- **File:** `handlers/aiHandler.js`
- **Issue:** Threads are tracked by forwarded message ID, but edits and deletes query threads using the original message ID.
- **Fix:** Both `handleMessageEdit` and `handleMessageDelete` now use `getMessageLogsByOriginalMessage()` to find forwarded message IDs first, then query `threadManager.getThreadsForMessage()` for each forwarded ID. This matches how `trackThread` stores threads (keyed by forwarded message ID).

### [FIXED] Unregistered command modules (Low)
- **Severity:** Low
- **File:** `commands/configCommands.js`, `commands/forwardCommands.js`, `commands/helpCommands.js`
- **Issue:** Commands exist but aren't registered, so they're effectively dead code.
- **Fix:** Deleted all three files. They defined `/config`, `/forward`, and `/help` slash commands but were never imported or registered anywhere. Their functionality is already covered by `/proforward` subcommands.

---

## Open Issues

No open issues.

---

End of report.
