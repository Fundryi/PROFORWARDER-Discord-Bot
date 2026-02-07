<div align="center">

![Node.js](https://img.shields.io/badge/Node.js_22%2B-339933?style=flat&logo=node.js&logoColor=white)
![Discord.js](https://img.shields.io/badge/Discord.js_14-5865F2?style=flat&logo=discord&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-24%2B-2496ED?style=flat&logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat)

# ProForwarder Discord Bot

Web-first Discord forwarding with Telegram support, edit/delete sync, retry tooling, and optional reader-bot source access.

[Docker Quick Start](#docker-quick-start-recommended) | [Native Run](#native-run-optional) | [Web Admin](#web-admin) | [Configuration](#configuration) | [Documentation](#documentation)

</div>

Validated against current codebase on 2026-02-07.

## At a Glance

| Area | Current State |
| --- | --- |
| Slash commands | `/proforwarder` only |
| Forwarding | Discord -> Discord, Discord -> Telegram |
| Lifecycle sync | Create, edit, delete propagation |
| Admin workflow | Web Admin at `/admin` |
| Storage | SQLite (`data/proforwarder.db`) + JSON config files |
| Recommended runtime | Docker Compose |

## Requirements

- Docker Engine + Docker Compose (recommended path)
- Node.js `>=22.0.0` only if you run natively (non-Docker)

## Do You Need `npm install`?

| If you run with... | Need `npm install`? | Why |
| --- | --- | --- |
| Docker Compose only | No | Image builds dependencies with `npm ci` in `Dockerfile` |
| Native Node.js (local process) | Yes | You run `node index.js` directly on host |

So your concern is correct: for Docker-only usage, you can skip `npm install`.

## Docker Quick Start (Recommended)

1. Clone repo and enter it.
2. Start services:

```bash
docker compose up -d
```

3. Edit `.env` and set at least:
   - with default repo override: `./config/.env`
   - with base compose only: `/srv/docker-data/proforwarder/config/.env`

```env
BOT_TOKEN=your_discord_bot_token
WEB_ADMIN_ENABLED=true
WEB_ADMIN_AUTH_MODE=local
```

4. Restart after changes:

```bash
docker compose restart
```

### Important Compose Behavior

By default, Docker Compose loads both files in this repo:
- `compose.yaml`
- `compose.override.yaml`

That means local development behavior is active unless you override it:
- data/config mounted from local `./data` and `./config`
- Web Admin exposed at `127.0.0.1:80 -> container:3001`
- Admin URL: `http://localhost/admin`

If you want base `compose.yaml` only:

```bash
docker compose -f compose.yaml up -d
```

Base file behavior:
- no host port is published for Web Admin
- persistent paths are `/srv/docker-data/proforwarder/data` and `/srv/docker-data/proforwarder/config`

## Native Run (Optional)

Use this only if you are not running Docker.

```bash
git clone <repository-url>
cd PROFORWARDER-Discord-Bot
npm install
cp config/.env.example config/.env
```

Then set env values and run:

```bash
npm start
```

Dev mode:

```bash
npm run dev
```

## Commands

Only one slash command is registered in runtime:
- `/proforwarder` (returns Web Admin URL/login guidance)

Legacy `/proforward` and `/debug` workflows are retired from normal runtime and replaced by Web Admin features.

## Web Admin

Web Admin is served from `web/server.js` when `WEB_ADMIN_ENABLED=true`.

Base route:
- `/admin`

### Tabs

| Tab | Purpose |
| --- | --- |
| Dashboard | Bot status, message stats, reader diagnostics |
| Configs | Guild selector, forward list, Discord/Telegram forward builder |
| Auto Publish | Announcement channel auto-publish management |
| Guilds | Main/reader bot guild management and invite actions |
| Logs | Filters, pagination, failed-log cleanup, retry by source message ID |
| Settings | Existing key update/delete, uploaded emoji name management |
| Debug | DB diagnostics + message drilldown (only when `WEB_ADMIN_DEBUG=true`) |

### Auth Modes

`WEB_ADMIN_AUTH_MODE=local`
- localhost-only bypass model
- no Discord OAuth login

`WEB_ADMIN_AUTH_MODE=oauth`
- Discord OAuth login required
- requires `WEB_ADMIN_SESSION_SECRET`, client ID/secret, and redirect URI

### Strict Security Mode

Enable:

```env
WEB_ADMIN_SECURITY_STRICT=true
```

Adds:
- CSRF checks for mutating `/api` routes
- rate limiting on auth-sensitive and mutating routes
- mutation audit logging

## Forwarding Behavior

### Discord -> Discord

- Webhook-first forwarding when permissions allow
- bot-send fallback when webhook permissions are missing
- same-server and cross-server targets supported

### Discord -> Telegram

- Telegram Bot API adapter in `handlers/telegramHandler.js`
- Markdown conversion with safe fallback behavior
- long caption/text splitting with chain tracking
- smart edit/delete behavior for split chains and media cases

### Retry Queue

- failed forwards are queued in-memory
- retry worker runs every 5 minutes
- stale/bounded retry entries are cleaned up automatically

## Reader Bot (Optional)

Secondary Discord client (`readerBot.js`) for source-read access patterns.

```env
READER_BOT_ENABLED=false
READER_BOT_TOKEN=
```

## Configuration

Primary files:
- `config/.env` (secrets and env toggles)
- `config/config.js` (runtime config module)

Runtime-managed JSON:
- `config/forwardConfigs.json`
- `config/autoPublish.json`
- `config/cachedInvites.json`

Persistent DB:
- `data/proforwarder.db`

Do not manually edit runtime JSON files while the bot is running.

### Core Environment Variables

```env
BOT_TOKEN=
DEBUG_MODE=false
FORWARD_BOT_MESSAGES=true
USE_SLICE_FORMAT_CONVERTER=true
USE_AI_FORMAT_CONVERTER=false

TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_API_URL=https://api.telegram.org

WEB_ADMIN_ENABLED=false
WEB_ADMIN_PORT=3001
WEB_ADMIN_AUTH_MODE=local
WEB_ADMIN_SESSION_SECRET=
WEB_ADMIN_SESSION_TTL_HOURS=24
WEB_ADMIN_DEBUG=false

WEB_ADMIN_LOCAL_ALLOWED_HOSTS=localhost,127.0.0.1,::1
WEB_ADMIN_LOCAL_ALLOWED_IPS=

WEB_ADMIN_BASE_URL=
WEB_ADMIN_TRUST_PROXY=false
WEB_ADMIN_DISCORD_CLIENT_ID=
WEB_ADMIN_DISCORD_CLIENT_SECRET=
WEB_ADMIN_DISCORD_REDIRECT_URI=
WEB_ADMIN_DISCORD_SCOPES=identify guilds
WEB_ADMIN_ALLOWED_ROLE_IDS=

WEB_ADMIN_SECURITY_STRICT=false
WEB_ADMIN_AUTH_RATE_LIMIT_WINDOW_MS=300000
WEB_ADMIN_AUTH_RATE_LIMIT_MAX=60
WEB_ADMIN_MUTATION_RATE_LIMIT_WINDOW_MS=60000
WEB_ADMIN_MUTATION_RATE_LIMIT_MAX=180

BOT_INVITE_REDIRECT_URI=http://localhost/admin/bot-invite/callback
```

AI keys:

```env
GEMINI_API_KEY=
GOOGLE_TRANSLATE_API_KEY=
GOOGLE_PROJECT_ID=
```

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

## Documentation

Additional docs in `Documentations/`:

- `Documentations/PROJECT_REMAINING_IMPROVEMENTS.md`
- `Documentations/UI_UX_IMPROVEMENTS_VALIDATED.md`
- `Documentations/COMMAND_WEB_COVERAGE_DEPRECATION.md`
- `Documentations/COMMAND_UX_REWORK_PLAN.md`
- `Documentations/READER_BOT_IMPLEMENTATION.md`
- `Documentations/TELEGRAM_CAPTION_LENGTH_SOLUTION.md`
- `Documentations/TELEGRAM_HANDLER_REFACTORING_PLAN.md`
- `Documentations/WEBADMIN_SETUP_AUTOPUBLISH_PHASE_PLAN.md`
- `Documentations/WEBADMIN_LOGS_TELEGRAM_HARDENING_PLAN.md`

## License

MIT. See `LICENSE`.
