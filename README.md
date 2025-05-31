<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white) ![Discord.js](https://img.shields.io/badge/Discord.js-5865F2?style=flat&logo=discord&logoColor=white) ![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white) ![dotenv](https://img.shields.io/badge/dotenv-ECD53F?style=flat) ![Chalk](https://img.shields.io/badge/Chalk-FF6B6B?style=flat) ![License](https://img.shields.io/badge/license-MIT-blue?style=flat)

---

# 📨 ProForwarder Discord Bot

**A powerful Discord bot for forwarding messages between channels and servers with optional Telegram integration.**

*Perfect for communities that need reliable, 1:1 message forwarding across channels, servers, and platforms.*

---

</div>

## 📖 Contents

- [� ProForwarder Discord Bot](#-proforwarder-discord-bot)
  - [📖 Contents](#-contents)
  - [🚀 Features](#-features)
    - [🎯 **Core Functionality**](#-core-functionality)
    - [🌟 **Advanced Features** *(Planned)*](#-advanced-features-planned)
  - [🏗️ Current Status](#️-current-status)
    - [✅ **Phase 0: Repository Blueprint Cleanup** - COMPLETED](#-phase-0-repository-blueprint-cleanup---completed)
    - [🚧 **Phase 1: Core Foundation** - IN PROGRESS](#-phase-1-core-foundation---in-progress)
  - [⚡ Getting Started](#-getting-started)
    - [📋 Prerequisites](#-prerequisites)
    - [🚀 Installation](#-installation)
  - [⚙️ Configuration](#️-configuration)
    - [**Environment Variables** (`.env`)](#environment-variables-env)
    - [**Bot Configuration** (`env.js`)](#bot-configuration-envjs)
  - [📁 Project Structure](#-project-structure)
  - [📋 Planned Implementation](#-planned-implementation)
    - [**Phase 1: Core Foundation**](#phase-1-core-foundation)
    - [**Phase 2: Discord-to-Discord Forwarding**](#phase-2-discord-to-discord-forwarding)
    - [**Phase 3: Advanced Features**](#phase-3-advanced-features)
    - [**Phase 4: Extended Integration**](#phase-4-extended-integration)
  - [🔧 Technology Stack](#-technology-stack)
  - [📝 Documentation](#-documentation)
  - [🤝 Contributing](#-contributing)
  - [📄 License](#-license)

---

## 🚀 Features

### 🎯 **Core Functionality**
- **📤 Discord to Discord**: Forward messages between channels on the same server or across different servers
- **🔄 1:1 Message Copy**: Preserves exact formatting, embeds, attachments, and reactions
- **⚡ Real-time Forwarding**: Instant message forwarding on message events
- **📱 Telegram Integration**: Optional forwarding to Telegram channels *(coming soon)*

### 🌟 **Advanced Features** *(Planned)*
- **🧵 Translation Threads**: Auto-translation with Discord's native thread system
- **🤖 AI Integration**: Smart formatting and content optimization
- **🔧 Advanced Configuration**: Webhook support, filter rules, scheduling
- **🔒 Security Features**: Permission validation, rate limiting, content filtering

---

## 🏗️ Current Status

### ✅ **Phase 0: Repository Blueprint Cleanup** - COMPLETED
- ✅ Cleaned all boost-related components
- ✅ Updated to message forwarding architecture  
- ✅ Maintained foundational infrastructure and coding patterns
- ✅ Updated package.json and configuration structure

### 🚧 **Phase 1: Core Foundation** - IN PROGRESS
- 🔄 Implementing new database schema for forward configurations
- 🔄 Setting up message event handlers
- 🔄 Creating `/forward` command system

---

## ⚡ Getting Started

### 📋 Prerequisites

- **Node.js** v16.0.0 or higher
- **npm** or **yarn** package manager
- **Discord Bot Token** from [Discord Developer Portal](https://discord.com/developers/applications)
- **Telegram Bot Token** *(optional, for Telegram integration)*

### 🚀 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd PROFORWARDER-Discord-Bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   # Copy environment files
   cp config/.env.example config/.env
   cp config/env.js.example config/env.js
   
   # Edit configuration files with your tokens and settings
   ```

4. **Run the bot**
   ```bash
   npm start          # Production
   npm run dev        # Development with auto-restart
   ```

---

## ⚙️ Configuration

### **Environment Variables** (`.env`)
```env
BOT_TOKEN=your_discord_bot_token_here

# Optional Telegram Integration
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Optional AI Integration
AI_ENABLED=false
AI_PROVIDER=openai
AI_API_KEY=your_ai_api_key

# Optional Translation
TRANSLATION_ENABLED=false
TRANSLATION_PROVIDER=google
TRANSLATION_API_KEY=your_translation_api_key
TRANSLATION_LANGUAGES=en,es,fr,de
```

### **Bot Configuration** (`env.js`)
The bot uses a modular configuration system with support for:
- **Core Settings**: Debug mode, bot token
- **Telegram Integration**: Bot token, API URL
- **AI Services**: Provider, model, API keys
- **Translation Services**: Provider, target languages

---

## 📁 Project Structure

```
ProForwarder-Discord-Bot/
├── 📁 config/              # Configuration files and environment setup
│   ├── .env.example        # Environment variables template
│   └── env.js.example      # Bot configuration template
├── 📁 utils/               # Database, logging, and utility functions
│   ├── database.js         # SQLite database operations
│   └── logger.js           # Colorized logging system
├── 📁 handlers/            # Core business logic handlers (empty - to be implemented)
├── 📁 events/              # Discord event handlers (empty - to be implemented)
├── 📁 commands/            # Slash command definitions (empty - to be implemented)
├── 📁 data/               # Database storage
├── 📄 index.js            # Main bot entry point
├── 📄 errorHandlers.js    # Global error handling
└── 📄 PROFORWARDER_PLANNING.md  # Detailed architecture plans
```

---

## 📋 Planned Implementation

### **Phase 1: Core Foundation**
- [ ] New database schema for forward configurations
- [ ] Basic message events with `GuildMessages` and `MessageContent` intents
- [ ] Core `/forward` command for setup

### **Phase 2: Discord-to-Discord Forwarding**
- [ ] Forward handler for Discord-to-Discord forwarding
- [ ] Message processing: text, embeds, attachments, reactions
- [ ] Configuration management and testing

### **Phase 3: Advanced Features**
- [ ] Message editing and deletion handling
- [ ] Reaction forwarding
- [ ] Bulk forward options
- [ ] Enhanced admin interface

### **Phase 4: Extended Integration**
- [ ] Telegram bot integration
- [ ] Format conversion between platforms
- [ ] Translation threads with Discord's native thread system
- [ ] AI-powered features

---

## 🔧 Technology Stack

- **🟢 Node.js** - Runtime environment
- **🔵 Discord.js v14** - Discord API wrapper
- **🗃️ SQLite3** - Database with promisified operations
- **🎨 Chalk** - Colorized console logging
- **⚙️ dotenv** - Environment configuration management
- **🏗️ Modular Architecture** - Established patterns for maintainability

---

## 📝 Documentation

- **[📋 Planning Document](PROFORWARDER_PLANNING.md)** - Detailed architecture and implementation plans
- **[🔧 Configuration Guide](config/env.js.example)** - Configuration options and examples
- **[🗃️ Database Schema](utils/database.js)** - Database structure and operations

---

## 🤝 Contributing

This project maintains established coding patterns and architecture. Please follow the existing code style and patterns when contributing:

- Use the established logging system (`utils/logger.js`)
- Follow the modular file structure
- Maintain the promisified database pattern
- Add appropriate error handling

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with ❤️ for the Discord community**

</div>
