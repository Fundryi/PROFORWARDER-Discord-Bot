# Simplify Review — 2026-04-03

Priority-sorted findings from full codebase review (docs + runtime code).
Reviewed by Codex on 2026-04-03 — corrections and priority adjustments incorporated.

**Legend:** [DONE] = implemented, [TODO] = not yet started, [SKIP] = won't fix / false positive

---

# RUNTIME CODE FINDINGS

## [DONE] CRITICAL — Bug: Variable Shadowing Silently Swallows Errors + Skips Retry

**File:** `handlers/forwardHandler.js:136-137`

```js
} catch (logError) {
    logError('Error logging failed forward:', logError);
}
```

The catch variable `logError` shadows the imported `logError` function from `utils/logger.js`. When a DB log failure occurs, this line throws a `TypeError` (calling an error object as a function). This is worse than just losing the error — the `TypeError` propagates and **skips `addToRetryQueue()` on line 141**, so the failed forward is never retried.

**Fix:** Rename catch variable to `dbLogError`.

---

## [DONE] HIGH — Efficiency: `fetchWebhook()` REST API Call on Every Bot Message

**File:** `handlers/forwardHandler.js:58`, `events/messageEvents.js:71`, `events/messageEvents.js:317`

Every `messageCreate`/`messageUpdate`/`messageDelete` from a bot with a `webhookId` triggers `message.fetchWebhook()` — a live Discord REST call — just to check if the name is `'ProForwarder'`. The `webhookCache` in `webhookManager.js` already holds these webhook objects. Use the cache for loop detection instead of hitting the API.

**Risk note (from Codex review):** The cache is process-local and empty after restart. On a cache miss, you still need a safe fallback — otherwise you lose loop protection or incorrectly skip third-party webhook messages. Fix must include: check cache first, fall back to `fetchWebhook()` only on miss, then cache the result.

---

## [DONE] HIGH — Efficiency: `cachedWebhook.fetch()` on Every Forwarded Message

**File:** `utils/webhookManager.js:27-32`

`getWebhook()` calls `cachedWebhook.fetch()` (a Discord REST GET) on every forward to verify the webhook still exists. Webhook deletion between consecutive forwards is extremely rare.

**Also missed:** `utils/webhookManager.js:198` — another `fetch()` call on every Discord-side edit.

**Risk note (from Codex review):** Removing verification needs retry/recreate behavior on send/edit failure, not just deleting the call. Fix must: trust the cache, catch `Unknown Webhook` error 10015 on send/edit, evict from cache, recreate webhook, and retry.

---

## [DONE] HIGH — Efficiency: New `TelegramHandler` Instantiated on Every Edit/Delete

**File:** `events/messageEvents.js:527` (edits), `events/messageEvents.js:1025` (deletes), `utils/database.js:978` (orphan cleanup)

`updateTelegramForwardedMessage` and `deleteTelegramForwardedMessage` each construct a fresh `TelegramHandler` + `initialize()`. `initialize()` triggers a `getMe` API call via `telegramAPI.js:36`. This happens per-event on the message hot path.

**Risk note (from Codex review):** `handleMessageUpdate`/`handleMessageDelete` don't initialize `forwardHandler`, so edits/deletes can arrive before the singleton exists. `cleanupOrphanedLogs` in `database.js` also can't directly reuse the event-module instance. Fix needs lifecycle awareness — lazy-init a shared Telegram handler, or pass it as a parameter.

**Priority split (from Codex review):** The edit/delete paths are HIGH (message hot path). The `database.js:978` cleanup loop is MEDIUM (startup-only, not per-message).

---

## [DONE] MEDIUM — Reuse: `escapeMarkdownV2ForText` Copied into 4 Files

**Files:**
- `utils/formatConverter.js:327` (canonical)
- `utils/sliceFormatConverter.js:420`
- `handlers/telegram/telegramUtils.js:223`
- `handlers/telegram/telegramConverter.js:341`

Identical function body in all four. The canonical version in `formatConverter.js` is already imported by some of these files. The three copies should use the existing import.

---

## [DONE] MEDIUM — Reuse: `@everyone`/`@here` Mention Handling Tripled

**Files:**
- `utils/webhookManager.js:88-127` (sendWebhookMessage)
- `utils/webhookManager.js:225-263` (editWebhookMessage)
- `handlers/forwardHandler.js:416-449` (buildEnhancedMessage)

~40 lines of identical permission-check + string-replacement logic copied three times. Extract to a shared helper in `webhookManager.js`.

