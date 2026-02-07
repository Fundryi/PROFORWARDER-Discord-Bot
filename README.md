<div align="center">

![Node.js](https://img.shields.io/badge/Node.js_22+-339933?style=flat&logo=node.js&logoColor=white)
![Discord.js](https://img.shields.io/badge/Discord.js_14-5865F2?style=flat&logo=discord&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat)

# ProForwarder Discord Bot

**Discord and Telegram forwarding with edit/delete sync and a web-first admin workflow.**

[Features](#features) | [Quick Start](#quick-start) | [Commands](#commands) | [Configuration](#configuration) | [Web Admin](#web-admin) | [Docker](#docker)

</div>

---

## Features

**Forwarding**
- Discord to Discord forwarding (same-server and cross-server)
- Discord to Telegram forwarding with MarkdownV2 conversion
- Edit and delete synchronization for forwarded messages
- Retry/force-forward from Web Admin logs by source message ID
- Auto-publish support for Discord announcement channels

**Telegram**
- Media + caption handling with split-chain tracking
- Smart handling for caption/text length limits
- Discovery from bot updates + configured chats (group/supergroup/channel focused)
- Create-flow verification of bot chat access before Telegram forward configs are saved
- Target input supports numeric chat IDs, `@username`, and `t.me` links (resolved to canonical chat ID)
- Tracked Telegram chats can be removed from web UI (blocked when still used by forward configs)

**AI Translation**
- AI translation flow with provider fallback
- Currently supported providers in runtime config:
  - Google Gemini (primary)
  - Google Translate (fallback)

**Operations**
- SQLite message log tracking
- Startup log maintenance (validation + cleanup)
- Reader bot support for read-only source access patterns
- Built-in web admin panel (`/admin`) for configs, logs, auto-publish, and settings

---

## Quick Start

### Prerequisites

- Node.js 22+
- Discord bot token
- Telegram bot token (optional, only if Telegram forwarding is enabled)

### Installation

```bash
git clone <repository-url>
cd PROFORWARDER-Discord-Bot
npm install
cp config/.env.example config/.env
```

Edit `config/.env` with your tokens and toggles, then run:

```bash
npm start
```

Development mode:

```bash
npm run dev
```

---

## Commands

### `/proforward` (Manage Channels required)

| Subcommand | Status | Notes |
|------------|--------|-------|
| `status` | Active | Bot/server/channel status summary |
| `telegram-discover` | Active | Telegram chat discovery helper |
| `reader-status` | Active | Reader bot status + invite link |
| `setup` | Web-managed (disabled) | Use Web Admin `Configs` tab |
| `telegram` | Web-managed (disabled) | Use Web Admin `Configs` tab |
| `list` | Web-managed (disabled) | Use Web Admin `Forward Configurations` table |
| `remove` | Web-managed (disabled) | Use Web Admin config row `Remove` |
| `test` | Web-managed (disabled) | Use Web Admin config row `Test TG` |
| `retry` | Web-managed (disabled) | Use Web Admin `Logs` -> retry source message |
| `auto-publish` | Web-managed (disabled) | Use Web Admin `Auto Publish` tab |

### `/debug` (Administrator required)

| Subcommand | Status | Notes |
|------------|--------|-------|
| `database` | Active | DB-oriented diagnostics view |
| `search` | Active | Search logs by message ID (also available in Web Admin Logs) |

---

## Configuration

### `config/.env` (main operational config)

Primary runtime toggles and secrets live in `config/.env`.

```env
BOT_TOKEN=your_discord_bot_token

# Bot behavior
DEBUG_MODE=false
FORWARD_BOT_MESSAGES=true
USE_SLICE_FORMAT_CONVERTER=true
USE_AI_FORMAT_CONVERTER=false

# Telegram (optional)
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_API_URL=https://api.telegram.org

# Reader bot (optional)
READER_BOT_ENABLED=false
READER_BOT_TOKEN=

# AI provider keys
GEMINI_API_KEY=
GOOGLE_TRANSLATE_API_KEY=
GOOGLE_PROJECT_ID=
```

### `config/config.js` (tracked runtime defaults)

- `config/config.js` is the runtime config module used by the app.
- It is intended to be tracked in git.
- Keep secrets in `config/.env` only.

Key sections in `config/config.js`:
- `startupLogMaintenance`
- `commandUi`
- `telegram`
- `ai`
- `webAdmin`

### JSON runtime data files

Managed automatically by the bot:
- `config/forwardConfigs.json`
- `config/autoPublish.json`
- `config/cachedInvites.json`

Do not edit these manually while the bot is running.

---

## Web Admin

Web admin is built into the same bot process and served from `web/server.js`.

### Primary capabilities

- `Configs`: create/toggle/remove Discord and Telegram forwards, with manual-first Telegram target input plus tracked-chat selection/removal
- `Auto Publish`: manage announcement auto-publish settings
- `Logs`: filter/search logs, inspect failures, retry source messages
- `Settings`: existing-key edits with focused emoji-name management (`uploaded_emoji_names`)

The project is currently web-first for day-to-day operations. Most management slash commands are intentionally disabled and redirected to Web Admin.

Telegram note: the Telegram Bot API does not provide a direct "list all chats bot is in" endpoint. Chat discovery is best-effort via updates plus tracked/configured chat data.

### Local mode (default/simple)

Use this for localhost/self-hosted testing without Discord OAuth login:

```env
WEB_ADMIN_ENABLED=true
WEB_ADMIN_AUTH_MODE=local
WEB_ADMIN_PORT=3001
WEB_ADMIN_LOCAL_ALLOWED_HOSTS=localhost,127.0.0.1,::1
WEB_ADMIN_LOCAL_ALLOWED_IPS=
WEB_ADMIN_DEBUG=false
```

### OAuth mode (public/internet-facing)

Use this when exposing admin publicly:

```env
WEB_ADMIN_AUTH_MODE=oauth
WEB_ADMIN_BASE_URL=https://your-domain.example
WEB_ADMIN_TRUST_PROXY=true
WEB_ADMIN_SESSION_SECRET=strong_random_secret
WEB_ADMIN_DISCORD_CLIENT_ID=
WEB_ADMIN_DISCORD_CLIENT_SECRET=
WEB_ADMIN_DISCORD_REDIRECT_URI=https://your-domain.example/admin/callback
WEB_ADMIN_ALLOWED_ROLE_IDS=
```

`WEB_ADMIN_SESSION_SECRET` is only required for OAuth mode.

---

## Docker

### Start

```bash
docker compose up -d
```

On first run, init service creates:
- `/config/.env` from `config/.env.example`
- `/config/config.js` from tracked `config/config.js`

### Web admin exposure

`compose.yaml` does not expose a public port by default.

For local access, map host port to container port `3001` (example):

```yaml
services:
  proforwarder-bot:
    ports:
      - "127.0.0.1:80:3001"
```

Then open:
- `http://localhost/admin` (if host `80 -> 3001`)
- `http://localhost:3001/admin` (if direct `3001 -> 3001`)

### Persistent data

- `config/.env`
- `config/config.js`
- `config/forwardConfigs.json`
- `config/autoPublish.json`
- `config/cachedInvites.json`
- `data/proforwarder.db`

---

## Project Structure

```text
ProForwarder-Discord-Bot/
├── commands/
├── config/
│   ├── .env
│   ├── .env.example
│   ├── config.js
│   ├── forwardConfigs.json
│   ├── autoPublish.json
│   └── cachedInvites.json
├── data/
├── events/
├── handlers/
├── utils/
├── web/
├── index.js
├── readerBot.js
├── compose.yaml
└── Dockerfile
```

---

## Documentation

Technical docs are in `Documentations/`, including:
- `Documentations/COMMAND_WEB_COVERAGE_DEPRECATION.md`
- `Documentations/CODE_REVIEW_ISSUES.md`
- `Documentations/COMMAND_UX_REWORK_PLAN.md`
- `Documentations/STARTUP_LOG_MAINTENANCE_PLAN.md`
- `Documentations/READER_BOT_IMPLEMENTATION.md`
- `Documentations/TELEGRAM_CAPTION_LENGTH_SOLUTION.md`

Project-level open-item tracker:
- `PROJECT_REMAINING_IMPROVEMENTS.md`

---

## License

MIT - see `LICENSE`.
