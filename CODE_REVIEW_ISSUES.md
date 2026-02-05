# ProForwarder Discord Bot - New Code Review Issues

Date: 2026-02-05
Last Updated: 2026-02-05

This document tracks NEW issues found after the archived review.
For previous issues and fixes, see `Documentations/CODE_REVIEW_ISSUES.md`.

---

## Open Issues

### [OPEN] Reader bot export remains stale (High)
- **Severity:** High
- **File:** `index.js`, `commands/proforwardCommand.js`
- **Issue:** `readerBot` is exported by value at module load time; later reassignment doesn’t update importers. Reader-bot commands always see `null`.
- **Minimal fix:** After creating `readerBot`, set `module.exports.readerBot = readerBot`, or export a getter (e.g., `getReaderBot()`).

### [OPEN] Reader-bot edits never propagate (High)
- **Severity:** High
- **File:** `readerBot.js`
- **Issue:** `handleMessageUpdate(oldMessage, newMessage)` calls `handleMessageUpdate(originalMessage, originalMessage)` which makes edit detection a no-op.
- **Minimal fix:** Pass the actual `oldMessage` and `newMessage` from the reader bot event, or cache the previous content to construct a minimal `oldMessage`.

### [OPEN] Telegram message chains not scoped per config (High)
- **Severity:** High
- **File:** `utils/database.js`, `events/messageEvents.js`
- **Issue:** `getMessageChain()` / `deleteMessageChain()` only filter by `originalMessageId`, so multiple Telegram targets for the same source can clobber each other.
- **Minimal fix:** Add `configId` (and/or `forwardedChannelId`) filters and pass them through call sites.

### [OPEN] Telegram chain edits assume media + 2 messages (High)
- **Severity:** High
- **File:** `handlers/telegram/telegramUtils.js`
- **Issue:** `editMessageChain()` assumes first message is media (caption edit) and only edits/deletes the second message. Text-only chains and chains with >2 parts break.
- **Minimal fix:** Detect chain type (media vs text) and edit all parts; if text-only, use `editMessageText`. For >2 parts, iterate or rebuild the chain.

### [OPEN] Telegram edit “delete and resend” breaks on split captions (High)
- **Severity:** High
- **File:** `events/messageEvents.js`
- **Issue:** `deleteAndResendTelegram()` assumes `sendMediaWithCaption()` returns a single message. When it returns `{ isSplit, messageChain }`, `newMessageId` is `undefined` and `toString()` throws.
- **Minimal fix:** Handle split results by logging the chain (`logMessageChain`) or using `messageChain[0]` for the primary ID.

### [OPEN] Media group forwards only log the first message (Medium)
- **Severity:** Medium
- **File:** `handlers/forwardHandler.js`, `events/messageEvents.js`
- **Issue:** Telegram `sendMediaGroup` returns multiple IDs but only the first is logged. Edit/delete leaves orphaned media messages.
- **Minimal fix:** Treat media groups as chains: log all message IDs and delete/edit the entire list.

### [OPEN] Possible DB startup race on fresh install (Medium)
- **Severity:** Medium
- **File:** `utils/database.js`
- **Issue:** `fs.mkdir()` is async and not awaited before opening SQLite; first run can fail if `data/` doesn’t exist yet.
- **Minimal fix:** Await `fs.mkdir` before `new sqlite3.Database(...)` or use `fs.mkdirSync`.

### [OPEN] AI edit flow uses original message ID for thread lookup (Medium)
- **Severity:** Medium
- **File:** `handlers/aiHandler.js`, `utils/threadManager.js`
- **Issue:** Threads are tracked by forwarded message ID, but edits query threads using the original message ID.
- **Minimal fix:** Map original→forwarded IDs via `getMessageLogsByOriginalMessage()` and query threads with forwarded IDs (or store original→forwarded mapping when creating the thread).

### [OPEN] Unregistered command modules (Low)
- **Severity:** Low
- **File:** `commands/configCommands.js`, `commands/forwardCommands.js`, `commands/helpCommands.js`, `index.js`
- **Issue:** Commands exist but aren’t registered, so they’re effectively dead code.
- **Minimal fix:** Add them to `client.application.commands.set([...])` if they’re intended, or remove the unused files.

---

End of report.
