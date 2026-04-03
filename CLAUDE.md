# ProForwarder Discord Bot

Shared session hub for both Claude and Codex.

## Project Identity

- Repository: `Fundryi/PROFORWARDER-Discord-Bot` (public)
- Host environment: Windows local development with Docker
- Node.js compatibility baseline: `Node.js >=22.0.0`
- Runtime: single process — Discord.js client + Express web admin + optional Reader Bot
- Entry point: `index.js`
- Database: SQLite3 (WAL mode) at `data/proforwarder.db`
- Web admin: Express v5 on port 3001, served from `web/server.js`
- Frontend: vanilla HTML/CSS/JS — no build step, no transpilation

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Run bot (production) |
| `npm run dev` | Run bot with nodemon auto-reload (dev) |
| `docker compose up -d` | Start via Docker (recommended) |
| `docker compose --profile init run --rm init-config` | One-time config init (seeds .env, sets permissions) |
| `docker compose restart` | Restart after config changes |
| `docker compose -f compose.yaml up -d` | Production compose only (no override) |
| `docker compose logs -f proforwarder-bot` | View container logs |

No test suite exists. No linter configured. Verify changes manually via web admin UI or bot behavior.

## Architecture

```
index.js                        # Entry point — boots Discord client, DB, web server
readerBot.js                    # Optional secondary read-only Discord client (~216 lines)
errorHandlers.js                # Global unhandledRejection / uncaughtException
healthcheck.js                  # Docker health check script

handlers/
  forwardHandler.js             # Forwarding orchestrator (Discord->Discord, Discord->Telegram)
  aiHandler.js                  # AI translation threads & content optimization
  telegramHandler.js            # Telegram gateway (delegates to telegram/ submodules)
  telegram/
    telegramAPI.js              # HTTP wrapper for Telegram Bot API
    telegramConverter.js        # Discord format -> Telegram MarkdownV2
    telegramMediaHandler.js     # Media download/upload processing
    telegramMessageSender.js    # Message sending logic + retry
    telegramTextSplitter.js     # Text segmentation (900 char caption, 4000 char text)
    telegramUtils.js            # Utility functions

events/
  messageEvents.js              # Discord messageCreate/Update/Delete handlers

commands/
  proforwarderCommand.js        # /proforwarder slash command (returns web admin link)

utils/
  database.js                   # SQLite3 promisified wrapper, WAL mode, write-lock (1.2K lines)
  configManager.js              # Forward config CRUD (reads/writes data/forwardConfigs.json)
  logger.js                     # Colored timestamped logging: logInfo/logSuccess/logError
  webhookManager.js             # Discord webhook creation & per-channel reuse
  sliceFormatConverter.js       # PRIMARY: slice-based Discord->Telegram MarkdownV2
  formatConverter.js            # Basic regex format conversion
  aiFormatConverter.js          # FALLBACK: AI-powered format conversion (Gemini)
  aiManager.js                  # AI provider orchestration (Gemini primary, Google fallback)
  translationManager.js         # Translation thread lifecycle
  threadManager.js              # Discord thread creation/archival
  telegramChatTracker.js        # Telegram chat discovery & persistence
  discordInviteManager.js       # Source header invite generation
  emojiManager.js               # Custom emoji handling
  applicationEmojiManager.js    # Application-level emoji management
  ai/                           # AI provider implementations
    geminiProvider.js            # Google Gemini (primary)
    googleProvider.js            # Google Translate (fallback)
    deeplProvider.js             # DeepL (optional)
    openaiProvider.js            # OpenAI (optional)

config/
  config.js                     # Runtime config module (loads .env, exports object)
  .env                          # Secrets & toggles (git-ignored)
  .env.example                  # Template for .env
web/
  server.js                     # Express v5 app — ALL API routes + HTML shell (3.6K lines)
  lib/
    config.js                   # Web config validation
    localBypass.js              # Local auth bypass logic
  public/                       # Vanilla JS/CSS frontend (tab-based SPA)
    app.js                      # Tab routing & auth UI (SPA shell)
    dashboard.js                # Stats & diagnostics tab
    configs.js                  # Forward config CRUD tab
    autopublish.js              # Auto-publish settings tab
    logs.js                     # Message log viewer tab
    settings.js                 # Bot settings & emoji management tab
    guilds.js                   # Guild management tab
    debug.js                    # DB diagnostics tab (WEB_ADMIN_DEBUG=true only)
    styles.css                  # All styling

data/
  proforwarder.db               # SQLite database (git-ignored)
  forwardConfigs.json           # Forward rules (runtime-managed, do NOT edit while running)
  autoPublish.json              # Auto-publish settings (runtime-managed)
  cachedInvites.json            # Discord invite cache (runtime-managed)

Documentations/                 # Planning & design docs (historical reference)
```

