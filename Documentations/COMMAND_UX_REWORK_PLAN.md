# ProForwarder Web Admin Plan (Simple, Secure, Low Risk)

Date: 2026-02-06
Baseline commit: `0ecb018518ca5fef3cc5498e363206e00ccbef13`

## Current Progress Snapshot
- Latest completed phase: Phase 3.5 (tabbed dashboard + guild management).
- Current state:
  - Bot runtime stable and unchanged for forwarding logic.
  - Web admin remains feature-flagged by `WEB_ADMIN_ENABLED`.
  - Read/write config management is implemented in web admin.
  - Auth is local-first via `WEB_ADMIN_AUTH_MODE=local` with localhost checks and automatic local session creation.
  - OAuth stays available behind `WEB_ADMIN_AUTH_MODE=oauth` for later domain rollout.
  - Web admin config loading consolidated to `config.webAdmin` (no direct env fallback in `web/server.js`).
  - Local auth supports explicit host allowlist and optional IP allowlist with debug logging.
  - Tabbed SPA dashboard with 6 tabs: Dashboard, Configs, Guilds, Logs, Settings.
  - Root URL `/` redirects to `/admin` (no more "Cannot GET /").
  - Guild management: view all bot guilds, leave unwanted guilds from web UI.
  - Message logs viewer with pagination, config/status filters.
  - Bot settings editor (DB-stored key-value pairs) and read-only runtime config display.
  - Frontend is vanilla HTML/CSS/JS served as static files from `web/public/`.
- Completed implementation commits:
  - `991e4ba` phase 0: add web admin config flags and env placeholders
  - `5f56674` phase 1: add feature-flagged web admin OAuth auth and session shell
  - `11314dc` phase 2: add read-only web dashboard with guild-scoped config view
  - `92293af` fix: include web module in image and guard missing web admin import

## Continuation Audit Notes (2026-02-07)
- `MEDIUM (resolved in this session)`: Telegram chat access verification is enforced server-side in `POST /api/configs` (no frontend-only bypass path).
- `MEDIUM (resolved in this session)`: Telegram target entry supports numeric chat IDs, `@username`, and `t.me` links in web create flow.
- `LOW`: Tracking metadata labels (`discoveredVia`) need clearer semantics for auto-verified create flow.
- `LOW`: Plan snapshot and implementation notes need periodic refresh as post-Phase-3.5 Telegram UX improvements landed.

## Objective
- Replace complex in-Discord management UX with a simple web admin interface.
- Keep bot behavior and forwarding engine unchanged.
- Keep current slash commands working during rollout.
- Prioritize reliability and permission safety over UI polish.

## Scope
- In scope:
  - Web login and authorization.
  - Read/write config management from browser.
  - Audit trail for config changes.
  - Minimal, clean pages with CSS-only theming.
- Out of scope:
  - Major redesign of forwarding internals.
  - Realtime dashboards or analytics.
  - Complex frontend framework migration.

## Authentication Decision
- Current primary mode: local-only auth (`WEB_ADMIN_AUTH_MODE=local`) for development and initial rollout.
- OAuth mode (`WEB_ADMIN_AUTH_MODE=oauth`) remains implemented and can be enabled later for domain-based deployments.

## Authorization Model
- Access is granted only if the logged-in Discord user matches at least one rule:
  - Guild administrator in target guild.
  - Holds a role listed in `commandUi.allowedRoleIds`.
- Authorization must be checked server-side on every sensitive API call.
- Source of truth for roles/membership: bot client (`guild.members.fetch(userId)`), not client-side data.

## Session Model
- Session cookie:
  - `HttpOnly`, `Secure`, `SameSite=Lax`.
  - Signed random session ID.
- Session TTL:
  - Valid for 24 hours (absolute expiration).
  - Optional inactivity timeout can be added later if needed.
- Logout:
  - Manual `/logout` endpoint.
  - Session deleted server-side immediately.

## Alternative Auth (Fallback)
- Optional fallback if OAuth is unavailable: `/proforward login` one-time code.
- Rules for fallback:
  - One-time code TTL: 60 seconds.
  - Single use only.
  - Session TTL remains 24 hours.
- Recommendation:
  - Do not build fallback in v1 unless OAuth setup is blocked.
  - Keep this as Phase 6 optional hardening path.

## Security Controls (Mandatory)
- CSRF protection for all state-changing routes.
- Rate limiting on login and config mutation endpoints.
- Strict input validation for IDs and config payloads.
- Server-side permission checks for every create/update/delete action.
- Audit log entry for each mutation:
  - user ID, guild ID, action, config ID, timestamp, before/after summary.

## Technical Architecture (Simple)
- Backend:
  - Extend existing Node process with an Express server.
  - Reuse existing config manager functions for writes.
  - Keep `config.js`/config manager as the same source of truth.
