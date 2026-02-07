# ProForwarder Discord Bot

ProForwarder is a web-first Discord forwarding bot with Telegram support, edit/delete sync, retry tooling, and optional reader-bot source access.

This file reflects the current codebase state as of 2026-02-07.

## Current State Summary

- Runtime command surface is intentionally minimal:
  - `/proforwarder` only (portal shortcut to web admin)
- Operational management is done in Web Admin (`/admin`) when enabled
- Forwarding supports:
  - Discord -> Discord
  - Discord -> Telegram
- Message lifecycle sync supports:
  - create forwarding
  - edit propagation
  - delete propagation
- Web admin supports config creation/removal/toggle, logs with retry, auto-publish, guild management, settings, and optional debug diagnostics.

## Requirements

- Node.js `>=22.0.0` (from `package.json`)
- Discord bot token
- Telegram bot token only if Telegram forwarding is enabled
- Optional: reader bot token
- Optional: Docker / Docker Compose

Notes:
- The Docker image currently uses `node:24-alpine`.
- Native run follows the Node engine requirement in `package.json`.

## Quick Start (Native)

```bash
git clone <repository-url>
cd PROFORWARDER-Discord-Bot
npm install
cp config/.env.example config/.env
```

Edit `config/.env` (at minimum set `BOT_TOKEN`; set `WEB_ADMIN_ENABLED=true` if you want web admin), then run:

```bash
npm start
```

Dev mode:

```bash
npm run dev
```

## Slash Commands

Only one slash command is registered:

- `/proforwarder`
  - Returns web admin URL and login guidance
  - Uses runtime `webAdmin` config (`baseUrl`, auth mode) to build links

Legacy `/proforward` and `/debug` command flows are not part of normal runtime anymore.

## Web Admin

Web admin is served by the bot process from `web/server.js` when `WEB_ADMIN_ENABLED=true`.

Base route:
- `/admin`

### Tabs and Capabilities

- Dashboard
  - bot status
  - message stats
  - reader diagnostics
- Configs
  - guild selector
  - forward configurations table
  - forward builder with subtabs:
    - Discord forward
    - Telegram forward
- Auto Publish
  - announcement channel management
- Guilds
  - bot invite actions
  - guild leave actions
- Logs
  - filtering, paging, failed-log cleanup
  - retry by source message ID
- Settings
  - existing key update/delete
  - uploaded emoji tracked-name management
- Debug (only when `WEB_ADMIN_DEBUG=true`)
  - curated DB diagnostics
  - message drilldown search

### Auth Modes

`WEB_ADMIN_AUTH_MODE=local`
- localhost-only bypass model
- no Discord OAuth login

`WEB_ADMIN_AUTH_MODE=oauth`
- Discord OAuth login required
- requires configured redirect URI and session secret

### Strict Security Mode (optional)

Enable:

```env
WEB_ADMIN_SECURITY_STRICT=true
```

When enabled, web admin adds:
- CSRF checks for mutating `/api` requests
- rate limiting (auth-sensitive and mutating routes)
- mutation audit logging

## Forwarding Behavior

### Discord -> Discord

- Uses webhooks when possible for better source fidelity
- Falls back to normal bot send if webhook permissions are missing
- Supports same-server and cross-server targets

### Discord -> Telegram

- Uses Telegram Bot API adapter (`handlers/telegramHandler.js`)
- Handles Markdown conversion and safe fallbacks
- Handles long text/caption splitting with chain tracking
- Supports media+caption flows and smart edit/delete behavior

### Edit/Delete Sync

From `events/messageEvents.js` + forward handlers:
- edits propagate to forwarded targets
- deletes propagate to forwarded targets
- Telegram split-chain edits/deletes are handled with chain-aware logic

### Retry Queue

Failed forwards are queued and retried with backoff.

- periodic retry worker runs every 5 minutes
- retry entries are bounded and stale-cleaned

## Reader Bot (Optional)

Reader bot is a secondary Discord client (`readerBot.js`) used for source-read access patterns.

- runs only when enabled and token provided
- logs in with read-focused intents
- forwards source events into main forwarding pipeline
- reported in dashboard diagnostics and guild lists

Config:

```env
READER_BOT_ENABLED=false
READER_BOT_TOKEN=
```

## AI Features

AI config exists and is wired through forward/translation handlers.

