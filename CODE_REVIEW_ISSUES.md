# ProForwarder Discord Bot - Code Review Issues

Date: 2026-02-05
Last Updated: 2026-02-05

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
- **Review status:** Needs follow-up
- **Notes:** In the edit path, debug logging still references `messageLogs` which no longer exists. If `debugMode` is true and no forwarded versions are found, this will throw a `ReferenceError`. Either reintroduce a local `messageLogs` for debug or remove that block.

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
- **Review status:** Partial
- **Notes:** Retry processing now depends on cached channels only. If the channel is not in cache (or is a DM), the retry is dropped. Consider fetching the channel via `client.channels.fetch` or `guild.channels.fetch` before removing the item.

### [FIXED] Config Reload Race Condition (High #5)
- **Severity:** High
- **File:** `utils/configManager.js:126-210`
- **Issue:** No file locking between read and write operations
- **Fix:** Added write lock queue mechanism with `acquireWriteLock()`/`releaseWriteLock()` and cache invalidation after writes
- **Review status:** Partial
- **Notes:** `toggleAutoPublishChannel()` still writes without acquiring the lock and does not invalidate the cache. If multiple writes occur, races are still possible. Also note that the lock is in-process only (not safe across multiple bot processes).

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
- **Fix:** `errorHandlers.js` now uses logger; `index.js` handler kept for process-specific handling
- **Review status:** Incorrect
- **Notes:** There are still two `unhandledRejection` handlers, so duplicate logging persists. Either remove the `index.js` handler or merge logic into `errorHandlers.js` and register once.

### [FIXED] Config cache delays new setup (Medium #7 - side effect of #5)
- **Severity:** Medium
- **File:** `utils/configManager.js`
- **Issue:** 5-minute cache meant new configs didn't apply immediately
- **Fix:** Cache is now invalidated after `addForwardConfig` and `disableForwardConfig`
- **Review status:** OK (for forwardConfigs only)

---

## Open Issues

### High

#### 1. Debug block references undefined variable in edit path
- **File:** `events/messageEvents.js:120-127`
- **Issue:** `messageLogs` is not defined after switching to `getMessageLogsByOriginalMessage()`
- **Impact:** `debugMode` will throw `ReferenceError` when no forwarded versions are found
- **Suggested Fix:** Remove the loose-match block or reintroduce a local `messageLogs` fetch for debug only

### Medium

#### 2. Retry queue may drop items if channel is not cached
- **File:** `handlers/forwardHandler.js:519-540`
- **Issue:** Retry processing relies on cached channels only
- **Impact:** Retries can be dropped even when messages still exist (cache misses or DMs)
- **Suggested Fix:** Use `client.channels.fetch(channelId)` or `guild.channels.fetch(channelId)` before removing items

#### 3. Config write lock not applied to auto-publish writes
- **File:** `utils/configManager.js:383-441`
- **Issue:** `toggleAutoPublishChannel()` writes without acquiring the lock
- **Impact:** Possible race conditions with concurrent config writes
- **Suggested Fix:** Wrap this function with `acquireWriteLock()`/`releaseWriteLock()` and consider cache invalidation

#### 4. Fallback (non-webhook) forwarding can ping everyone/roles
- **File:** `handlers/forwardHandler.js:413-420`
- **Issue:** Fallback messages don't set `allowedMentions`
- **Impact:** Unintended mentions in forwarded messages
- **Suggested Fix:** Set `allowedMentions` on fallback sends

#### 5. AI provider config mismatch
- **File:** `utils/aiManager.js:43-67,191-193`, `config/env.js.example`
- **Issue:** Docs list OpenAI/DeepL but AIManager only initializes Gemini/Google
- **Impact:** OpenAI/DeepL paths won't work as documented
- **Suggested Fix:** Align providers with documentation

### Low

#### 6. Edit detection may miss embed changes
- **File:** `events/messageEvents.js:70-73`
- **Issue:** Only compares embed count, not content
- **Impact:** Some embed edits won't propagate
- **Suggested Fix:** Compare embed content or hash

#### 7. Telegram orphan cleanup misses positive chat IDs
- **File:** `utils/database.js:518`
- **Issue:** Only treats IDs starting with `-` as Telegram
- **Impact:** Orphaned messages in private chats not cleaned
- **Suggested Fix:** Track target type in logs

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
