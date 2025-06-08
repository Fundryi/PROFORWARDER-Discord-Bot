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
    - [🔒 Required Bot Permissions](#-required-bot-permissions)
      - [**Bot Permissions (All Features):**](#bot-permissions-all-features)
      - [**User Permissions (For setup commands):**](#user-permissions-for-setup-commands)
      - [**Bot Invite Link:**](#bot-invite-link)
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
- **🔪 Enhanced Slice Conversion**: Advanced formatting converter with 200+ Discord emoji mappings
- **👥 Smart Mention Resolution**: Real Discord names for users, roles, and channels in Telegram
- **😀 Universal Emoji Support**: Application-level emoji management for cross-server emoji compatibility
- **🎯 Conservative Emoji Matching**: Only converts known emojis, cleanly removes unknown ones
- **📢 Smart Mention Control**: Configurable @everyone/@here forwarding with permission-based safety
- **🧹 Intelligent Database**: Self-maintaining database with startup validation and orphaned message cleanup
- **🔄 Smart Loop Prevention**: Advanced detection to prevent infinite forwarding loops
- **🔒 Permission Validation**: Automatic permission checking and helpful error messages
- **📊 Quality Detection**: Automatically detects and uses optimal forwarding method
- **🔧 Fallback Support**: Works with basic permissions when webhooks unavailable
- **📋 Easy Management**: Simple command structure for setup and maintenance
- **🐛 Advanced Debugging**: Comprehensive logging and monitoring for troubleshooting
- **🔄 Message Retry System**: Retry failed message forwards with `/proforward retry`
- **📢 Auto-Publishing**: Automatic publishing for announcement channels
- **🔍 Telegram Discovery**: Smart discovery of available Telegram chats and channels
- **🤖 AI Translation Support**: Optional multi-provider AI translation system (Google Gemini, OpenAI GPT-4, DeepL)
- **🧵 Translation Threads**: Beautiful Discord threads for AI translations with color-coded language indicators
- **📖 Reader Bot Support**: Optional secondary bot instance for read-only message monitoring and processing

---

## 🏗️ Current Status

### 🚀 **Enterprise Ready with Enhanced Format Conversion**
The ProForwarder Discord Bot is a fully-featured, enterprise-grade message forwarding solution offering:

- **Perfect webhook-based forwarding** with 1:1 message preservation and edit synchronization
- **Enhanced slice-based format conversion** with intelligent Discord→Telegram MarkdownV2 processing
- **Smart mention resolution** with real Discord names (users, roles, channels) in Telegram
- **Advanced emoji handling** with 200+ Discord emoji mappings and conservative matching
- **Comprehensive command system** with 9 `/proforward` subcommands for complete management
- **Telegram Bot API integration** with full MarkdownV2 formatting and chat discovery
- **Modular Telegram architecture** with specialized handlers for API, media, text splitting, and utilities
- **Smart caption length management** with intelligent text splitting and anti-spam solutions
- **Auto-publishing system** for announcement channels with configurable timing
- **Message retry functionality** for failed forwards with source message ID lookup
- **Optional Reader Bot support** for read-only message monitoring and processing
- **Intelligent database management** with self-healing, validation, and cleanup capabilities
- **Smart loop prevention** and bot message filtering with configurable controls
- **Cross-platform emoji conversion** with application-level emoji management
- **Same-server and cross-server** Discord forwarding fully functional
- **Optional AI translation system** with multi-provider support (Google Gemini, OpenAI GPT-4, DeepL)
- **Beautiful translation threads** with color-coded language indicators (when AI enabled)
- **File-based configuration** with automatic management via Discord commands
- **Comprehensive error handling** and user guidance with helpful error messages
- **Advanced debugging and monitoring** system with colorized logging
- **Production-ready architecture** with robust error handling and cleanup systems

---

## ⚡ Getting Started

### 📋 Prerequisites

- **Node.js** v16.11.0 or higher (required for Discord.js v14)
- **npm** or **yarn** package manager
- **Discord Bot Token** from [Discord Developer Portal](https://discord.com/developers/applications)

### 🔒 Required Bot Permissions

ProForwarder requires specific permissions to function with all features. **Administrator permission is NOT required** - only these permissions:

#### **Bot Permissions (All Features):**
- **View Channels** - To see source and target channels
- **Send Messages** - To forward messages
- **Embed Links** - For rich message forwarding and translation embeds
- **Attach Files** - To forward attachments and media
- **Read Message History** - To process message edits and deletions
- **Manage Webhooks** - For perfect 1:1 message forwarding (preserves original usernames/avatars)
- **Create Public Threads** - For AI translation threads feature
- **Mention Everyone** - To forward @everyone/@here mentions
- **Manage Messages** - Required for auto-publishing announcement channels

#### **User Permissions (For setup commands):**
- **Manage Channels** - Required for users to use `/proforward` commands

#### **Bot Invite Link:**
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_ID&permissions=34896858112&scope=bot%20applications.commands
```

Replace `YOUR_BOT_ID` with your bot's client ID from the Discord Developer Portal.

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
   
   # Edit .env with your Discord bot token and optional services
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
/proforward telegram-discover username:@channelname
/proforward telegram-discover username:https://t.me/channelname

# Set up forwarding using discovered chat ID
/proforward telegram source:#announcements chat_id:-1001234567890
```

**Auto-Publishing Setup:**
```
# Enable auto-publishing for announcement channel (current server)
/proforward auto-publish channel:#announcements

# Enable auto-publishing for announcement channel (different server)
/proforward auto-publish channel:#announcements server:812312654705328154
```

**Message Management:**
```
# Retry a failed forward using original message ID
/proforward retry source_message_id:1234567890123456789

# Test Telegram connection
/proforward test chat_id:-1001234567890

# List all active configurations
/proforward list

# Remove a configuration
/proforward remove config_id:5
```

### 📋 Available Commands

- **`/proforward setup`** - Set up message forwarding between Discord channels
- **`/proforward telegram`** - Set up message forwarding from Discord to Telegram
- **`/proforward telegram-discover`** - Automatically discover available Telegram chats
- **`/proforward list`** - List all active forward configurations
- **`/proforward remove`** - Remove a forward configuration
- **`/proforward status`** - Show bot status and integration status
- **`/proforward test`** - Test Telegram connection
- **`/proforward retry`** - Retry/repost a forwarded message with source message ID
- **`/proforward auto-publish`** - Configure auto-publishing for announcement channels

---

## ⚙️ Configuration

### **Environment Variables** (`.env`)
```env
# Bot Token
BOT_TOKEN=your_discord_bot_token_here

# AI Provider API Keys (Only secrets here - configuration is in env.js)

# Google Gemini 2.0 Flash Preview (🟢 FREE) - MAIN PROVIDER
# Best for: High-quality AI translations with context understanding
# FREE during preview period - see: https://ai.google.dev/gemini-api/docs/pricing
# Get your FREE API key from: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# Google Translate Configuration (🟡 FREEMIUM - Free tier: 500,000 chars/month) - FALLBACK
# Best for: Fast, reliable fallback translations
# Get your API key from: https://cloud.google.com/translate/pricing
GOOGLE_TRANSLATE_API_KEY=your_google_translate_api_key_here
GOOGLE_PROJECT_ID=your_google_cloud_project_id

# Reader Bot Configuration (Optional)
READER_BOT_ENABLED=false
READER_BOT_TOKEN=your_reader_bot_token_here

# Telegram Integration (Optional)
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
```

### **Forward Configurations** (`config/env.js`)
```javascript
module.exports = {
  botToken: process.env.BOT_TOKEN,
  debugMode: false, // Set to true to enable debug logging and test commands
  
  // Enhanced Format Conversion Settings (streamlined system)
  useSliceFormatConverter: true,  // Enhanced slice-based conversion (PRIMARY METHOD - recommended)
  useAIFormatConverter: false,    // AI-powered conversion (FALLBACK ONLY - for future use)
  
  // Bot message forwarding control
  forwardBotMessages: true, // Set to false to ignore messages from other bots
  
  // Forward configurations - Automatically populated by bot via /proforward commands
  // Do not manually edit this array - use Discord commands instead
  forwardConfigs: [],
  
  // Auto-publish channels configuration
  // Channels configured for automatic publishing of announcements
  // Automatically populated by bot via /proforward auto-publish commands
  autoPublishChannels: {},
  
  // Discord integration settings
  discord: {
    // Cached invite links for source headers (automatically managed)
    // Do not manually edit - the bot manages these automatically
    cachedInvites: {
      // Example: "123456789": { invite: "https://discord.gg/abc123", isVanity: false, expiresAt: null }
    }
  },
  
  // Reader Bot Configuration (optional)
  readerBot: {
    enabled: process.env.READER_BOT_ENABLED === 'true',
    token: process.env.READER_BOT_TOKEN
  },
  
  // Telegram integration (optional)
  telegram: {
    enabled: false, // Set to true to enable Telegram integration
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    apiUrl: process.env.TELEGRAM_API_URL || 'https://api.telegram.org',
    hideSourceHeader: false, // Set to true to disable Discord source headers in Telegram messages
    smartLinkPreviews: true, // Smart link preview behavior: allow previews when Discord has images, disable for text-only messages
    
    // Smart Caption Length Management (Anti-Spam Solution)
    captionLengthLimit: 900, // Safe caption length limit (Telegram limit is 1024, we use 900 for safety)
    textLengthLimit: 4000, // Safe text message length limit (Telegram limit is 4096, we use 4000 for safety)
    splitIndicator: '...(continued)', // Text to indicate message continues in next message
    captionSplitStrategy: 'smart' // 'smart' = intelligent splitting, 'separate' = send media separately (header + full text)
  },
  
  // AI Integration for translation and content optimization
  ai: {
    enabled: false, // Set to true to enable AI features
    
    // Provider configurations (API keys from .env file)
    providers: {
      // Google Gemini (🟡 FREEMIUM - Free tier available)
      // Best for: Advanced AI format conversion and translations
      // Cost: Free tier available, pay per token after limits
      gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: 'gemini-2.0-flash-exp',
        maxTokens: 2048,
        temperature: 0 // Conservative for formatting precision
      },
      
      // OpenAI GPT-4 (💰 PAID SERVICE - Requires payment after free trial)
      // Best for: High-quality translations, content optimization
      // Cost: Pay per token (approximately $0.03/1K tokens for GPT-4)
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4', // or 'gpt-3.5-turbo' for cheaper option
        maxTokens: 2000,
        temperature: 0.3 // Lower = more conservative, Higher = more creative
      },
      
      // DeepL (🟡 FREEMIUM - Free tier: 500,000 chars/month)
      // Best for: Professional-grade translation quality
      // Cost: Free tier available, then $6.99/month for Pro
      deepl: {
        apiKey: process.env.DEEPL_API_KEY,
        freeApi: true // Set to false if using DeepL Pro API
      }
    },
    
    // Translation settings
    translation: {
      enabled: true, // Enable translation features
      defaultProvider: 'gemini', // Recommended: 'gemini' (free tier) or 'deepl'
      cacheTranslations: true, // Cache translations to reduce API costs
      maxCacheAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
      fallbackProvider: 'deepl' // Fallback if primary provider fails
    },
    
    // Content optimization settings
    optimization: {
      defaultLevel: 'enhanced', // 'basic', 'enhanced', 'custom'
      preserveEmojis: true,
      preserveMentions: true,
      preserveLinks: true,
      maxOptimizationLength: 2000
    }
  }
};
```

---

## 📁 Project Structure

```
ProForwarder-Discord-Bot/
├── 📁 config/                    # Configuration files
│   ├── .env.example              # Environment variables template
│   └── env.js.example            # Configuration template
├── 📁 utils/                     # Core utilities
│   ├── database.js               # SQLite database operations with smart cleanup
│   ├── logger.js                 # Colorized logging system
│   ├── configManager.js          # File-based config management
│   ├── webhookManager.js         # Webhook handling for perfect forwarding
│   ├── sliceFormatConverter.js   # Enhanced slice-based format conversion (PRIMARY)
│   ├── aiFormatConverter.js      # AI-powered format conversion orchestrator
│   ├── formatConverter.js        # Legacy format converter
│   ├── applicationEmojiManager.js # Cross-server emoji management
│   ├── aiManager.js              # AI provider abstraction and management
│   ├── translationManager.js     # Multi-language translation orchestration
│   ├── threadManager.js          # Discord thread creation and management
│   ├── discordInviteManager.js   # Discord invite management for source headers
│   └── emojiManager.js           # Legacy emoji utilities
├── 📁 utils/ai/                  # AI Provider implementations
│   ├── geminiProvider.js         # Google Gemini AI provider
│   ├── googleProvider.js         # Google AI provider (alternative)
│   ├── openaiProvider.js         # OpenAI GPT provider
│   └── deeplProvider.js          # DeepL translation provider
├── 📁 handlers/                  # Business logic
│   ├── forwardHandler.js         # Main forwarding logic with webhooks
│   ├── aiHandler.js              # AI processing orchestrator
│   ├── telegramHandler.js        # Telegram Bot API integration
│   └── 📁 telegram/              # Telegram handler modules
│       ├── telegramAPI.js        # Core Telegram API wrapper
│       ├── telegramConverter.js  # Format conversion for Telegram
│       ├── telegramMediaHandler.js # Media handling and processing
│       ├── telegramMessageSender.js # Message sending logic
│       ├── telegramTextSplitter.js # Smart text splitting for length limits
│       └── telegramUtils.js      # Telegram utility functions
├── 📁 events/                    # Discord event handlers
│   └── messageEvents.js          # Message create/edit/delete handling with debug
├── 📁 commands/                  # Slash commands
│   ├── proforwardCommand.js      # Main command interface
│   ├── debugCommands.js          # Debug and troubleshooting commands
│   ├── configCommands.js         # Configuration management commands
│   ├── forwardCommands.js        # Forward-specific commands
│   └── helpCommands.js           # Help and documentation commands
├── 📁 data/                     # Database storage
│   └── proforwarder.db          # SQLite database with message logs
├── 📁 Documentations/            # Project documentation
│   ├── ENHANCED_FORMAT_CONVERSION.md     # Format conversion system guide
│   ├── MARKDOWN_DISCORD.md               # Discord markdown reference
│   ├── MARKDOWN_TELEGRAM.md              # Telegram markdown reference
│   ├── MARKDOWNV2_CONVERSION_SUMMARY.md  # Conversion details
│   ├── PROFORWARDER_PLANNING.md          # Development planning
│   ├── READER_BOT_IMPLEMENTATION.md      # Reader Bot documentation
│   ├── TELEGRAM_CAPTION_LENGTH_SOLUTION.md # Telegram caption handling
│   └── TELEGRAM_HANDLER_REFACTORING_PLAN.md # Telegram refactoring guide
├── 📁 testing/                  # Testing utilities
├── 📄 index.js                  # Main bot entry point with startup validation
├── 📄 readerBot.js              # Optional reader bot for read-only monitoring
├── 📄 errorHandlers.js          # Global error handling
├── 📄 package.json              # Node.js project configuration
└── 📄 README.md                 # This documentation file
```

---

## 🔧 Technology Stack

- **🟢 Node.js** - Runtime environment
- **🔵 Discord.js v14** - Discord API wrapper with webhook support
- **📱 Telegram Bot API** - Cross-platform message forwarding with MarkdownV2
- **🔪 Enhanced Slice Conversion** - Advanced formatting system with 200+ emoji mappings
- **👥 Smart Mention Resolution** - Real Discord name resolution for cross-platform forwarding
- **🤖 AI Integration** - Multi-provider AI translation system with fallback support
- **🌐 Google Gemini 2.0 Flash** - Primary AI provider for translations (FREE tier)
- **🧠 OpenAI GPT-4** - Advanced AI content processing
- **🔤 DeepL API** - Professional translation quality
- **📖 Reader Bot Architecture** - Optional secondary bot instance for read-only monitoring
- **🗃️ SQLite3** - Database for message logs and tracking
- **🎭 Webhook Technology** - Perfect 1:1 message forwarding
- **🧵 Discord Threads** - Native threading for translations
- **📊 Modular Telegram System** - Refactored handler architecture with specialized modules
- **📏 Smart Text Splitting** - Intelligent message length management for Telegram
- **⚙️ Streamlined Architecture** - Optimized dual-method format conversion system
- **🎨 Chalk** - Colorized console logging
- **⚙️ dotenv** - Environment configuration management
- **📝 File-based Configs** - Human-readable configuration system

---

## 📝 Documentation

- **[📋 Planning Document](Documentations/PROFORWARDER_PLANNING.md)** - Development history and architecture
- **[🔪 Enhanced Format Conversion](Documentations/ENHANCED_FORMAT_CONVERSION.md)** - Advanced formatting system guide
- **[📊 MarkdownV2 Conversion Summary](Documentations/MARKDOWNV2_CONVERSION_SUMMARY.md)** - Telegram formatting details
- **[📖 Reader Bot Implementation](Documentations/READER_BOT_IMPLEMENTATION.md)** - Reader Bot setup and usage guide
- **[📱 Telegram Caption Length Solution](Documentations/TELEGRAM_CAPTION_LENGTH_SOLUTION.md)** - Telegram message length handling
- **[🔧 Telegram Handler Refactoring](Documentations/TELEGRAM_HANDLER_REFACTORING_PLAN.md)** - Telegram system architecture
- **[💬 Discord Markdown Reference](Documentations/MARKDOWN_DISCORD.md)** - Discord formatting reference
- **[📨 Telegram Markdown Reference](Documentations/MARKDOWN_TELEGRAM.md)** - Telegram formatting reference
- **[⚙️ Configuration Guide](config/env.js.example)** - Configuration options and examples
- **[🗃️ Database Schema](utils/database.js)** - Database structure for message logging

---


## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with ❤️ for seamless cross-platform communication**

*Perfect 1:1 message forwarding • Enhanced format conversion • Smart mention resolution • AI translation threads • Universal emoji support • Enterprise ready*

</div>
