# ProForwarder Discord Bot – Review Issues and Fix Ideas

Date: 2026-02-05

This document summarizes issues found during a read-only review and provides suggested fixes. No code changes were applied.

## Critical

1. AI edit/delete flow can throw when AI is enabled
- What: `threadManager.getThreadsForMessage` is async but is called without `await`, and `threadManager.sendTranslationMessage` is referenced but does not exist.
- Impact: Edits/deletes will crash or silently fail once AI features are enabled.
- Where:
  - `handlers/aiHandler.js:237,291,321`
  - `utils/threadManager.js:330`
- Suggested fix:
  - Add `await` to `getThreadsForMessage` calls.
  - Replace `sendTranslationMessage` with an existing method (or implement it). If the intent is to post an updated translation, add a method to `ThreadManager` that edits or posts updates, then use it here.

## High

2. Edit/delete propagation only checks last 100 logs
- What: `getMessageLogs()` defaults to a 100-row limit, so older forwarded messages won’t be updated/deleted.
- Impact: Edits/deletes of older messages won’t propagate.
- Where:
  - `events/messageEvents.js:93,299`
- Suggested fix:
  - Add a targeted DB query by `originalMessageId` (you already have `getMessageLogsByOriginalMessage`), or pass a much higher limit for edit/delete paths.

3. Telegram chains processed multiple times on edit/delete
- What: You loop over `forwardedVersions` (one per chain entry) and each call updates or deletes the entire chain.
- Impact: Duplicate Telegram API calls, race conditions, and possible errors.
- Where:
  - `events/messageEvents.js:106-140,318-350`
- Suggested fix:
  - Deduplicate by chain parent or original message ID before calling chain operations, or treat chain entries as a single logical target.

## Medium

4. Fallback (non-webhook) forwarding can ping everyone/roles/users
- What: When webhooks are unavailable, fallback messages don’t set `allowedMentions`.
- Impact: Unintended mentions in forwarded messages.
- Where:
  - `handlers/forwardHandler.js:413-420`
- Suggested fix:
  - Set `allowedMentions` on fallback sends to block by default, and optionally allow `@everyone/@here` based on config (similar to webhook path).

5. Config cache delays new `/proforward setup` taking effect
- What: Config cache is valid for 5 minutes; new configs won’t be active until cache expires.
- Impact: User runs setup, forwarding doesn’t start immediately.
- Where:
  - `utils/configManager.js:10-21,126-133`
- Suggested fix:
  - Invalidate cache after `addForwardConfig` or call `loadForwardConfigs(true)` after writing. Optionally reduce cache duration.

6. AI provider config mismatch (OpenAI/DeepL)
- What: `env.js.example` lists OpenAI/DeepL, but `AIManager` only initializes Gemini/Google. `optimizeContent` prefers OpenAI but it is never registered.
- Impact: Content optimization and OpenAI/DeepL paths won’t work as documented.
- Where:
  - `utils/aiManager.js:43-67,191-193`
  - `config/env.js.example`
- Suggested fix:
  - Initialize OpenAI/DeepL providers in `AIManager` or remove them from docs/examples. Align `providerPreferences` and `selectProvider` with actual providers.

## Low

7. Edit detection may miss embed changes
- What: The edit check only compares embed count, not content. Changing an embed without changing count won’t trigger update.
- Impact: Some edits won’t propagate.
- Where:
  - `events/messageEvents.js:70-73`
- Suggested fix:
  - Compare embed IDs or embed JSON (e.g., hash) to detect content changes.

8. Telegram orphan cleanup misses positive chat IDs
- What: Orphan cleanup treats Telegram targets only if `forwardedChannelId` starts with `-`.
- Impact: Orphaned messages in private chats with positive IDs won’t be cleaned.
- Where:
  - `utils/database.js:518`
- Suggested fix:
  - Track target type in logs or infer Telegram targets from config/log fields rather than sign of ID.

9. Duplicate unhandledRejection handlers
- What: You register unhandled rejection handlers in both `errorHandlers.js` and `index.js`.
- Impact: Duplicate logs, noisy output.
- Where:
  - `errorHandlers.js:4-6`
  - `index.js:144`
- Suggested fix:
  - Keep one handler (prefer the centralized `errorHandlers.js`) and remove the duplicate.

## Test Gaps

- No automated tests or test scripts detected in `package.json`.
- Suggested fix:
  - Add at least a minimal test script (e.g., unit tests for config manager, DB log lookups, and Telegram chain handling).

## Follow-up Questions

1. Do you want a single “all translations” thread per message (current behavior) or one thread per language? The edit/update logic assumes per-language threads.

---
End of report.