---

## [DONE] MEDIUM — Quality: Magic String `'ProForwarder'` in 5 Locations

**Files:** `events/messageEvents.js` (x2), `handlers/forwardHandler.js`, `utils/webhookManager.js` (x2)

The webhook name used for loop detection is a raw string literal in 5 places. CLAUDE.md already warns about this. Export a constant `WEBHOOK_NAME` from `webhookManager.js`.

---

## [DONE] MEDIUM — Quality: Magic String Status Values (`'success'`/`'failed'`/`'retry'`)

**File:** `utils/database.js` (~15 locations), `handlers/forwardHandler.js`, `web/server.js`

Raw status string literals used in ~15 places with no shared constants. A typo would silently misroute records.

**Fix:** Export `MESSAGE_STATUS = Object.freeze({ SUCCESS: 'success', FAILED: 'failed', RETRY: 'retry' })` from `database.js`.

---

## [DONE] MEDIUM — Efficiency: `autoPublish.json` Read from Disk on Every Message

**File:** `events/messageEvents.js` -> `configManager.js:372-380`

`isChannelAutoPublishEnabled` calls `getAutoPublishConfig()` which reads `autoPublish.json` via `fs.readFile` with no caching — on every `messageCreate`. Unlike `loadForwardConfigs` (which is cached), auto-publish bypasses the cache entirely.

---

## [DONE] MEDIUM — Reuse: Attachment/Sticker Processing Duplicated in `webhookManager.js`

**File:** `utils/webhookManager.js:138-169` and `267-298`

The attachment size-check loop + sticker-to-text conversion is copy-pasted between `sendWebhookMessage` and `editWebhookMessage`. Extract to a private helper.

---

## [DONE] MEDIUM — Quality: `TelegramAPI` Ignores URL Scheme

**File:** `handlers/telegram/telegramAPI.js:59-60`

URL stripping removes both `https://` and `http://`, but port is hardcoded to `443` and `https` module is always used. Custom `TELEGRAM_API_URL` pointing to an HTTP local API server will silently fail with TLS errors.

---

## [DONE] LOW — Quality: Raw Channel Type `5` in 6 Locations

**Files:** `events/messageEvents.js:1073`, `web/server.js:1086`, `web/server.js:1251`, `web/server.js:1263`, `web/server.js:3369`, `utils/threadManager.js:280`

Discord.js exports `ChannelType.GuildAnnouncement`. Using the raw literal `5` is a readability/maintainability issue, not a likely breakage — Discord hasn't changed this value. But it appears in 6 places (Codex found 5 additional sites beyond the one originally flagged).

---

## [DONE] LOW — Quality: Unsafe `message.author.id` Access

**File:** `handlers/forwardHandler.js:52`

`message.author.id` accessed without optional chaining. `processMessage()` is only called from `messageCreate` where `author` is normally present, so this is style consistency rather than a real crash risk. Add `?.` for defensive consistency with the rest of the codebase.

*(Downgraded from HIGH per Codex review — `messageCreate` always provides `author`.)*

---

## [DONE] LOW — Quality: Target Separation/Dedup Copy-Pasted in Edit vs Delete

**File:** `events/messageEvents.js:143-153` and `355-375`

The `discordTargets`/`telegramTargets` separation + dedup-by-key logic is identical in both handlers.

---

## [DONE] LOW — Reuse: `textLengthLimit = 4000` Hardcoded in 5+ Locations

**Files:** `handlers/telegramHandler.js:83-84`, `telegramMessageSender.js:256`, `telegramMessageSender.js:502`

`TelegramTextSplitter` already exposes `TEXT_LIMIT = 4000` via `getLimits()`, and `config.telegram.textLengthLimit` exists. Use them.

---

## [DONE] LOW — Efficiency: `logMessageChain` Inserts Rows Without Transaction

**File:** `utils/database.js:464-478`

Chain rows inserted with individual `await run()` calls (implicit autocommit each). Wrapping in a single transaction would reduce WAL write-lock acquisitions for multi-attachment messages.

---

## [DONE] LOW — Quality: Unsafe `message.guild.id` in Auto-Publish

**File:** `events/messageEvents.js:1080`

`message.guild.id` without optional chaining. After the announcement-channel guard at line 1073, `guild` should always exist. This is style consistency, not a real bug.

*(Downgraded from LOW-bug to LOW-style per Codex review.)*

---

## [DONE] LOW — Efficiency: `require('../config/config')` Inside Per-Slice Loop

