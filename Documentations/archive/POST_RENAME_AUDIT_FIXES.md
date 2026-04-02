# Post-Rename Audit Status (Current)

Date: 2026-02-06  
Scope: rename fallout (`env.js` -> `config.js`), web admin auth/local mode, config parity

---

## Verification Summary

- [x] Runtime uses `config/config.js` (no `config/env` imports remain).
- [x] Startup pre-check enforces both `config/config.js` and `config/.env` in `index.js`.
- [x] `config/config.js` and `config/.env.example` env-key parity validated.
- [x] `config/config.js` and local `config/.env` env-key parity validated.
- [x] Web admin local bypass reads only current keys:
  - `WEB_ADMIN_LOCAL_ALLOWED_HOSTS`
  - `WEB_ADMIN_LOCAL_ALLOWED_IPS`

---

## Fixed Issues

### 1) Rename migration to `config.js`
- Status: `FIXED`
- Result:
  - Runtime imports point to `config/config.js`.
  - No active `config/env` reference remains.

### 2) Missing Google project id in runtime shape
- Status: `FIXED`
- Result:
  - `ai.providers.google.projectId` exists in `config/config.js`.

### 3) Missing `TELEGRAM_API_URL` in environment examples
- Status: `FIXED`
- Result:
  - `config/.env.example` includes `TELEGRAM_API_URL`.
  - Runtime reads it via `config/config.js`.

### 4) Guild owner display fallback
- Status: `FIXED`
- Result:
  - `web/server.js` returns both `owner` and `ownerId`.
  - `web/public/guilds.js` renders owner name or owner ID fallback.

### 5) Legacy local bypass compatibility keys
- Status: `FIXED`
- Result:
  - `WEB_ADMIN_LOCAL_BYPASS_*` compatibility reads were removed.
  - Only current local allowlist keys are active.

### 6) Config template duplication (`config.js.example`)
- Status: `FIXED`
- Result:
  - `config/config.js.example` removed.
  - `README.md` no longer tells users to copy it.
  - `compose.yaml` init step now copies tracked `config/config.js`.
  - `.gitignore` no longer excludes `config/config.js`.

---

## Open Items

- `config/config.js` is now intentionally unignored and should be committed as tracked config.
- Tokens in `config/.env` must remain private and rotated if previously exposed.

---

## Current Conclusion

All audit items listed in this document are implemented and verified against current code.
