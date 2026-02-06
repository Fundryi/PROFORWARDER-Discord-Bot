# Web Admin + Logs + Telegram Hardening Plan

Date: 2026-02-06  
Scope: requested UI/logging fixes after web admin refresh

---

## Goals

1. Make status colors consistent (`true` green, `false` red).
2. Fix Message Logs status badge sizing for labels like `success`.
3. Add safe cleanup controls for failed log entries from the web admin.
4. Reduce recurring Telegram forward failures by adding resilient fallbacks.
5. Prevent `messageChain` schema mismatch failures from occurring again.
6. Close/move `POST_RENAME_AUDIT_FIXES.md` into `Documentations/`.

---

## Phase 0 - Baseline + Audit Closure

Deliverables:
- Confirm `POST_RENAME_AUDIT_FIXES.md` checks still match current code.
- Move `POST_RENAME_AUDIT_FIXES.md` into `Documentations/` as an archived audit record.

Commit boundary:
- Commit only documentation/file-move changes.

---

## Phase 1 - Quick UI Fixes (No API changes)

Deliverables:
- Runtime config `false` values rendered red (while `true` stays green).
- Logs status badges get fixed width/spacing so `success` fully fits.

Commit boundary:
- Commit only CSS/JS UI changes for visual corrections.

---

## Phase 2 - Failed Log Cleanup Controls

Deliverables:
- Add backend endpoint to delete failed log rows with filters.
- Add Logs tab UI actions:
  - delete failed logs for current filter scope,
  - optional delete all failed logs.
- Add clear confirmations and post-action refresh.

Safety constraints:
- Default behavior is scoped deletion.
- Explicit confirmation text required before destructive actions.

Commit boundary:
- Commit API + DB helper + UI action wiring together as one functional slice.

---

## Phase 3 - Failure Prevention Hardening

Deliverables:
- Database self-heal: verify/add `message_logs` chain columns at runtime before chain inserts.
- Telegram send fallback for parse/entity failures:
  - retry with stricter escaping and safer preview behavior before final fail.
- Telegram send fallback for media preview errors (`WEBPAGE_MEDIA_EMPTY`, `WEBPAGE_CURL_FAILED`):
  - auto-fallback to text-only/split strategy where possible.

Commit boundary:
- Commit DB hardening first.
- Commit Telegram hardening second (separate commit).

---

## Phase 4 - Verification + Notes

Deliverables:
- Syntax checks for changed JS files.
- Short operator notes in docs for new cleanup behavior and fallback handling.

Commit boundary:
- Commit only docs/notes if needed after code verification.

---

## Planned Commit Order

1. `docs: add phased hardening plan for web admin/logs/telegram`
2. `docs: archive post-rename audit under Documentations`
3. `fix(web-admin): align runtime false color and status badge sizing`
4. `feat(web-admin): add failed log cleanup controls`
5. `fix(db): self-heal message_logs chain columns before chain inserts`
6. `fix(telegram): add resilient send fallbacks for parse/preview failures`
7. `docs: update admin/log handling notes`
