<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white) ![Discord.js](https://img.shields.io/badge/Discord.js-5865F2?style=flat&logo=discord&logoColor=white) ![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white) ![dotenv](https://img.shields.io/badge/dotenv-ECD53F?style=flat) ![Chalk](https://img.shields.io/badge/Chalk-FF6B6B?style=flat) ![License](https://img.shields.io/badge/license-MIT-blue?style=flat)

---

# 📨 ProForwarder Discord Bot

**A powerful Discord bot for seamless message forwarding between channels and servers with perfect 1:1 message preservation.**

*Perfect for communities that need reliable, native-looking message forwarding across channels and servers.*

---

</div>

## 📖 Contents

- [📨 ProForwarder Discord Bot](#-proforwarder-discord-bot)
  - [📖 Contents](#-contents)
  - [🚀 Features](#-features)
    - [🎯 **Core Functionality**](#-core-functionality)
    - [🌟 **Advanced Features**](#-advanced-features)
  - [🏗️ Current Status](#️-current-status)
    - [🚀 **Enterprise Ready**](#-enterprise-ready)
  - [⚡ Getting Started](#-getting-started)
    - [📋 Prerequisites](#-prerequisites)
    - [🚀 Installation](#-installation)
  - [💡 Usage](#-usage)
    - [🎯 Quick Setup](#-quick-setup)
    - [📋 Available Commands](#-available-commands)
  - [⚙️ Configuration](#️-configuration)
    - [**Environment Variables** (`.env`)](#environment-variables-env)
    - [**Forward Configurations** (`config/env.js`)](#forward-configurations-configenvjs)
  - [📁 Project Structure](#-project-structure)
  - [🔧 Technology Stack](#-technology-stack)
  - [📝 Documentation](#-documentation)
  - [🤝 Contributing](#-contributing)
  - [📄 License](#-license)

---

## 🚀 Features

### 🎯 **Core Functionality**
- **🎭 Perfect 1:1 Forwarding**: Uses webhooks to make forwarded messages appear exactly as the original user posted them
- **📤 Same Server Forwarding**: Forward messages between channels on the same Discord server
- **🌐 Cross-Server Forwarding**: Forward messages between channels on different Discord servers
- **🤖 Bot Message Support**: Forwards messages from other bots with subtle bot indicator
- **📁 Complete Content Preservation**: Text, embeds, attachments, stickers, and formatting perfectly preserved
- **⚡ Real-time Forwarding**: Instant message forwarding with webhook technology
- **✏️ Edit Synchronization**: Real-time message edit forwarding that updates existing forwarded messages

### 🌟 **Advanced Features**
- **😀 Universal Emoji Support**: Application-level emoji management for cross-server emoji compatibility
- **📢 Smart Mention Control**: Configurable @everyone/@here forwarding with permission-based safety
- **🧹 Intelligent Database**: Self-maintaining database with startup validation and orphaned message cleanup
- **🔄 Smart Loop Prevention**: Advanced detection to prevent infinite forwarding loops
- **⚙️ Flexible Configuration**: File-based configuration system for easy management
- **🔒 Permission Validation**: Automatic permission checking and helpful error messages
- **📊 Quality Detection**: Automatically detects and uses optimal forwarding method
- **🔧 Fallback Support**: Works with basic permissions when webhooks unavailable
- **📋 Easy Management**: Simple command structure for setup and maintenance
- **🐛 Advanced Debugging**: Comprehensive logging and monitoring for troubleshooting

---

## 🏗️ Current Status

### 🚀 **Enterprise Ready**
The ProForwarder Discord Bot is a fully-featured, enterprise-grade message forwarding solution offering:

- **Perfect webhook-based forwarding** with 1:1 message preservation and edit synchronization
- **Universal emoji support** with application-level emoji management
- **Smart mention control** with configurable @everyone/@here forwarding
- **Intelligent database management** with self-healing and cleanup capabilities
- **Same-server and cross-server** forwarding fully functional
- **Bot message forwarding** with smart loop prevention
- **Complete command system** with `/proforward` interface
- **File-based configuration** for easy management
- **Comprehensive error handling** and user guidance
- **Advanced debugging and monitoring** system
- **Enterprise-tested** and ready for production deployment

---

## ⚡ Getting Started

### 📋 Prerequisites

- **Node.js** v16.0.0 or higher
- **npm** or **yarn** package manager
- **Discord Bot Token** from [Discord Developer Portal](https://discord.com/developers/applications)
- **Manage Webhooks** permission in target channels (for perfect forwarding)

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
   
   # Edit .env with your Discord bot token
   ```

4. **Run the bot**
   ```bash
   npm start          # Production
   npm run dev        # Development with auto-restart
   ```

---

## 💡 Usage

### 🎯 Quick Setup

**Same Server Forwarding:**
```
/proforward setup source:#announcements target_channel:#general
```

**Cross Server Forwarding:**
```
/proforward setup source:#news target_channel:1375900190460084445 target_server:812312654705328154
```

### 📋 Available Commands

- **`/proforward setup`** - Set up message forwarding between channels
- **`/proforward list`** - List all active forward configurations
- **`/proforward remove`** - Remove a forward configuration
- **`/proforward status`** - Show bot status and available servers

---

## ⚙️ Configuration

### **Environment Variables** (`.env`)
```env
BOT_TOKEN=your_discord_bot_token_here

# Optional features (currently unused but ready for future expansion)
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

AI_ENABLED=false
AI_PROVIDER=openai
AI_API_KEY=your_ai_api_key

TRANSLATION_ENABLED=false
TRANSLATION_PROVIDER=google
TRANSLATION_API_KEY=your_translation_api_key
TRANSLATION_LANGUAGES=en,es,fr,de
```

### **Forward Configurations** (`config/env.js`)
```javascript
module.exports = {
  botToken: process.env.BOT_TOKEN,
  debugMode: true,
  
  // Control bot message forwarding
  forwardBotMessages: true, // Set to false to ignore bot messages
  
  // Forward configurations
  forwardConfigs: [
    {
      id: 1,
      name: "Announcements to General",
      sourceType: "discord",
      sourceServerId: "SOURCE_SERVER_ID",
      sourceChannelId: "SOURCE_CHANNEL_ID",
      targetType: "discord",
      targetServerId: "TARGET_SERVER_ID",
      targetChannelId: "TARGET_CHANNEL_ID",
      enabled: true,
      allowEveryoneHereMentions: false, // Allow @everyone/@here forwarding
      createdBy: "USER_ID"
    }
  ]
};
```

---

## 📁 Project Structure

```
ProForwarder-Discord-Bot/
├── 📁 config/                    # Configuration files
│   ├── .env.example              # Environment variables template
│   ├── env.js.example            # Configuration template
│   └── env.js                   # Active configuration
├── 📁 utils/                     # Core utilities
│   ├── database.js               # SQLite database operations with smart cleanup
│   ├── logger.js                 # Colorized logging system
│   ├── configManager.js          # File-based config management
│   ├── webhookManager.js         # Webhook handling for perfect forwarding
│   ├── applicationEmojiManager.js # Cross-server emoji management
│   └── emojiManager.js           # Legacy emoji utilities
├── 📁 handlers/                  # Business logic
│   └── forwardHandler.js         # Main forwarding logic with webhooks
├── 📁 events/                    # Discord event handlers
│   └── messageEvents.js          # Message create/edit/delete handling with debug
├── 📁 commands/                  # Slash commands
│   ├── proforwardCommand.js      # Main command interface
│   └── debugCommands.js          # Debug and troubleshooting commands
├── 📁 data/                     # Database storage
│   └── proforwarder.db          # SQLite database with message logs
├── 📄 index.js                  # Main bot entry point with startup validation
├── 📄 errorHandlers.js          # Global error handling
└── 📄 PROFORWARDER_PLANNING.md  # Complete development documentation
```

---

## 🔧 Technology Stack

- **🟢 Node.js** - Runtime environment
- **🔵 Discord.js v14** - Discord API wrapper with webhook support
- **🗃️ SQLite3** - Database for message logs and tracking
- **🎭 Webhook Technology** - Perfect 1:1 message forwarding
- **🎨 Chalk** - Colorized console logging
- **⚙️ dotenv** - Environment configuration management
- **📝 File-based Configs** - Human-readable configuration system

---

## 📝 Documentation

- **[📋 Planning Document](PROFORWARDER_PLANNING.md)** - Development history and architecture
- **[🔧 Configuration Guide](config/env.js.example)** - Configuration options and examples
- **[🗃️ Database Schema](utils/database.js)** - Database structure for message logging

---

## 🤝 Contributing

This project uses established coding patterns and modular architecture:

- Use the logging system (`utils/logger.js`) for consistent output
- Follow the modular file structure for maintainability
- Maintain the webhook-first forwarding approach
- Add appropriate error handling and user feedback
- Test both same-server and cross-server scenarios

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with ❤️ for seamless Discord communication**

*Perfect 1:1 message forwarding • Universal emoji support • Enterprise ready*

</div>