**File:** `utils/sliceFormatConverter.js:201` (called per formatting token)

`convertSlice()` is called per bold/italic/code token in a message (10-30 times per message). Each call does `require('../config/config')`. Node.js caches the module so this is a hashtable lookup, not a file read. Low real-world impact but easy to fix by hoisting to the outer method.

*(Downgraded from MEDIUM per Codex review — Node.js module cache makes this negligible.)*

---

## [SKIP] LOW — Reuse: AI Provider Axios Error Handling Repeated 4x

**Files:** `utils/ai/geminiProvider.js:332`, `googleProvider.js:255`, `deeplProvider.js:328`, `openaiProvider.js:309`

All four providers have similar 3-branch catch blocks. The blocks are similar but not identical (Codex confirmed subtle differences). A shared utility is possible but the win is modest.

*(Downgraded from MEDIUM per Codex review — not identical enough for a clean shared abstraction.)*

---

## [SKIP] LOW — Reuse: Discord Element Protection for Translation

**Files:**
- `utils/ai/deeplProvider.js:89-173` — `protectDiscordElements`/`restoreDiscordElements`
- `utils/ai/googleProvider.js:171-218` — `preprocessText`/`postprocessText`

Both solve the same problem but DeepL uses XML tags while Google uses placeholder strings. The approaches are structurally different enough that a shared utility would be forced.

*(Downgraded from MEDIUM per Codex review — different mechanisms, not clean dedup candidates.)*

---

# DOCUMENTATION FINDINGS

## [SKIP] DOC-1 — Intentional Duplication (AGENTS.md vs CLAUDE.md) — ACCEPTED

Duplication is correct for Codex compatibility. See prior review for details.

**Remaining consolidation candidates:**
- Roam quick-decision table (AGENTS.md subset of AI_TOOLS.md)
- Troubleshooting section (near-identical in AGENTS.md and AI_TOOLS.md)

---

## [DONE] DOC-2 — Stale README Validation Date

`README.md:17` says "Validated 2026-02-07" but docs were reorganized after that date.

---

## [SKIP] ~~DOC-3 — compose.override.yaml Gitignore Contradiction~~ — RESOLVED

~~Listed as ignored but tracked by git.~~

**False positive (from Codex review):** `git ls-files` confirms `compose.override.yaml` is NOT tracked. The `.gitignore` entry is working correctly.

---

## [DONE] DOC-4 — Forwarding Behavior Missing from CLAUDE.md

README.md lines 170+ describe "Forwarding Behavior" and "Retry Queue" details not in CLAUDE.md. Useful for agents working on forwarding logic.

---

## [DONE] DOC-5 — Unused .gitignore Patterns

`.env.local` / `.env.*.local` are Vite/CRA conventions not used here. Harmless but noisy.

---

## [DONE] ~~DOC-6 — CLAUDE.md Says `readerBot.js` is 6,000+ Lines~~ — FIXED

~~Was 6K, actually 216 lines.~~

**Already fixed** in this session. CLAUDE.md now correctly says ~216 lines in both the architecture tree and gotchas.

---

# REFACTORING FINDINGS

Files reviewed for structural refactoring. Only recommended where it genuinely helps maintainability.

## [DONE] REFACTOR-1 — `web/server.js` (3,605→2,441 lines): Extract 4 Blocks

The file contains ALL Express routes, auth, helpers, AND inline HTML. The routes and auth should stay (they share closure state), but four blocks can be extracted:

| Block | Current location | Target file | Lines saved |
|-------|-----------------|-------------|-------------|
| `renderDashboardPage` (inline HTML template) | Lines 358-902 | `web/views/dashboard.js` | ~545 |
| Reader diagnostics (`buildReaderStatusDiagnostics` + helpers) | Lines 1267-1473 | `web/lib/readerDiagnostics.js` | ~207 |
| Telegram discovery (`collectTelegramChatOptions` + cache + verify) | Lines 1475-1721 | `web/lib/telegramDiscovery.js` | ~250 |
| Debug snapshot builders | Lines 1723-1866 | `web/lib/debugDiagnostics.js` | ~144 |

**Result:** `server.js` drops from 3,605 to ~2,460 lines.