Configured provider model in `config/config.js`:
- primary: `gemini`
- fallback: `google`

Keys:

```env
GEMINI_API_KEY=
GOOGLE_TRANSLATE_API_KEY=
GOOGLE_PROJECT_ID=
```

## Configuration

### Primary Files

- `config/.env`
  - secrets + env toggles
- `config/config.js`
  - tracked runtime config object

### Runtime JSON Data

Managed by `utils/configManager.js`:

- `config/forwardConfigs.json`
- `config/autoPublish.json`
- `config/cachedInvites.json`

Persistence DB:
- `data/proforwarder.db`

Do not manually edit active runtime JSON while the bot is running.

## Important Environment Variables

### Core

```env
BOT_TOKEN=
DEBUG_MODE=false
FORWARD_BOT_MESSAGES=true
USE_SLICE_FORMAT_CONVERTER=true
USE_AI_FORMAT_CONVERTER=false
```

### Telegram

```env
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_API_URL=https://api.telegram.org
```

### Web Admin Common

```env
WEB_ADMIN_ENABLED=false
WEB_ADMIN_PORT=3001
WEB_ADMIN_AUTH_MODE=local
WEB_ADMIN_SESSION_SECRET=
WEB_ADMIN_SESSION_TTL_HOURS=24
WEB_ADMIN_DEBUG=false
```

Set `WEB_ADMIN_ENABLED=true` to actually start the web admin server.

### Web Admin Local Mode

```env
WEB_ADMIN_LOCAL_ALLOWED_HOSTS=localhost,127.0.0.1,::1
WEB_ADMIN_LOCAL_ALLOWED_IPS=
```

### Web Admin OAuth Mode

```env
WEB_ADMIN_BASE_URL=
WEB_ADMIN_TRUST_PROXY=false
WEB_ADMIN_DISCORD_CLIENT_ID=
WEB_ADMIN_DISCORD_CLIENT_SECRET=
WEB_ADMIN_DISCORD_REDIRECT_URI=
WEB_ADMIN_DISCORD_SCOPES=identify guilds
WEB_ADMIN_ALLOWED_ROLE_IDS=
```

### Web Admin Strict Mode (Optional)

```env
WEB_ADMIN_SECURITY_STRICT=false
WEB_ADMIN_AUTH_RATE_LIMIT_WINDOW_MS=300000
WEB_ADMIN_AUTH_RATE_LIMIT_MAX=60
WEB_ADMIN_MUTATION_RATE_LIMIT_WINDOW_MS=60000
WEB_ADMIN_MUTATION_RATE_LIMIT_MAX=180
```

### Bot Invite Callback

```env
BOT_INVITE_REDIRECT_URI=http://localhost/admin/bot-invite/callback
```

## Docker

`compose.yaml` has:
- `init-config` helper service
- `proforwarder-bot` runtime service

Start:

```bash
docker compose up -d
```

Default compose behavior:
- no web admin host port is exposed by default in `compose.yaml`
- persistent host paths are currently set to `/srv/docker-data/proforwarder/...`

Local override file (`compose.override.yaml`) maps:
- local `./data` and `./config`
- web admin port `127.0.0.1:80:3001`

With that override, open:
- `http://localhost/admin`

## Project Layout

```text
ProForwarder-Discord-Bot/
|- commands/
|  `- proforwarderCommand.js
|- config/
|- data/
|- events/
|- handlers/
|- utils/
|- web/
|- index.js
|- readerBot.js
|- compose.yaml
|- compose.override.yaml
`- Dockerfile
```

## Additional Documentation

Detailed project docs are in `Documentations/`, including:

- `Documentations/COMMAND_WEB_COVERAGE_DEPRECATION.md`
- `Documentations/COMMAND_UX_REWORK_PLAN.md`
- `Documentations/READER_BOT_IMPLEMENTATION.md`
- `Documentations/TELEGRAM_CAPTION_LENGTH_SOLUTION.md`
- `Documentations/TELEGRAM_HANDLER_REFACTORING_PLAN.md`
- `Documentations/WEBADMIN_SETUP_AUTOPUBLISH_PHASE_PLAN.md`
- `Documentations/WEBADMIN_LOGS_TELEGRAM_HARDENING_PLAN.md`

Tracking file:
- `Documentations/PROJECT_REMAINING_IMPROVEMENTS.md`

## License

MIT. See `LICENSE`.