## Read Routing Table

| Task | Read first |
|------|-----------|
| Forwarding logic | `handlers/forwardHandler.js` |
| Telegram integration | `handlers/telegramHandler.js` + `handlers/telegram/` |
| AI/translation | `handlers/aiHandler.js`, `utils/aiManager.js`, `utils/ai/` |
| Database schema/queries | `utils/database.js` |
| Web admin API routes | `web/server.js` |
| Web admin frontend | `web/public/` (each tab is a separate .js file) |
| Forward config management | `utils/configManager.js` |
| Format conversion pipeline | `utils/sliceFormatConverter.js` (primary) -> `utils/aiFormatConverter.js` (fallback) -> `utils/formatConverter.js` (basic) |
| Config/environment | `config/config.js` + `config/.env.example` |
| Bot startup sequence | `index.js` |
| Reader bot | `readerBot.js` |
| Docker setup | `Dockerfile`, `compose.yaml`, `compose.override.yaml` |
| Planning/design docs | `Documentations/` |

## Key Patterns

- **No build step** — vanilla HTML/CSS/JS frontend, Node.js backend, no transpilation
- **Config layers**: static via `config/config.js` (env vars at boot) + dynamic JSON files (runtime) + SQLite (persistent data)
- **Auth**: `getEffectiveAuth()` on all web API endpoints; returns 401 if not authenticated
- **DB access**: promisified sqlite3 wrappers with write-lock mechanism in `utils/database.js`
- **Format conversion pipeline**: sliceFormatConverter (primary) -> aiFormatConverter (fallback) -> formatConverter (basic)
- **Message chains**: split messages tracked via `messageChain` JSON array, `chainPosition`, `chainParentId`
- **Webhook strategy**: per-channel reuse, webhook name `ProForwarder` used to detect self-loop
- **Web API responses**: always `{ success: boolean, data: any, error: string|null }`
- **Frontend SPA**: tab-based, `app.js` manages shared state + routing, each tab has own JS file
- **Logging**: always use `logInfo`/`logSuccess`/`logError` from `utils/logger.js`, never raw `console.log`
- **Rate limiting**: in-memory (resets on restart), defined in `web/server.js`
- **Forwarding flow**: source channel messages are matched against forward configs and sent to target Discord channels (via webhooks) and/or Telegram chats
- **Retry queue**: failed forwards are queued in-memory and retried every 5 minutes; stale entries are cleaned up automatically
- **Message chain tracking**: long messages are split and tracked via `messageChain` array, `chainPosition`, and `chainParentId` for edit/delete propagation across splits

## Database Tables

| Table | Purpose | Key fields |
|-------|---------|-----------|
| `message_logs` | Forwarded message tracking | `originalMessageId`, `forwardedMessageId`, `configId`, `status`, `messageChain`, `chainPosition` |
| `bot_settings` | Key-value store | `key`, `value` (e.g. `uploaded_emoji_names` as JSON array) |
| `translation_threads` | Message -> Discord thread mapping | `forwardedMessageId`, `threadId`, `language`, `archived` |
| `telegram_chats` | Persistent Telegram chat discovery | `chatId` (PK), `title`, `type`, `memberStatus`, `discoveredVia` |

