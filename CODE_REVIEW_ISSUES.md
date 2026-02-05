# ProForwarder Discord Bot - Code Review Issues

Date: 2026-02-05
Last Updated: 2026-02-05 (Re-review: remaining issues noted)

This document tracks issues found during code review and their resolution status.

---

## Fixed Issues

### [FIXED] AI edit/delete flow throws when AI enabled (Critical #1)
- **Severity:** Critical
- **File:** `handlers/aiHandler.js:237,291,321`
- **Issue:** `threadManager.getThreadsForMessage` is async but called without `await`; `sendTranslationMessage` did not exist
- **Fix:** Added `await` to all `getThreadsForMessage` calls; replaced `sendTranslationMessage` with inline embed sending logic
- **Review status:** OK
- **Notes:** The fix resolves the crash. Translation update embeds now differ from initial translation embeds (no author/avatar/image handling), which is a behavior change but not a functional break.

### [FIXED] Edit/delete propagation only checks last 100 logs (High #2)
- **Severity:** High
- **File:** `events/messageEvents.js`
- **Issue:** `getMessageLogs()` defaults to 100-row limit, missing older forwarded messages
- **Fix:** Changed to use `getMessageLogsByOriginalMessage()` which queries by specific message ID without limit
- **Review status:** OK (follow-up completed)
- **Notes:** Removed the debug block that referenced undefined `messageLogs` variable.

### [FIXED] Telegram chains processed multiple times (High #3)
- **Severity:** High
- **File:** `events/messageEvents.js`
- **Issue:** Loop over `forwardedVersions` called chain operations multiple times for the same chain
- **Fix:** Added deduplication by `originalMessageId + configId` before processing Telegram targets
- **Review status:** OK

### [FIXED] Memory Leak: Unbounded Retry Queue (High #4)
- **Severity:** High
- **File:** `handlers/forwardHandler.js:454-467`
- **Issue:** `this.retryQueue` Map grew without cleanup strategy
- **Fix:** Added MAX_RETRY_QUEUE_SIZE (100), MAX_RETRY_AGE (1 hour), stale entry cleanup, and fresh message fetching
- **Review status:** OK (follow-up completed)
- **Notes:** Updated to use `client.channels.fetch()` and `guild.channels.fetch()` instead of cache-only lookups.

### [FIXED] Config Reload Race Condition (High #5)
- **Severity:** High
- **File:** `utils/configManager.js:126-210`
- **Issue:** No file locking between read and write operations
- **Fix:** Added write lock queue mechanism with `acquireWriteLock()`/`releaseWriteLock()` and cache invalidation after writes
- **Review status:** OK (follow-up completed)
- **Notes:** `toggleAutoPublishChannel()` now also uses the write lock and invalidates cache. Lock is in-process only (not safe across multiple bot processes, but this bot is typically single-instance).

### [FIXED] Webhook Loop Risk
- **Severity:** Critical
- **File:** `events/messageEvents.js:76-79, 291-294`
- **Issue:** If `fetchWebhook()` failed, the message was forwarded anyway, risking infinite loops
- **Fix:** Now skips message if webhook cannot be verified instead of continuing
- **Review status:** Caution
- **Notes:** This prevents loops but also drops edit/delete handling for legitimate webhook messages when the API call fails (transient errors, missing perms). If that is not intended, add a safer fallback (e.g., proceed only when `webhookId` is null, or add retries).

### [FIXED] setInterval Async Race Condition
- **Severity:** Critical
- **File:** `events/messageEvents.js:17-29`
- **Issue:** `processRetryQueue()` not awaited in setInterval - could cause duplicate forwards
- **Fix:** Added `isProcessingRetryQueue` lock with try/finally pattern
- **Review status:** OK

### [FIXED] isCleaningUp Flag Not Reset on Early Return
- **Severity:** High
- **File:** `utils/applicationEmojiManager.js:312-314`
- **Issue:** Early return bypassed finally block, leaving flag set permanently
- **Fix:** Removed redundant manual reset, now relies on finally block for all paths
- **Review status:** OK

### [FIXED] currentlyEditing Set Persistence After Restart
- **Severity:** Medium
- **File:** `events/messageEvents.js:271-295`
- **Issue:** Set persisted indefinitely, blocking edits after restart
- **Fix:** Changed to Map with timestamps + auto-cleanup after 30 seconds
- **Review status:** OK

### [FIXED] Discord.js Deprecation Warning
- **Severity:** Low
- **File:** `index.js:72`
- **Issue:** `client.on("ready")` deprecated in discord.js v15
- **Fix:** Changed to `client.on("clientReady")`
- **Review status:** OK (discord.js v14 supports `clientReady`, and `ready` is deprecated)

### [FIXED] Unused Dependencies
- **Severity:** Low
- **File:** `package.json`
- **Issue:** `@discordjs/rest` and `discord-api-types` listed but not needed (bundled in discord.js v14)
- **Fix:** Removed from dependencies, updated `applicationEmojiManager.js` to import from `discord.js`
- **Review status:** OK

