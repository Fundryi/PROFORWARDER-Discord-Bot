<div align="center">

![Node.js](https://img.shields.io/badge/Node.js_22+-339933?style=flat&logo=node.js&logoColor=white)
![Discord.js](https://img.shields.io/badge/Discord.js_14-5865F2?style=flat&logo=discord&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat)

# ProForwarder Discord Bot

**Discord and Telegram forwarding with edit/delete sync, retry tooling, and optional web admin.**

[Features](#features) | [Quick Start](#quick-start) | [Commands](#commands) | [Configuration](#configuration) | [Web Admin](#web-admin) | [Docker](#docker)

</div>

---

## Features

**Forwarding**
- Discord to Discord forwarding (same-server and cross-server)
- Discord to Telegram forwarding with MarkdownV2 conversion
- Edit and delete synchronization for forwarded messages
- Retry/force-forward command for specific source messages
- Auto-publish support for Discord announcement channels

**Telegram**
- Media + caption handling with split-chain tracking
- Smart handling for caption/text length limits
- Telegram chat discovery command (`/proforward telegram-discover`)

**AI Translation**
- AI translation flow with provider fallback
- Currently supported providers in runtime config:
  - Google Gemini (primary)
  - Google Translate (fallback)

**Operations**
- SQLite message log tracking
- Startup log maintenance (validation + cleanup)
- Reader bot support for read-only source access patterns
- Optional web admin panel (`/admin`) for config and diagnostics

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

| Subcommand | Description |
|------------|-------------|
| `setup` | Create Discord -> Discord forward |
| `telegram` | Create Discord -> Telegram forward |
| `telegram-discover` | Discover Telegram chats for your bot |
| `list` | List active forward configurations |
| `remove` | Remove a configuration by ID |
| `status` | Show bot/server/channel status summary |
| `test` | Test Telegram connectivity for a chat ID |
| `retry` | Retry/force-forward by source Discord message ID |
| `auto-publish` | Toggle auto-publish on announcement channels |
| `reader-status` | Show reader bot status + invite link |

### `/debug` (Administrator required)

| Subcommand | Description |
|------------|-------------|
| `database` | Show recent message log records |
| `search` | Search logs by message ID |

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
- `Documentations/CODE_REVIEW_ISSUES.md`
- `Documentations/COMMAND_UX_REWORK_PLAN.md`
- `Documentations/STARTUP_LOG_MAINTENANCE_PLAN.md`
- `Documentations/READER_BOT_IMPLEMENTATION.md`
- `Documentations/TELEGRAM_CAPTION_LENGTH_SOLUTION.md`

---

## License

MIT - see `LICENSE`.