## Environment Variables

Primary config file: `config/.env` (git-ignored). See `config/.env.example` for all available variables.

**Core groups:**

| Group | Key variables |
|-------|--------------|
| Bot | `BOT_TOKEN`, `DEBUG_MODE`, `FORWARD_BOT_MESSAGES` |
| Format | `USE_SLICE_FORMAT_CONVERTER`, `USE_AI_FORMAT_CONVERTER` |
| Reader Bot | `READER_BOT_ENABLED`, `READER_BOT_TOKEN` |
| Telegram | `TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_API_URL`, `TELEGRAM_HIDE_SOURCE_HEADER`, `TELEGRAM_SMART_LINK_PREVIEWS` |
| AI | `GEMINI_API_KEY`, `GOOGLE_TRANSLATE_API_KEY`, `GOOGLE_PROJECT_ID`, `GEMINI_MODEL`, `AI_TRANSLATION_PROVIDER` |
| Log Maintenance | `STARTUP_LOG_MAINTENANCE`, `LOG_RETENTION_DAYS`, `LOG_RETENTION_ACTION` |
| Command UI | `COMMAND_UI_ENABLED`, `COMMAND_UI_ALLOWED_ROLE_IDS` |
| Web Admin | `WEB_ADMIN_ENABLED`, `WEB_ADMIN_PORT`, `WEB_ADMIN_AUTH_MODE`, `WEB_ADMIN_SESSION_SECRET` |
| Web Auth | `WEB_ADMIN_DISCORD_CLIENT_ID`, `WEB_ADMIN_DISCORD_CLIENT_SECRET`, `WEB_ADMIN_DISCORD_REDIRECT_URI` |
| Security | `WEB_ADMIN_SECURITY_STRICT`, rate limit vars |

## Docker Compose Behavior

By default, Docker Compose loads both files:
- `compose.yaml` — base service definition
- `compose.override.yaml` — local dev overrides (mounts `./data` and `./config`, exposes `127.0.0.1:80 -> 3001`)

For base-only (production paths at `/srv/docker-data/proforwarder/`):
```bash
docker compose -f compose.yaml up -d
```

The `init-config` service lives behind the `init` profile — `docker compose up` never starts it.

## Gotchas

- **Do NOT edit runtime JSON files while bot is running** — the bot writes to `data/forwardConfigs.json`, `data/autoPublish.json`, and `data/cachedInvites.json` at runtime. Edit via web admin or stop the bot first.
- **`config/config.js` is NOT JSON** — it's a JS module that reads `process.env`. Do not try to parse it as JSON.
- **Express v5** (not v4) — route parameter syntax and error handling differ from v4 tutorials.
- **`web/server.js` is 3,600+ lines** — contains ALL API routes AND serves the HTML shell inline. Read specific line ranges, not the whole file.
- **No tests exist** — there is no test suite, no test framework, no `*.test.js` files.
- **SQLite WAL mode** — concurrent reads OK, but writes go through write-lock mechanism in `database.js`.
- **Telegram caption limit is 900 chars** — text limit is 4000. Splitting handled by `telegramTextSplitter.js`.
- **Webhook name `ProForwarder`** — used to detect self-forwarding loops. Do not rename without updating the check in `forwardHandler.js`.
- **Rate limiters are in-memory** — reset on every restart, defined in `web/server.js`.
- **Reader bot is optional** — only initialized if `READER_BOT_ENABLED=true` AND `READER_BOT_TOKEN` is set.
- **`readerBot.js` is ~216 lines** — small, cohesive single class wrapping the optional read-only Discord client.
- **Docker Compose loads override by default** — if behavior differs from expected, check if `compose.override.yaml` is being applied.
- **Graceful shutdown** — `SIGINT` handler in `index.js` closes bots, database, and web server in order. Don't add additional shutdown logic elsewhere.
