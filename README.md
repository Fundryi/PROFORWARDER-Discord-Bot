<div align="center">

![Node.js](https://img.shields.io/badge/Node.js_22+-339933?style=flat&logo=node.js&logoColor=white)
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

**Core Forwarding**
- Webhook-based forwarding - messages appear as the original user
- Same-server and cross-server Discord forwarding
- Discord-to-Telegram forwarding with MarkdownV2 formatting
- Real-time edit and delete synchronization across all targets
- Full content preservation (text, embeds, attachments, stickers, reactions)
- Smart message chain handling for long captions and split messages

**Telegram Integration**
- Automatic MarkdownV2 conversion from Discord formatting
- Smart caption splitting for media messages exceeding Telegram limits
- Media group support with full chain tracking
- Configurable split strategies (`smart` or `separate`)
- 200+ Discord emoji mappings for Telegram

**AI & Translation**
- AI-powered translation with thread support
- Multiple providers: Gemini, Google Translate, OpenAI, DeepL
- Translation threads under forwarded messages
- Content optimization for cross-platform readability
- Configurable caching and fallback providers

**Advanced**
- Reader Bot for read-only monitoring of restricted servers
- Auto-publishing for announcement channels
- Smart mention resolution (`@everyone`, `@here`) with permission checks
- Self-maintaining SQLite database with orphan cleanup
- Retry queue with exponential backoff for failed forwards
- Debug commands for database inspection and message search

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

For development with auto-reload:

```bash
npm run dev
```

### Bot Invite Link

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_ID&permissions=536879120&scope=bot%20applications.commands
```

**Required Permissions:** View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Webhooks, Create Public Threads, Send Messages in Threads, Mention Everyone, Manage Messages

---

## Commands

### `/proforward` (Manage Channels permission required)

| Subcommand | Description |
|------------|-------------|
| `setup` | Set up Discord-to-Discord forwarding |
| `telegram` | Set up Discord-to-Telegram forwarding |
| `telegram-discover` | Discover available Telegram chats |
| `list` | List active forward configurations |
| `remove` | Remove a configuration |
| `status` | Show bot and integration status |
| `test` | Test Telegram connection |
| `retry` | Retry/force forward a message by source message ID |
| `auto-publish` | Configure auto-publishing for announcement channels |
| `reader-status` | Check reader bot status and generate invite link |

### `/debug` (Administrator permission required)

| Subcommand | Description |
|------------|-------------|
| `database` | Show recent database entries for message tracking (limit 1-50) |
| `search` | Search for a specific message in the database by message ID |

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
GOOGLE_TRANSLATE_API_KEY=your_google_translate_api_key
GOOGLE_PROJECT_ID=your_google_cloud_project_id

# Optional: Telegram
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Optional: Reader Bot
READER_BOT_ENABLED=false
READER_BOT_TOKEN=your_reader_bot_token
```

### Application Config (`config/env.js`)

Key settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `debugMode` | `false` | Enable verbose debug logging |
| `forwardBotMessages` | `true` | Forward messages from other bots |
| `useSliceFormatConverter` | `true` | Use primary format converter for Telegram |
| `telegram.enabled` | `false` | Enable Telegram integration |
| `telegram.captionLengthLimit` | `900` | Max caption length before splitting |
| `telegram.textLengthLimit` | `4000` | Max text message length before splitting |
| `telegram.captionSplitStrategy` | `separate` | Split strategy: `smart` or `separate` |
| `telegram.hideSourceHeader` | `false` | Hide server/channel header in Telegram messages |
| `telegram.smartLinkPreviews` | `true` | Enable smart link preview handling |
| `ai.enabled` | `true` | Enable AI translation features |
| `ai.translation.defaultProvider` | `gemini` | Primary translation provider |
| `ai.translation.fallbackProvider` | `google` | Fallback translation provider |
| `readerBot.enabled` | `false` | Enable the reader bot |

Forward configurations are managed via `/proforward` commands - don't edit `forwardConfigs` manually.

---

## Reader Bot

The Reader Bot is a secondary Discord bot with minimal read-only permissions for monitoring servers where the main bot cannot be invited with full permissions.

**Use cases:**
- High-security servers where full bot permissions aren't allowed
- Cross-server monitoring from multiple servers to a central channel
- Permission-sensitive environments requiring read-only access

**Setup:**
1. Create a second bot application in the [Discord Developer Portal](https://discord.com/developers/applications)
2. Set `READER_BOT_ENABLED=true` and `READER_BOT_TOKEN=...` in `config/.env`
3. Use `/proforward reader-status` to get the invite link
4. Invite the reader bot to the target server (only needs View Channels + Read Message History)
5. Set up forwarding with `/proforward setup` using the source server/channel IDs

The reader bot runs invisibly and forwards message data (creates, edits, deletes) to the main bot for processing.

---

## Docker

### Quick Deploy

```bash
docker compose up -d
```

On first run, the init container copies example configs to `/srv/docker-data/proforwarder/config/`. Edit `.env` with your tokens, then restart.

### Local Development

Use the `compose.override.yaml` for local volume mounts:

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
- `config/.env` - Secrets and tokens
- `config/env.js` - Application config
- `data/proforwarder.db` - SQLite database

---

## Project Structure

```
ProForwarder-Discord-Bot/
├── config/                  # Configuration files
│   ├── .env                 # Environment variables (secrets)
│   └── env.js               # Application configuration
├── commands/                # Slash command handlers
│   ├── proforwardCommand.js # /proforward command (setup, telegram, list, etc.)
│   └── debugCommands.js     # /debug command (database, search)
├── events/                  # Discord event handlers
│   └── messageEvents.js     # Message create, update, delete handling
├── handlers/                # Business logic
│   ├── forwardHandler.js    # Main forwarding orchestrator
│   ├── aiHandler.js         # AI translation processing
│   ├── telegramHandler.js   # Telegram integration facade
│   └── telegram/            # Telegram module components
│       ├── telegramAPI.js          # API wrapper
│       ├── telegramConverter.js    # Discord-to-Telegram format conversion
│       ├── telegramMediaHandler.js # Media type detection and filtering
│       ├── telegramMessageSender.js# Message sending and splitting
│       ├── telegramTextSplitter.js # Smart text splitting logic
│       └── telegramUtils.js        # Chain editing, deletion, escaping
├── utils/                   # Shared utilities
│   ├── database.js          # SQLite operations and schema
│   ├── configManager.js     # Forward config CRUD
│   ├── webhookManager.js    # Discord webhook operations
│   ├── threadManager.js     # Translation thread management
│   ├── aiManager.js         # AI provider management
│   ├── translationManager.js# Translation orchestration
│   ├── formatConverter.js   # Discord-to-Telegram format conversion
│   ├── emojiManager.js      # Discord-to-Telegram emoji mapping
│   ├── logger.js            # Colored console logging
│   └── ai/                  # AI provider implementations
│       ├── geminiProvider.js
│       ├── googleProvider.js
│       ├── openaiProvider.js
│       └── deeplProvider.js
├── data/                    # SQLite database (gitignored)
├── Documentations/          # Detailed technical documentation
├── index.js                 # Entry point and bot initialization
├── readerBot.js             # Reader bot for read-only server monitoring
├── errorHandlers.js         # Global error handlers
├── healthcheck.js           # Docker health check endpoint
├── compose.yaml             # Docker Compose (production)
├── compose.override.yaml    # Docker Compose (local development)
└── Dockerfile               # Multi-stage Node.js build
```

---

## Documentation

Detailed technical documentation is available in the `Documentations/` folder:

- [Enhanced Format Conversion](Documentations/ENHANCED_FORMAT_CONVERSION.md) - Discord-to-Telegram formatting
- [Reader Bot Implementation](Documentations/READER_BOT_IMPLEMENTATION.md) - Reader bot architecture
- [Telegram Caption Handling](Documentations/TELEGRAM_CAPTION_LENGTH_SOLUTION.md) - Smart caption splitting
- [Telegram Handler Refactoring](Documentations/TELEGRAM_HANDLER_REFACTORING_PLAN.md) - Modular Telegram architecture
- [MarkdownV2 Conversion Summary](Documentations/MARKDOWNV2_CONVERSION_SUMMARY.md) - Conversion rules reference

---

## License

MIT License - see [LICENSE](LICENSE) for details.

<div align="center">

**Built for seamless cross-platform communication**

</div>
