# Startup Log Maintenance Plan

Date: 2026-02-05

## Goals
1. Bot should become responsive immediately at startup.
2. Validate logs from newest to oldest.
3. Use batching + background execution to keep startup fast.
4. Remove database entries only when the **source** message is missing.
5. Add a time-based retention limit (6 months) so very old logs are no longer tracked.

## Current Behavior (Summary)
1. Startup awaits validation and cleanup in `index.js` (blocking further init).
2. Validation uses `getMessageLogs(limit)` ordered by `forwardedAt DESC` (newest first). These are rows in `message_logs` (the “entries”).
3. Cleanup removes logs when the **original** message is missing (and may delete the forwarded message). It does **not** remove entries when the forwarded message is missing but the original still exists.
4. Validation logs results only; it does not delete anything.

## Proposed Changes
1. Move startup validation/cleanup to background tasks so the bot is ready immediately.
2. Keep newest-to-oldest order, but process in **batches** with pagination.
3. Cleanup rules:
   - **Delete log entries only if the source message is missing.**
   - If the forwarded message is missing but the source still exists, keep the log entry.
4. Add a **retention window**: only track logs newer than 6 months.
   - **Retention action is configurable:** either **skip** old entries (ignore) or **delete** them from the DB.
5. Keep Telegram handling safe: avoid mass delete API calls, and guard errors to prevent shutdown.
6. Add configuration knobs for batch size, delays, runtime cap, and retention.

## Implementation Steps
1. Update `index.js` to start validation/cleanup **without awaiting** (e.g., `setImmediate` or `setTimeout` after ready).
2. Add a helper in `utils/database.js` to iterate `message_logs` in pages (e.g., 200 at a time), ordered by `forwardedAt DESC`.
3. Apply a **retention cutoff** (6 months) when iterating:
   - **Action is configurable:** `skip` (ignore) or `delete` old entries.
4. Refactor `validateRecentMessageLogs` to use the paged iterator and only log per-entry results when `debugMode` is enabled.
5. Refactor `cleanupOrphanedLogs` to:
   - **Delete entries only when the source message is missing.**
   - Optionally delete the forwarded message as best‑effort when the source is missing.
   - Do **not** delete entries when only the forwarded message is missing.
6. Add a short delay between batches to avoid rate limits.
7. Add a config block in `config/env.js` (optional):
   - `startupLogMaintenance.enabled`
   - `startupLogMaintenance.batchSize`
   - `startupLogMaintenance.maxRuntimeMs`
   - `startupLogMaintenance.delayBetweenBatchesMs`
   - `startupLogMaintenance.retentionDays` (default: 180)
   - `startupLogMaintenance.retentionAction` (`skip` | `delete`, default: `skip`)

## Implementation Status (Completed)
- Added `startupLogMaintenance` config block in `config/env.js` and `config/env.js.example`.
- `index.js` now runs validation/cleanup in a background task (non-blocking).
- `utils/database.js` now:
  - Iterates logs in pages (newest → oldest).
  - Enforces retention cutoff with configurable `retentionAction`.
  - Deletes entries only if **source is missing** (forwarded missing is ignored).
  - Reduces per-entry validation logs unless `debugMode` is enabled.

## Remaining Work
- Manual testing (see Phase 4 below).

## Additional Ideas
1. Schedule a periodic cleanup (e.g., once every 12 hours) to keep logs consistent over time.
2. Add a `/debug cleanup-logs` command for manual maintenance on demand.

## Risks / Notes
1. Removing limits means more API calls; batching and delays are necessary.
2. Telegram message existence is harder to verify reliably; deletions should be best‑effort and error‑tolerant.
3. If the bot runs in multiple instances, cleanup could be duplicated; consider a simple lock if needed.