**Coupling details (from Codex reviews — "zero coupling" was overstated):**
- `renderDashboardPage` — no closure deps on `client`/`webAdminConfig`/`allowedRoleIds`, but depends on `escapeHtml` (line 226). Must co-extract or import.
- `buildReaderStatusDiagnostics` — no closure deps, but depends on `getReaderBotClient` (line 931), `isTextOrAnnouncementChannel` (line 1084), and `PermissionFlagsBits` import (line 6). Must pass as params or import.
- Telegram discovery — no closure deps, but uses module-scoped state: `telegramDiscoveryCache` (line 45), `TELEGRAM_DISCOVERY_CACHE_TTL_MS` (line 45), `TELEGRAM_DISCOVERY_ALLOWED_TYPES` (line 50), `clearTelegramDiscoveryCache` (line 53). All must move with it. The clear function is called from 4 route handlers (lines 1713, 2401, 2491, 2632) — must be exported.
- Debug snapshot builders — no closure deps, only uses already-imported DB/config functions. Cleanest extraction.

These are all manageable but not zero-effort. Each extraction needs its dependencies explicitly wired.

**What should NOT be split:**
- Rate limiter (50 lines, single consumer)
- Auth helpers (tightly coupled to `req.session`, used on every route)
- Guild/channel/permission helpers (called pervasively, closure-dependent)
- API route groups (60-360 lines each, share closure state)

---

## [DONE] REFACTOR-2 — `events/messageEvents.js` (1,042→~500 lines): Extract Telegram Update Pipeline

The file contains two distinct domains:

1. **Discord event handlers** (~430 lines) — `handleMessageCreate/Update/Delete`, `updateForwardedMessage`, `deleteForwardedMessage`, `handleAutoPublish`
2. **Telegram update/delete pipeline** (~530 lines) — `updateTelegramForwardedMessage`, `updateSingleTelegramMessage`, `convertToChainAndUpdate`, `deleteAndResendTelegram`, `editTelegramMessageMedia`, `hasMediaChanged`, `deleteTelegramForwardedMessage`

The Telegram block is a self-contained "edit strategy engine" with 4 case branches. None of these functions are Discord events — they are Telegram operation helpers that belong in the existing `handlers/telegram/` directory.

**Confirmed by Codex:** The Telegram functions do NOT depend on module-scoped Discord state (`forwardHandler`, `currentlyEditing`). They use passed-in `client` plus normal imports (e.g., `getMessageChain`, logger functions).

**Notes from Codex review:**
- `updateSingleTelegramMessage` (line 641) does take a Discord `client` for source-message lookup — this is Telegram-focused but not Discord-free. Pass `client` as a parameter.
- Import paths will need updating (e.g., `../utils/database` → `../../utils/database`). This is mechanical churn, not a design blocker.

**Target:** Extract lines 500-1064 to `handlers/telegram/telegramMessageUpdater.js`
**Result:** `messageEvents.js` drops to ~500 lines of pure Discord event routing.

---

## [SKIP] REFACTOR-3 — `utils/database.js` (1,120 lines): Optional — Extract Maintenance Routines

Two large startup routines (`validateRecentMessageLogs` ~150 lines, `cleanupOrphanedLogs` ~210 lines) plus their shared helpers (~90 lines of multi-client channel resolution) could move to `utils/dbMaintenance.js`.

**Confirmed by Codex:** These depend on module-scoped DB primitives (`run`, `get`, `all`) plus internal helpers (`getMessageLogsPage`, `checkDiscordMessageAcrossClients`, `deleteOldMessageLogs`, startup-maintenance config helpers). Extraction requires re-importing or co-moving those helpers.

**Result:** `database.js` drops to ~670 lines of pure schema + CRUD.

**Verdict:** Optional. The file works as-is and the sections are clearly separated. Do this only if touching maintenance logic.

---

## REFACTOR — Leave As-Is

| File | Lines | Reason |
|------|-------|--------|
| `readerBot.js` | 216 | Trivially small, cohesive single class |
| `web/public/configs.js` | 857 | Single UI component, clear internal structure, no natural split point |
| `handlers/forwardHandler.js` | 742 | Reasonable size, single responsibility |
| `utils/sliceFormatConverter.js` | 609 | Complex but cohesive format conversion logic |
| `handlers/telegram/telegramMessageSender.js` | 564 | Single responsibility, reasonable size |

---

# CONFIG SYSTEM IMPROVEMENTS

## Current Config System — 3 Layers

| Layer | What | Where | Who writes |
|---|---|---|---|
| **Secrets + toggles** | `.env` vars | `config/.env` | User manually |
| **Static defaults** | Hardcoded JS values | `config/config.js` | Developer |
| **Runtime data** | Forward rules, auto-publish, invite cache | `config/*.json` | Bot at runtime |

## The Problem