- Frontend:
  - Server-rendered HTML templates or minimal static HTML + fetch API.
  - No SPA framework required.
  - Theme controlled by single CSS file: `web/public/styles.css`.
- File layout (proposed):
  - `web/server.js` (routes, auth, session, csrf).
  - `web/middleware/auth.js` (permission checks).
  - `web/routes/*.js` (auth, configs, health).
  - `web/views/*.html` or template files.
  - `web/public/styles.css` (all visual styling).

## Reverse Proxy Decision
- Decision: use `Caddy` as reverse proxy for web admin.
- Reason:
  - Simplest config and maintenance for current stack size.
  - Automatic HTTPS certificate provisioning/renewal.
  - Lower operational complexity than Traefik for this use case.
- Non-goal for v1:
  - Do not add advanced dynamic routing features.
  - Do not split bot and web into separate apps yet.

## Deployment Model (v1)
- Keep bot + web admin in one Node container/process.
- Put `Caddy` in front for TLS and domain routing.
- Keep Docker compose simple:
  - `proforwarder-bot`
  - `caddy`

## End-User Workflow (Target)
1. Admin opens `https://<bot-host>/admin`.
2. Clicks `Login with Discord`.
3. Returns authenticated to dashboard.
4. Selects guild/server to manage.
5. Views config list with status.
6. Creates or edits forwarding rules in guided forms.
7. Saves changes; receives success/failure with validation messages.
8. Optionally tests Telegram target from UI.
9. Logs out or session expires after 24h.

## V1 Feature Set (Minimal and Useful)
- Read-only:
  - List configs for selected guild.
  - View target details and enabled status.
- Write:
  - Create Discord forward.
  - Create Telegram forward.
  - Enable/disable config.
  - Remove config with confirmation.
  - Trigger Telegram test.
- Utility:
  - Show last change metadata.
  - Basic health/status panel.

## API Contract (Internal)
- `GET /api/me` -> authenticated user + allowed guilds.
- `GET /api/configs?guildId=...` -> configs for guild.
- `POST /api/configs` -> create config.
- `PATCH /api/configs/:id` -> enable/disable or update supported fields.
- `DELETE /api/configs/:id` -> remove config.
- `POST /api/configs/:id/test-telegram` -> connectivity test.

## Validation Rules (Server-Side)
- Discord IDs must be numeric strings.
- Source and target Discord channels cannot be identical.
- Target types:
  - `discord`: requires target guild/channel and bot permissions.
  - `telegram`: requires valid numeric chat ID.
- Reject writes when user loses required role/admin rights mid-session.

## Rollout Plan
### Phase 0: Foundations
- Add feature flags in `config.js`:
  - `webAdmin.enabled`
  - `webAdmin.baseUrl`
  - `webAdmin.sessionTtlHours`
  - `webAdmin.allowedRoleIds`
- Add `webAdmin.trustProxy` flag for reverse proxy deployments.
- Keep all slash commands unchanged.
- Status: done.
- Implementation notes:
  - Added `webAdmin` foundation flags in `config/config.js.example`.
  - Added `WEB_ADMIN_*` placeholders in `config/.env.example`.

### Phase 1: Auth + Session
- Implement local-first auth and keep OAuth login/callback/logout available for later use.
- Implement session store and permission middleware.
- Build `GET /admin` shell page.
- Add `Caddy` service and minimal `Caddyfile` with HTTPS + reverse proxy to bot web port.
- Status: done (app-side implementation complete; Caddy compose wiring deferred to proxy phase).
- Implementation notes:
  - Added `web/server.js` with:
    - Discord OAuth routes: `/admin/login`, `/admin/callback`, `/admin/logout`
    - Session handling via `express-session`
    - Feature-flagged startup config parsing from `.env`
    - `GET /admin` authenticated shell page
  - Added `web/public/styles.css` for centralized theme styling.
  - Integrated startup/shutdown in `index.js` via `startWebAdminServer` and `stopWebAdminServer`.
  - Added dependencies in `package.json`: `express`, `express-session`.
  - Moved more web settings into `.env` via `config/.env.example` and `config/config.js.example`:
    - Auth mode switch:
      - `WEB_ADMIN_AUTH_MODE=local|oauth`
    - Allowed role IDs (CSV)
    - Debug toggle:
      - `WEB_ADMIN_DEBUG`
    - Local auth controls:
      - `WEB_ADMIN_LOCAL_ALLOWED_HOSTS`
      - `WEB_ADMIN_LOCAL_ALLOWED_IPS` (optional)
    - OAuth client ID/secret/redirect URI/scopes (only for OAuth mode)
    - Session secret (required only for OAuth mode)
  - Refactored web config parsing into `web/lib/config.js` and local bypass checks into `web/lib/localBypass.js` to reduce risk in `web/server.js` and keep behavior testable.

