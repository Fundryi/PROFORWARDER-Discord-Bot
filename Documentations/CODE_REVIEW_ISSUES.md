# ProForwarder Discord Bot - Consolidated Code Review Issues

Date: 2026-02-05  
Last Updated: 2026-02-06 (merged + re-verified)

Source files merged:
- `CODE_REVIEW_ISSUES.md`
- `Documentations/CODE_REVIEW_ISSUES.md` (previous)

---

## Summary

- Total tracked issues: `28`
- `Done`: `28`
- `Open`: `0`

All previously tracked issues from both files are implemented in current code.

---

## Verification Notes

- Checked issue fix paths in:
  - `index.js`
  - `readerBot.js`
  - `events/messageEvents.js`
  - `handlers/aiHandler.js`
  - `handlers/forwardHandler.js`
  - `handlers/telegramHandler.js`
  - `handlers/telegram/telegramUtils.js`
  - `utils/configManager.js`
  - `utils/database.js`
  - `utils/applicationEmojiManager.js`
  - `package.json`
- Command module cleanup confirmed: only `commands/proforwardCommand.js` and `commands/debugCommands.js` are present.

---

## Consolidated Issue Status

### Critical

1. `AI edit/delete flow throws when AI enabled`  
   Status: `Done`  
   Evidence: `handlers/aiHandler.js` now awaits `getThreadsForMessage(...)` and uses inline embed sending.

2. `Webhook loop risk`  
   Status: `Done`  
   Evidence: `events/messageEvents.js` skips webhook messages when webhook ownership cannot be verified.

3. `setInterval async race condition`  
   Status: `Done`  
   Evidence: `events/messageEvents.js` uses `isProcessingRetryQueue` lock around `processRetryQueue()`.

### High

4. `Edit/delete propagation only checks last 100 logs`  
   Status: `Done`  
   Evidence: `events/messageEvents.js` uses `getMessageLogsByOriginalMessage(...)`.

5. `Telegram chains processed multiple times`  
   Status: `Done`  
   Evidence: `events/messageEvents.js` deduplicates Telegram targets by `originalMessageId + configId`.

6. `Memory leak: unbounded retry queue`  
   Status: `Done`  
   Evidence: `handlers/forwardHandler.js` has size and age-based retry cleanup.

7. `Config reload race condition`  
   Status: `Done`  
   Evidence: `utils/configManager.js` has queued write lock (`acquireWriteLock` / `releaseWriteLock`).

8. `Reader bot export remains stale`  
   Status: `Done`  
   Evidence: `index.js` updates `module.exports.readerBot` after reader bot initialization.

9. `Reader-bot edits never propagate`  
   Status: `Done`  
   Evidence: `readerBot.js` passes `oldMessage` through `sendToMainBot(...)` into main edit handler.

10. `Telegram message chains not scoped per config`  
    Status: `Done`  
    Evidence: `utils/database.js` chain functions accept `configId`; call sites in `events/messageEvents.js` pass it.

11. `Telegram chain edits assume media + 2 messages`  
    Status: `Done`  
    Evidence: `handlers/telegram/telegramUtils.js` uses `hasMedia` and `splitLongText(...)` for N-part chains.

12. `Telegram edit delete+resend breaks on split captions`  
    Status: `Done`  
    Evidence: `events/messageEvents.js` handles `result.isSplit` and updates DB chain accordingly.

### Medium

13. `isCleaningUp flag not reset on early return`  
    Status: `Done`  
    Evidence: `utils/applicationEmojiManager.js` reset happens in `finally`.

14. `currentlyEditing lock persistence after restart/timeout`  
    Status: `Done`  
    Evidence: `events/messageEvents.js` uses timestamped `Map` + timeout cleanup.

15. `Config cache delays new setup`  
    Status: `Done`  
    Evidence: `utils/configManager.js` invalidates cache after config writes.

16. `Fallback forwarding can ping everyone/roles`  
    Status: `Done`  
    Evidence: `handlers/forwardHandler.js` sets default `allowedMentions: { parse: [] }` and controlled mention handling.

17. `AI provider config mismatch`  
    Status: `Done`  
    Evidence: `config/env.js.example` aligns provider docs with implemented providers.

18. `AI edit flow uses original message ID for thread lookup`  
    Status: `Done`  
    Evidence: `handlers/aiHandler.js` resolves forwarded IDs via `getMessageLogsByOriginalMessage(...)` before thread lookup.

19. `Media group edits delete extra attachments`  
    Status: `Done`  
    Evidence: `events/messageEvents.js` has media-group-aware chain edit path.

20. `Media group forwards only log first message`  
    Status: `Done`  
    Evidence: `handlers/forwardHandler.js` logs Telegram media-group IDs as message chain.

21. `Possible DB startup race on fresh install`  
    Status: `Done`  
    Evidence: `utils/database.js` creates data dir with `fs.mkdirSync(...)` before DB open.

### Low

22. `Discord.js deprecation warning (ready -> clientReady)`  
    Status: `Done`  
    Evidence: `index.js` uses `client.on("clientReady", ...)`.

23. `Unused dependencies`  
    Status: `Done`  
    Evidence: `package.json` does not include old redundant Discord REST deps.

24. `Duplicate unhandledRejection handlers`  
    Status: `Done`  
    Evidence: handler present in `errorHandlers.js`; `index.js` no longer registers a second one.

25. `Edit detection may miss embed changes`  
    Status: `Done`  
    Evidence: `events/messageEvents.js` compares embed content with timestamp-stripped data.

26. `Telegram orphan cleanup misses positive chat IDs`  
    Status: `Done`  
    Evidence: `utils/database.js` cleanup uses Discord channel existence checks before treating as Telegram.

27. `Edit fallback uses partial config`  
    Status: `Done`  
    Evidence: `events/messageEvents.js` passes full `config` to `buildEnhancedMessage(...)` when available.

28. `Unregistered command modules remain`  
    Status: `Done`  
    Evidence: orphan modules removed; only active command modules remain.

---

## Open Issues

No open issues from the merged trackers.

---

## Infrastructure Improvements (Completed)

- Docker setup and healthcheck flow implemented.
- Config/data volume strategy in place.
- README and general codebase cleanup completed.
- No automated test script exists yet in `package.json`.

---

End of report.
