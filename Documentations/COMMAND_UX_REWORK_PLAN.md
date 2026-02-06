# ProForwarder Web Admin Plan (Simple, Secure, Low Risk)

Date: 2026-02-06
Baseline commit: `0ecb018518ca5fef3cc5498e363206e00ccbef13`

## Current Progress Snapshot
- Latest completed phase: Phase 3 (safe mutations).
- Current state:
  - Bot runtime stable and unchanged for forwarding logic.
  - Web admin remains feature-flagged by `WEB_ADMIN_ENABLED`.
  - OAuth/session/login + read/write config management now implemented in web admin.
  - Localhost test bypass mode available via env flags (for local-only dev access without OAuth).
  - Web admin config loading consolidated to `config.webAdmin` (no direct env fallback in `web/server.js`).
  - Local bypass now supports explicit host allowlist and debug logging to diagnose denied requests.
- Completed implementation commits:
  - `991e4ba` phase 0: add web admin config flags and env placeholders
  - `5f56674` phase 1: add feature-flagged web admin OAuth auth and session shell
  - `11314dc` phase 2: add read-only web dashboard with guild-scoped config view
  - `92293af` fix: include web module in image and guard missing web admin import

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
- Recommended primary auth: Discord OAuth2 Authorization Code flow.
- Reason:
  - Native identity verification.
  - No manual code copy workflow for users.
  - Lower user error and better UX than one-time codes.

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
  - Keep `env.js`/config manager as the same source of truth.
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
- Add feature flags in `env.js`:
  - `webAdmin.enabled`
  - `webAdmin.baseUrl`
  - `webAdmin.sessionTtlHours`
  - `webAdmin.allowedRoleIds`
- Add `webAdmin.trustProxy` flag for reverse proxy deployments.
- Keep all slash commands unchanged.
- Status: done.
- Implementation notes:
  - Added `webAdmin` foundation flags in `config/env.js.example`.
  - Added `WEB_ADMIN_*` placeholders in `config/.env.example`.

### Phase 1: Auth + Session
- Implement OAuth login, callback, logout.
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
  - Moved more web settings into `.env` via `config/.env.example` and `config/env.js.example`:
    - OAuth client ID/secret/redirect URI/scopes
    - Session secret
    - Allowed role IDs (CSV)
    - Debug toggle:
      - `WEB_ADMIN_DEBUG`
    - Local bypass controls:
      - `WEB_ADMIN_LOCAL_BYPASS_AUTH`
      - `WEB_ADMIN_LOCAL_BYPASS_ALLOWED_HOSTS`
      - `WEB_ADMIN_LOCAL_BYPASS_ALLOWED_IPS`
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
- Confirm OAuth as v1 auth method: `yes/no`.
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