### Phase 2: Read-Only Dashboard
- Guild selector and config list.
- No write actions yet.
- Verify permission filtering across multiple guilds.
- Status: done.
- Implementation notes:
  - Extended `web/server.js` with:
    - `GET /api/me` to return authenticated user + manageable guild list
    - `GET /api/configs?guildId=...` for read-only configuration listing
    - Server-side guild access checks:
      - OAuth admin permission bit support
      - Bot-side admin/allowed-role checks (role IDs from `webAdmin.allowedRoleIds`, fallback to `commandUi.allowedRoleIds`)
  - Updated `/admin` to render read-only dashboard with guild selector and config table.
  - Updated `web/public/styles.css` for form/table display while keeping styling centralized in CSS.

### Phase 3: Safe Mutations
- Add enable/disable, remove with confirmation.
- Add create forms for Discord and Telegram forwards.
- All mutations routed through existing config manager functions.
- Status: done.
- Implementation notes:
  - Added mutation APIs in `web/server.js`:
    - `POST /api/configs` (create)
    - `PATCH /api/configs/:id` (enable/disable)
    - `DELETE /api/configs/:id` (remove)
    - `POST /api/configs/:id/test-telegram` (telegram test)
  - Added mutation UI in `/admin` dashboard:
    - Create Discord forward form
    - Create Telegram forward form
    - Per-row actions: enable/disable, remove, telegram test
  - Kept server-side guild authorization checks on every mutation route.
  - Updated `utils/configManager.js`:
    - Added `enableForwardConfig` export and shared `setForwardConfigEnabled` path.
    - Replaced fragile toggle logic with object-range based updates inside `forwardConfigs`.

### Phase 3.5: Tabbed Dashboard, Logs, Settings, and Guild Management
- Refactored monolithic inline-JS dashboard into tabbed SPA with external JS files.
- Root URL `/` now redirects to `/admin`.
- Status: done.
- Implementation notes:
  - Replaced `renderDashboardPage()` inline HTML+JS (330 lines) with a clean HTML shell loading external scripts.
  - Removed deprecated `renderAuthenticatedShell()` and `/admin/shell` route.
  - Added 6 tabs: Dashboard, Configs, Guilds, Logs, Settings.
  - New frontend files in `web/public/`:
    - `app.js` - shared utilities (fetchJson, tab switching, guild selector, shared state via `AdminApp`)
    - `dashboard.js` - bot status overview with stat cards, 30s auto-refresh
    - `configs.js` - extracted config CRUD from old inline script
    - `guilds.js` - list all bot guilds, leave unwanted guilds
    - `logs.js` - paginated message log viewer with config/status filters
    - `settings.js` - editable bot_settings (DB) + read-only runtime config (config.js)
  - New API endpoints in `web/server.js`:
    - `GET /api/dashboard` - bot status, uptime, guild count, config stats
    - `GET /api/guilds` - list all guilds bot is in
    - `POST /api/guilds/:id/leave` - make bot leave a guild
    - `GET /api/logs` - paginated message logs with filters
    - `GET /api/logs/stats` - aggregate log counts (total, failed, today)
    - `GET /api/settings` - bot settings + runtime config
    - `PUT /api/settings/:key` - upsert bot setting
    - `DELETE /api/settings/:key` - remove bot setting
  - Added `getMessageLogsFiltered()` to `utils/database.js` for flexible log querying.
  - Extended `web/public/styles.css` with tab nav, stat cards, status badges, filter bar, settings form styles.

### Phase 4: Operational Hardening
- Add CSRF, rate limits, audit logs.
- Add robust validation and error mapping.
- Add smoke tests for auth and config routes.

### Phase 5: Parallel Run and Cutover
- Run web UI and slash-command management in parallel.
- Keep `/debug` unchanged.
- After stable burn-in window, deprecate old management commands (optional).

### Phase 6: Optional One-Time Code Login
- Implement only if OAuth cannot be used in deployment environment.

## Testing Plan
- Unit:
  - Auth middleware.
  - Permission checks.
  - Config validation.
- Integration:
  - Login -> dashboard -> create/update/remove cycle.
  - Role removal while session is active.
  - Unauthorized access attempts.
- Manual:
  - Multi-guild user with mixed permissions.
  - Telegram config create + test path.
  - Session expiry and logout behavior.

## Open Decisions to Confirm
- Confirm OAuth activation timing (keep local-only for now vs enable in next phase).
- Confirm allowed-role model:
  - global roles only from config
  - or per-guild role mapping.
- Confirm session policy:
  - absolute 24h only
  - or 24h absolute + inactivity timeout.

## Success Criteria
- Admin can complete create/edit/remove flows without slash command syntax.
- Non-admin/non-role users cannot mutate settings.
- Existing forwarding behavior is unchanged.
- Theming changes require edits in `web/public/styles.css` only.