The `config/` directory mixes two fundamentally different things:
1. **User configuration** (`.env`, `.env.example`, `config.js`) — things you set up once
2. **Runtime state** (`forwardConfigs.json`, `autoPublish.json`, `cachedInvites.json`) — things the bot reads/writes during operation

This causes the CLAUDE.md gotcha: "Do NOT edit JSON config files while bot is running."

---

## [DONE] CONFIG-1 — Move Runtime JSON Data Files to `data/`

The runtime JSON files are bot state, not user config. They belong alongside the SQLite database:

```
data/
  proforwarder.db          # Already here
  forwardConfigs.json      # Move from config/
  autoPublish.json         # Move from config/
  cachedInvites.json       # Move from config/
```

**Why `data/` and not `config/data/`:**
- `data/` already exists and is git-ignored
- Already mounted in Docker via `compose.override.yaml`
- Already where the DB lives
- One mount, one backup target, one "don't touch while running" zone

**Files to update:**
- `utils/configManager.js` (paths on lines 6-8)
- `utils/discordInviteManager.js:3` (imports `CACHED_INVITES_PATH` from configManager — follows the path change but verify)
- `compose.yaml`, `compose.override.yaml` (Docker mount paths)
- `.gitignore` (update ignored paths)
- `CLAUDE.md` (architecture tree lines 81-83)
- `README.md` (lines 207-209 reference config/ paths)
- `AGENTS.md` (line 54 references runtime JSON)

**Risk note (from Codex review):** `configManager.js` does not create the `data/` directory itself — `database.js` does. If `configManager` is imported outside the normal bootstrap path, JSON writes could fail. Add a `mkdirSync` guard or ensure `data/` creation happens before config writes.

---

## [DONE] CONFIG-2 — Promote Hardcoded Defaults to `.env` Vars

These values in `config/config.js` are currently hardcoded with no way to override without editing code. They are deployment-level preferences that operators should control:

| Current hardcoded value | Suggested `.env` var | Default | Why expose |
|---|---|---|---|
| `startupLogMaintenance.enabled: true` | `STARTUP_LOG_MAINTENANCE` | `true` | Operators may want to disable on low-resource hosts |
| `startupLogMaintenance.retentionDays: 180` | `LOG_RETENTION_DAYS` | `180` | Different deployments have different retention needs |
| `startupLogMaintenance.retentionAction: 'skip'` | `LOG_RETENTION_ACTION` | `skip` | Operator choice between skip and delete |
| `telegram.hideSourceHeader: false` | `TELEGRAM_HIDE_SOURCE_HEADER` | `false` | Per-deployment preference |
| `ai.providers.gemini.model` | `GEMINI_MODEL` | `gemini-2.0-flash-exp` | Model changes frequently |
| `ai.translation.defaultProvider` | `AI_TRANSLATION_PROVIDER` | `gemini` | Operator choice |
| `commandUi.allowedRoleIds: []` | `COMMAND_UI_ALLOWED_ROLE_IDS` | `` | Same pattern as `WEB_ADMIN_ALLOWED_ROLE_IDS`; already consumed by `web/lib/config.js:49-50` |
| `commandUi.enabled: true` | `COMMAND_UI_ENABLED` | `true` | Operator toggle if command UI should be disableable *(added from Codex review)* |
| `telegram.smartLinkPreviews: true` | `TELEGRAM_SMART_LINK_PREVIEWS` | `true` | Per-deployment preference, not an API constraint *(added from Codex review)* |

**Note on `AI_TRANSLATION_PROVIDER`:** This sets the default provider, but per-config provider overrides in `utils/aiManager.js:112` still win. The `.env` var controls the fallback, not an absolute override.

**Leave hardcoded (API limits / internal tuning — NOT operator concerns):**
- `captionLengthLimit: 900`, `textLengthLimit: 4000`, `splitIndicator` — Telegram API constraints
- `batchSize`, `maxRuntimeMs`, `delayBetweenBatchesMs` — internal tuning
- `ai.optimization.*` — internal behavior, not deployment config
- `captionSplitStrategy` — internal implementation detail

**Files to update:** `config/config.js`, `config/.env.example`, `CLAUDE.md` (env vars table)

---

## [SKIP] CONFIG-3 — What Stays the Same

These are correct as-is and should NOT change:
- `.env` as the anchor for secrets and operator-facing toggles
- `config/config.js` as the module that reads `.env` and exports a structured object
- SQLite `bot_settings` table for runtime key-value settings managed via web admin (different concern — UI-managed state, not file-based config)
