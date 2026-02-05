<div align="center">

![Node.js](https://img.shields.io/badge/Node.js_24-339933?style=flat&logo=node.js&logoColor=white)
![Discord.js](https://img.shields.io/badge/Discord.js_14-5865F2?style=flat&logo=discord&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat)

# ProForwarder Discord Bot

**Seamless message forwarding between Discord channels, servers, and Telegram with perfect 1:1 message preservation.**

[Features](#features) | [Quick Start](#quick-start) | [Commands](#commands) | [Configuration](#configuration) | [Docker](#docker)

</div>

---

## Features

**Core**
- Webhook-based forwarding - messages appear as the original user
- Same-server and cross-server Discord forwarding
- Discord to Telegram forwarding with MarkdownV2 formatting
- Real-time edit and delete synchronization
- Full content preservation (text, embeds, attachments, stickers)

**Advanced**
- AI translation with thread support (Gemini, OpenAI, DeepL)
- Smart mention resolution for cross-platform forwarding
- 200+ Discord emoji mappings for Telegram
- Auto-publishing for announcement channels
- Self-maintaining database with orphan cleanup
- Reader Bot support for read-only monitoring

---

## Quick Start

### Prerequisites

- Node.js 22+
- Discord Bot Token ([Developer Portal](https://discord.com/developers/applications))
- Telegram Bot Token (optional, via [@BotFather](https://t.me/botfather))

### Installation

```bash
git clone <repository-url>
cd PROFORWARDER-Discord-Bot
npm install

# Configure
cp config/.env.example config/.env
cp config/env.js.example config/env.js
# Edit config/.env with your tokens

# Run
npm start
```

### Bot Invite Link

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_ID&permissions=536879120&scope=bot%20applications.commands
```

**Required Permissions:** View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Webhooks, Create Public Threads, Mention Everyone, Manage Messages

---

## Commands

All commands require **Manage Channels** permission.

| Command | Description |
|---------|-------------|
| `/proforward setup` | Set up Discord-to-Discord forwarding |
| `/proforward telegram` | Set up Discord-to-Telegram forwarding |
| `/proforward telegram-discover` | Discover available Telegram chats |
| `/proforward list` | List active configurations |
| `/proforward remove` | Remove a configuration |
| `/proforward status` | Show bot and integration status |
| `/proforward test` | Test Telegram connection |
| `/proforward retry` | Retry a failed forward |
| `/proforward auto-publish` | Configure auto-publishing |

### Examples

```bash
# Same server forwarding
/proforward setup source:#announcements target_channel:#general

# Cross server forwarding
/proforward setup source:#news target_channel:1375900190460084445 target_server:812312654705328154

# Telegram forwarding
/proforward telegram-discover
/proforward telegram source:#announcements chat_id:-1001234567890
```

---

## Configuration

### Environment Variables (`config/.env`)

```env
BOT_TOKEN=your_discord_bot_token

# Optional: AI Translation
GEMINI_API_KEY=your_gemini_api_key

# Optional: Telegram
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Optional: Reader Bot
READER_BOT_ENABLED=false
READER_BOT_TOKEN=your_reader_bot_token
```

### Application Config (`config/env.js`)

Key settings in `env.js`:

| Setting | Default | Description |
|---------|---------|-------------|
| `debugMode` | `false` | Enable debug logging |
| `forwardBotMessages` | `true` | Forward messages from other bots |
| `telegram.enabled` | `false` | Enable Telegram integration |
| `ai.enabled` | `false` | Enable AI translation features |

Forward configurations are managed via Discord commands - don't edit `forwardConfigs` manually.

---

## Docker

### Quick Deploy

```bash
docker compose up -d
```

On first run, the init container copies example configs to `/srv/docker-data/proforwarder/config/`. Edit `.env` with your tokens, then restart.

### Local Development

Create `compose.override.yaml` (gitignored):

```yaml
services:
  init-config:
    volumes:
      - ./data:/data
      - ./config:/config

  proforwarder-bot:
    volumes:
      - ./data:/app/data
      - ./config:/app/config
```

### Data Persistence

All persistent data is stored at `/srv/docker-data/proforwarder/`:
- `config/.env` - Secrets
- `config/env.js` - Application config
- `data/proforwarder.db` - SQLite database

---

## Project Structure

```
ProForwarder-Discord-Bot/
├── config/              # Configuration files
├── commands/            # Slash command handlers
├── events/              # Discord event handlers
├── handlers/            # Business logic (forwarding, Telegram, AI)
├── utils/               # Database, logging, webhooks, formatters
├── data/                # SQLite database (gitignored)
├── index.js             # Entry point
├── compose.yaml         # Docker Compose (production)
└── Dockerfile           # Multi-stage Node.js 24 build
```

---

## Documentation

Detailed documentation is available in the `Documentations/` folder:

- [Enhanced Format Conversion](Documentations/ENHANCED_FORMAT_CONVERSION.md)
- [Reader Bot Implementation](Documentations/READER_BOT_IMPLEMENTATION.md)
- [Telegram Caption Handling](Documentations/TELEGRAM_CAPTION_LENGTH_SOLUTION.md)

---

## License

MIT License - see [LICENSE](LICENSE) for details.

<div align="center">

**Built for seamless cross-platform communication**

</div>
