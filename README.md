<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white) ![Discord.js](https://img.shields.io/badge/Discord.js-5865F2?style=flat&logo=discord&logoColor=white) ![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white) ![dotenv](https://img.shields.io/badge/dotenv-ECD53F?style=flat) ![Chalk](https://img.shields.io/badge/Chalk-FF6B6B?style=flat) ![License](https://img.shields.io/badge/license-MIT-blue?style=flat)

---

# 📨 ProForwarder Discord Bot

**A powerful Discord bot for seamless message forwarding between channels, servers, and platforms with perfect 1:1 message preservation and AI-powered translation threads.**

*Perfect for communities that need reliable, native-looking message forwarding with automatic multi-language translation support and cross-platform integration.*

---

</div>

## 📖 Contents

- [📨 ProForwarder Discord Bot](#-proforwarder-discord-bot)
  - [📖 Contents](#-contents)
  - [🚀 Features](#-features)
    - [🎯 **Core Functionality**](#-core-functionality)
    - [🌟 **Advanced Features**](#-advanced-features)
  - [🏗️ Current Status](#️-current-status)
    - [🚀 **Enterprise Ready with Enhanced Format Conversion**](#-enterprise-ready-with-enhanced-format-conversion)
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
- **📱 Telegram Integration**: Forward Discord messages to Telegram chats/channels with advanced MarkdownV2 formatting
- **🔪 Enhanced Format Conversion**: Intelligent slice-based formatting with perfect Discord→Telegram conversion
- **🤖 Bot Message Support**: Forwards messages from other bots with subtle bot indicator
- **📁 Complete Content Preservation**: Text, embeds, attachments, stickers, and formatting perfectly preserved
- **⚡ Real-time Forwarding**: Instant message forwarding with webhook technology
- **✏️ Edit Synchronization**: Real-time message edit forwarding that updates existing forwarded messages

### 🌟 **Advanced Features**
- **🤖 AI Translation Threads**: Automatic multi-language translation with beautiful Discord threads
- **🌐 Multi-Provider AI**: OpenAI GPT-4, Google Gemini, DeepL integration with smart fallback
- **🔪 Enhanced Slice Conversion**: Advanced formatting converter with 200+ Discord emoji mappings
- **👥 Smart Mention Resolution**: Real Discord names for users, roles, and channels in Telegram
- **😀 Universal Emoji Support**: Application-level emoji management for cross-server emoji compatibility
- **🎯 Conservative Emoji Matching**: Only converts known emojis, cleanly removes unknown ones
- **🎨 Rich Translation Embeds**: Beautiful color-coded translation embeds with provider attribution
- **📢 Smart Mention Control**: Configurable @everyone/@here forwarding with permission-based safety
- **🧹 Intelligent Database**: Self-maintaining database with startup validation and orphaned message cleanup
- **🔄 Smart Loop Prevention**: Advanced detection to prevent infinite forwarding loops
- **⚙️ Streamlined Architecture**: Optimized dual-method system (Enhanced Slice + AI fallback)
- **🔒 Permission Validation**: Automatic permission checking and helpful error messages
- **📊 Quality Detection**: Automatically detects and uses optimal forwarding method
- **🔧 Fallback Support**: Works with basic permissions when webhooks unavailable
- **📋 Easy Management**: Simple command structure for setup and maintenance
- **🐛 Advanced Debugging**: Comprehensive logging and monitoring for troubleshooting

---

## 🏗️ Current Status

### 🚀 **Enterprise Ready with Enhanced Format Conversion**
The ProForwarder Discord Bot is a fully-featured, enterprise-grade message forwarding solution offering:

- **Perfect webhook-based forwarding** with 1:1 message preservation and edit synchronization
- **Enhanced slice-based format conversion** with intelligent Discord→Telegram MarkdownV2 processing
- **Smart mention resolution** with real Discord names (users, roles, channels) in Telegram
- **Advanced emoji handling** with 200+ Discord emoji mappings and conservative matching
- **AI-powered translation threads** with automatic multi-language support
- **Multi-provider AI integration** (OpenAI GPT-4, Google Gemini, DeepL)
- **Streamlined architecture** with optimized dual-method system (Enhanced Slice + AI fallback)
- **Beautiful translation embeds** with color-coded language indicators
- **Universal emoji support** with application-level emoji management and cross-server compatibility
- **Smart mention control** with configurable @everyone/@here forwarding
- **Intelligent database management** with self-healing and cleanup capabilities
- **Same-server and cross-server** forwarding fully functional
- **Bot message forwarding** with smart loop prevention
- **Complete command system** with `/proforward` interface
- **File-based configuration** for easy management with AI settings
- **Comprehensive error handling** and user guidance
- **Advanced debugging and monitoring** system
- **Enterprise-tested** and ready for production deployment with enhanced formatting

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

**Telegram Forwarding:**
```
# Discover available chats automatically
/proforward telegram-discover

# Discover specific channel by username (for channels where bot is admin)
/proforward telegram-discover username:@teastast123123
/proforward telegram-discover username:https://t.me/teastast123123

# Set up forwarding using discovered chat ID
/proforward telegram source:#announcements chat_id:-1001234567890
```

### 📋 Available Commands

- **`/proforward setup`** - Set up message forwarding between Discord channels
- **`/proforward telegram`** - Set up message forwarding from Discord to Telegram
- **`/proforward telegram-discover`** - Automatically discover available Telegram chats
- **`/proforward list`** - List all active forward configurations
- **`/proforward remove`** - Remove a forward configuration
- **`/proforward status`** - Show bot status and integration status
- **`/proforward test`** - Test Telegram connection

---

## ⚙️ Configuration

### **Environment Variables** (`.env`)
```env
BOT_TOKEN=your_discord_bot_token_here

# AI Translation Features (NEW!)
AI_ENABLED=true
GEMINI_API_KEY=your_gemini_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
DEEPL_API_KEY=your_deepl_api_key_here

# Telegram Integration
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

### **Forward Configurations** (`config/env.js`)
```javascript
module.exports = {
  botToken: process.env.BOT_TOKEN,
  debugMode: true,
  
  // Enhanced Format Conversion Settings (NEW!)
  useSliceFormatConverter: true,  // Enhanced slice-based conversion (PRIMARY)
  useAIFormatConverter: false,    // AI-powered conversion (FALLBACK - for future use)
  
  // Control bot message forwarding
  forwardBotMessages: true, // Set to false to ignore bot messages
  
  // Forward configurations with AI translation support
  forwardConfigs: [
    {
      id: 1,
      name: "Announcements with Translation",
      sourceType: "discord",
      sourceServerId: "SOURCE_SERVER_ID",
      sourceChannelId: "SOURCE_CHANNEL_ID",
      targetType: "discord",
      targetServerId: "TARGET_SERVER_ID",
      targetChannelId: "TARGET_CHANNEL_ID",
      enabled: true,
      allowEveryoneHereMentions: false, // Allow @everyone/@here forwarding
      createdBy: "USER_ID",
      
      // AI Translation Settings (NEW!)
      ai: {
        enabled: true,
        translation: {
          enabled: true,
          provider: 'gemini', // 'gemini', 'openai', 'deepl'
          targetLanguages: ['ru', 'zh'], // Russian, Chinese
          preserveFormatting: true
        }
      }
    },
    // Telegram forwarding example
    {
      id: 2,
      name: "Discord to Telegram Bridge",
      sourceType: "discord",
      sourceServerId: "SOURCE_SERVER_ID",
      sourceChannelId: "SOURCE_CHANNEL_ID",
      targetType: "telegram",
      targetChatId: "-1001234567890", // Telegram chat ID
      enabled: true,
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
│   ├── sliceFormatConverter.js   # Enhanced slice-based format conversion (PRIMARY)
│   ├── aiFormatConverter.js      # AI-powered format conversion orchestrator
│   ├── formatConverter.js        # Legacy format converter (REMOVED in streamlined system)
│   ├── applicationEmojiManager.js # Cross-server emoji management
│   ├── aiManager.js              # AI provider abstraction and management
│   ├── translationManager.js     # Multi-language translation orchestration
│   ├── threadManager.js          # Discord thread creation and management
│   └── emojiManager.js           # Legacy emoji utilities
├── 📁 utils/ai/                  # AI Provider implementations
│   ├── geminiProvider.js         # Google Gemini AI provider
│   ├── openaiProvider.js         # OpenAI GPT provider
│   └── deeplProvider.js          # DeepL translation provider
├── 📁 handlers/                  # Business logic
│   ├── forwardHandler.js         # Main forwarding logic with webhooks
│   ├── aiHandler.js              # AI processing orchestrator
│   └── telegramHandler.js        # Telegram Bot API integration
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
- **📱 Telegram Bot API** - Cross-platform message forwarding with MarkdownV2
- **🔪 Enhanced Slice Conversion** - Advanced formatting system with 200+ emoji mappings
- **👥 Smart Mention Resolution** - Real Discord name resolution for cross-platform forwarding
- **🤖 AI Integration** - Multi-provider AI translation system with fallback support
- **🌐 Google Gemini** - Primary AI provider for translations
- **🧠 OpenAI GPT-4** - Advanced AI content processing
- **🔤 DeepL API** - Professional translation quality
- **🗃️ SQLite3** - Database for message logs and tracking
- **🎭 Webhook Technology** - Perfect 1:1 message forwarding
- **🧵 Discord Threads** - Native threading for translations
- **⚙️ Streamlined Architecture** - Optimized dual-method format conversion system
- **🎨 Chalk** - Colorized console logging
- **⚙️ dotenv** - Environment configuration management
- **📝 File-based Configs** - Human-readable configuration system

---

## 📝 Documentation

- **[📋 Planning Document](PROFORWARDER_PLANNING.md)** - Development history and architecture
- **[🔪 Enhanced Format Conversion](Documentations/ENHANCED_FORMAT_CONVERSION.md)** - Advanced formatting system guide
- **[📊 MarkdownV2 Conversion Summary](Documentations/MARKDOWNV2_CONVERSION_SUMMARY.md)** - Telegram formatting details
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

**Built with ❤️ for seamless cross-platform communication**

*Perfect 1:1 message forwarding • Enhanced format conversion • Smart mention resolution • AI translation threads • Universal emoji support • Enterprise ready*

</div>