### [FIXED] Duplicate unhandledRejection Handlers
- **Severity:** Low
- **File:** `errorHandlers.js`, `index.js:144`
- **Issue:** Handlers registered in both files causing duplicate logs
- **Fix:** Removed the handler from `index.js`, kept only `errorHandlers.js`
- **Review status:** OK (follow-up completed)

### [FIXED] Config cache delays new setup (Medium #7 - side effect of #5)
- **Severity:** Medium
- **File:** `utils/configManager.js`
- **Issue:** 5-minute cache meant new configs didn't apply immediately
- **Fix:** Cache is now invalidated after `addForwardConfig`, `disableForwardConfig`, and `toggleAutoPublishChannel`
- **Review status:** OK

### [FIXED] Fallback (non-webhook) forwarding can ping everyone/roles (Medium #8)
- **Severity:** Medium
- **File:** `handlers/forwardHandler.js`
- **Issue:** Fallback messages didn't set `allowedMentions`, causing unintended pings
- **Fix:** Added `allowedMentions: { parse: [] }` by default in `buildEnhancedMessage()`. Now aligned with webhook path: uses `config.allowEveryoneHereMentions`, checks bot `MentionEveryone` permission, handles @here with text indicator replacement
- **Review status:** OK
- **Notes:** Permission check uses `client.channels.cache` for `targetChannelId`; if the channel is not cached, it will treat as no permission and replace mentions. This is safe but slightly more restrictive than intended.

### [FIXED] AI provider config mismatch (Medium #9)
- **Severity:** Medium
- **File:** `config/env.js.example`
- **Issue:** Documentation listed OpenAI/DeepL but AIManager only implements Gemini/Google
- **Fix:** Updated `env.js.example` to document actual implemented providers (gemini as primary, google as fallback)
- **Review status:** OK

### [FIXED] Edit detection may miss embed changes (Low #10)
- **Severity:** Low
- **File:** `events/messageEvents.js`
- **Issue:** Only compared embed count, not content
- **Fix:** Added JSON comparison of embed data: `JSON.stringify(oldMessage.embeds.map(e => e.data)) !== JSON.stringify(newMessage.embeds.map(e => e.data))`
- **Review status:** OK

### [FIXED] Telegram orphan cleanup misses positive chat IDs (Low #11)
- **Severity:** Low
- **File:** `utils/database.js`
- **Issue:** Only treated IDs starting with `-` as Telegram, missing private chat cleanup
- **Fix:** Changed logic to first try finding channel in Discord guilds cache, then assume Telegram if not found. This handles both negative group IDs and positive private chat IDs
- **Review status:** OK

---

## Open Issues

### Low

#### 1. Edit detection may miss embed changes
- **File:** `events/messageEvents.js:70-73`
- **Issue:** Only compares embed count, not content
- **Impact:** Some embed edits won't propagate
- **Suggested Fix (detailed):**
  - Replace the simple count check with a stable comparison of embed data.
  - Example approach:
    - Build a lightweight hash or JSON string from `oldMessage.embeds.map(e => e.data)` and `newMessage.embeds.map(e => e.data)`.
    - Compare the hashes/strings; if they differ, treat as a real edit.
  - Keep the short-circuit fast: only compute embed hashes when counts are equal and content/attachments are unchanged.
  - Avoid including volatile fields (timestamps) if they cause false positives.

#### 2. Edit fallback uses partial config (mention settings lost)
- **File:** `events/messageEvents.js:229-256`
- **Issue:** `buildEnhancedMessage()` is called with a partial config object, so `allowEveryoneHereMentions` is not available
- **Impact:** @everyone/@here are always replaced on edit fallback even when enabled in config
- **Suggested Fix (detailed):**
  - Reuse the full config already fetched at the top of `updateForwardedMessage()`:
    - `const config = await getForwardConfigById(logEntry.configId);`
  - Pass that `config` into `buildEnhancedMessage()` in the fallback path (both the “no webhook permissions” path and the “webhook edit failed” fallback path).
  - This keeps mention handling consistent between initial forward and edit.

---

## Infrastructure Improvements Made

### Docker Setup
- Multi-stage Dockerfile with Node.js 24
- `compose.yaml` with init container for config setup and permissions
- `compose.override.yaml` for local development (gitignored)
- Persistent data at `/srv/docker-data/proforwarder/`
- Healthcheck using dedicated `healthcheck.js`
- Removed `image:` tag to fix Komodo build issues

### Code Quality
- Promisified `exec()` and `close()` in database.js
- `errorHandlers.js` uses logger instead of console.error
- Removed redundant DOCKER_SETUP.md
- Compacted README.md from ~500 to ~210 lines
- Updated discord.js to 14.25.1, axios to latest
- Node.js engine requirement set to >=22.0.0

---

## Test Gaps

- No automated tests detected in `package.json`
- Suggested: Add unit tests for config manager, DB operations, and Telegram chain handling

---

End of report.
