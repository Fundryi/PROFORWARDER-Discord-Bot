# ProForwarder Discord Bot - Code Review Issues

Date: 2026-02-05
Last Updated: 2026-02-05

This document tracks issues found during code review and their resolution status.

---

## Fixed Issues

### [FIXED] Webhook Loop Risk
- **Severity:** Critical
- **File:** `events/messageEvents.js:76-79, 291-294`
- **Issue:** If `fetchWebhook()` failed, the message was forwarded anyway, risking infinite loops
- **Fix:** Now skips message if webhook cannot be verified instead of continuing

### [FIXED] setInterval Async Race Condition
- **Severity:** Critical
- **File:** `events/messageEvents.js:17-29`
- **Issue:** `processRetryQueue()` not awaited in setInterval - could cause duplicate forwards
- **Fix:** Added `isProcessingRetryQueue` lock with try/finally pattern

### [FIXED] isCleaningUp Flag Not Reset on Early Return
- **Severity:** High
- **File:** `utils/applicationEmojiManager.js:312-314`
- **Issue:** Early return bypassed finally block, leaving flag set permanently
- **Fix:** Removed redundant manual reset, now relies on finally block for all paths

### [FIXED] currentlyEditing Set Persistence After Restart
- **Severity:** Medium
- **File:** `events/messageEvents.js:271-295`
- **Issue:** Set persisted indefinitely, blocking edits after restart
- **Fix:** Changed to Map with timestamps + auto-cleanup after 30 seconds

### [FIXED] Discord.js Deprecation Warning
- **Severity:** Low
- **File:** `index.js:72`
- **Issue:** `client.on("ready")` deprecated in discord.js v15
- **Fix:** Changed to `client.on("clientReady")`

### [FIXED] Unused Dependencies
- **Severity:** Low
- **File:** `package.json`
- **Issue:** `@discordjs/rest` and `discord-api-types` listed but not needed (bundled in discord.js v14)
- **Fix:** Removed from dependencies, updated `applicationEmojiManager.js` to import from `discord.js`

### [FIXED] Duplicate unhandledRejection Handlers
- **Severity:** Low
- **File:** `errorHandlers.js`, `index.js:144`
- **Issue:** Handlers registered in both files causing duplicate logs
- **Status:** `errorHandlers.js` now uses logger; `index.js` handler kept for process-specific handling

---

## Open Issues

### Critical

#### 1. AI edit/delete flow can throw when AI is enabled
- **File:** `handlers/aiHandler.js:237,291,321`, `utils/threadManager.js:330`
- **Issue:** `threadManager.getThreadsForMessage` is async but called without `await`; `sendTranslationMessage` does not exist
- **Impact:** Edits/deletes crash or silently fail with AI enabled
- **Suggested Fix:** Add `await` to calls; implement or replace `sendTranslationMessage`

### High

#### 2. Edit/delete propagation only checks last 100 logs
- **File:** `events/messageEvents.js:93,299`
- **Issue:** `getMessageLogs()` defaults to 100-row limit
- **Impact:** Edits/deletes of older messages won't propagate
- **Suggested Fix:** Use `getMessageLogsByOriginalMessage` or pass higher limit

#### 3. Telegram chains processed multiple times on edit/delete
- **File:** `events/messageEvents.js:106-140,318-350`
- **Issue:** Loop over `forwardedVersions` calls chain operations multiple times
- **Impact:** Duplicate Telegram API calls, race conditions
- **Suggested Fix:** Deduplicate by chain parent before calling chain operations

#### 4. Memory Leak: Unbounded Retry Queue
- **File:** `handlers/forwardHandler.js:454-467`
- **Issue:** `this.retryQueue` Map grows without cleanup strategy
- **Impact:** Memory consumption over time
- **Suggested Fix:** Add TTL, size limits, or periodic cleanup

#### 5. Config Reload Race Condition
- **File:** `utils/configManager.js:126-210`
- **Issue:** No file locking between read and write operations
- **Impact:** Concurrent config additions may lose data
- **Suggested Fix:** Implement file locking or atomic write pattern

### Medium

#### 6. Fallback (non-webhook) forwarding can ping everyone/roles
- **File:** `handlers/forwardHandler.js:413-420`
- **Issue:** Fallback messages don't set `allowedMentions`
- **Impact:** Unintended mentions in forwarded messages
- **Suggested Fix:** Set `allowedMentions` on fallback sends

#### 7. Config cache delays new setup taking effect
- **File:** `utils/configManager.js:10-21,126-133`
- **Issue:** 5-minute cache means new configs don't apply immediately
- **Impact:** User runs setup, forwarding doesn't start immediately
- **Suggested Fix:** Invalidate cache after `addForwardConfig`

#### 8. AI provider config mismatch
- **File:** `utils/aiManager.js:43-67,191-193`, `config/env.js.example`
- **Issue:** Docs list OpenAI/DeepL but AIManager only initializes Gemini/Google
- **Impact:** OpenAI/DeepL paths won't work as documented
- **Suggested Fix:** Align providers with documentation

### Low

#### 9. Edit detection may miss embed changes
- **File:** `events/messageEvents.js:70-73`
- **Issue:** Only compares embed count, not content
- **Impact:** Some embed edits won't propagate
- **Suggested Fix:** Compare embed content or hash

#### 10. Telegram orphan cleanup misses positive chat IDs
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

### Code Quality
- Promisified `exec()` and `close()` in database.js
- `errorHandlers.js` uses logger instead of console.error
- Removed redundant DOCKER_SETUP.md
- Compacted README.md from ~500 to ~210 lines

---

## Test Gaps

- No automated tests detected in `package.json`
- Suggested: Add unit tests for config manager, DB operations, and Telegram chain handling

---

End of report.
