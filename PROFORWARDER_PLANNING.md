# ProForwarder Discord Bot - Planning & Architecture Document

## Project Overview
This document outlines the transformation of the current boost-announcement bot into a message forwarding bot that copies messages 1:1 between Discord channels/servers and optionally to Telegram channels.

## Current Architecture Analysis

### What We Keep (Blueprint Foundation)

#### ✅ Core Infrastructure
- **Package Structure**: Keep [`discord.js`](package.json:22), [`chalk`](package.json:20), [`dotenv`](package.json:22), [`sqlite3`](package.json:23), [`nodemon`](package.json:26)
- **Config System**: Maintain the [`config/`](config/) directory structure with [`env.js`](config/env.js.example) and [`.env`](config/.env.example) pattern
- **Database System**: Keep [`utils/database.js`](utils/database.js) architecture with SQLite and promisified operations
- **Logging System**: Maintain [`utils/logger.js`](utils/logger.js) with [`chalk`](utils/logger.js:1) formatting and timestamp functions
- **Error Handling**: Keep [`errorHandlers.js`](errorHandlers.js) pattern
- **File Structure**: Maintain [`utils/`](utils/), [`config/`](config/), [`events/`](events/), [`handlers/`](handlers/) organization
- **Entry Point**: Keep [`index.js`](index.js) startup sequence and configuration validation

#### ✅ Development Patterns
- **Modular Event Handling**: Keep event delegation pattern from [`events/eventHandlers.js`](events/eventHandlers.js:1)
- **Database Promisification**: Maintain [`run()`](utils/database.js:25), [`get()`](utils/database.js:34), [`all()`](utils/database.js:43) pattern
- **Logging Standards**: Keep [`logInfo()`](utils/logger.js:26), [`logSuccess()`](utils/logger.js:32), [`logError()`](utils/logger.js:38) conventions
- **Config Validation**: Maintain startup config file checks from [`index.js`](index.js:4-16)

### What We Remove (Current Bot-Specific)

#### ❌ Boost System Components
- **Commands**: Remove [`commands/proboostCommands.js`](commands/proboostCommands.js) entirely
- **Handlers**: Remove [`handlers/boostHandler.js`](handlers/boostHandler.js), [`handlers/pointsHandler.js`](handlers/pointsHandler.js), [`handlers/redeemHandler.js`](handlers/redeemHandler.js), [`handlers/setupHandler.js`](handlers/setupHandler.js)
- **Events**: Remove [`events/memberEvents.js`](events/memberEvents.js), [`events/systemTasks.js`](events/systemTasks.js)
- **Command Events**: Remove [`events/commands/`](events/commands/) directory entirely
- **Interaction Events**: Remove [`events/interactions/`](events/interactions/) directory entirely
- **Utils**: Remove [`events/utils/`](events/utils/) directory entirely

#### ❌ Database Schema
- **Tables**: Remove all current tables (users, servers, overflow_boosters, boost_history, milestone_rewards)
- **Business Logic**: Remove [`utils/pointManager.js`](utils/pointManager.js), [`utils/licenseManager.js`](utils/licenseManager.js)

#### ❌ Bot Intents
- **Current**: [`GuildMembers`](index.js:40), [`GuildPresences`](index.js:41) (boost tracking)
- **Remove**: Member and presence tracking intents

## New Architecture Design

### Core Requirements

#### 📋 Message Forwarding Features
1. **Discord to Discord**: Channel-to-channel forwarding within same server
2. **Cross-Server**: Channel forwarding between different Discord servers
3. **1:1 Copy**: Preserve exact formatting, embeds, attachments, reactions
4. **Real-time**: Instant message forwarding on message events

#### 📋 Telegram Integration (Optional)
1. **Discord to Telegram**: Forward Discord messages to Telegram channels
2. **Format Adaptation**: Convert Discord formatting to Telegram markdown
3. **Media Support**: Forward images, videos, files to Telegram

### New Database Schema

```sql
-- Forward configurations table
CREATE TABLE forward_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sourceType TEXT NOT NULL, -- 'discord' or 'telegram'
  sourceServerId TEXT,
  sourceChannelId TEXT NOT NULL,
  targetType TEXT NOT NULL, -- 'discord' or 'telegram'
  targetServerId TEXT,
  targetChannelId TEXT NOT NULL,
  isActive INTEGER DEFAULT 1,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- Message logs for tracking forwarded messages
CREATE TABLE message_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  originalMessageId TEXT NOT NULL,
  originalChannelId TEXT NOT NULL,
  originalServerId TEXT,
  forwardedMessageId TEXT,
  forwardedChannelId TEXT,
  forwardedServerId TEXT,
  configId INTEGER NOT NULL,
  forwardedAt INTEGER NOT NULL,
  FOREIGN KEY (configId) REFERENCES forward_configs(id)
);

-- Settings table for global bot configuration
CREATE TABLE bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
```

### New Config Structure

```javascript
// config/env.js
module.exports = {
  botToken: process.env.BOT_TOKEN,
  debugMode: false,
  
  // Telegram integration (optional)
  telegram: {
    enabled: process.env.TELEGRAM_ENABLED === 'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    apiUrl: process.env.TELEGRAM_API_URL || 'https://api.telegram.org'
  },
  
  // AI integration for smart formatting (optional)
  ai: {
    enabled: process.env.AI_ENABLED === 'true',
    provider: process.env.AI_PROVIDER, // 'openai', 'anthropic', etc.
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL || 'gpt-3.5-turbo'
  },
  
  // Translation service (optional)
  translation: {
    enabled: process.env.TRANSLATION_ENABLED === 'true',
    provider: process.env.TRANSLATION_PROVIDER, // 'google', 'deepl', etc.
    apiKey: process.env.TRANSLATION_API_KEY,
    targetLanguages: (process.env.TRANSLATION_LANGUAGES || 'en,es,fr,de').split(',')
  }
};
```

### New Required Intents

```javascript
// index.js - Updated intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions // For reaction forwarding
  ],
});
```

### New File Structure

```
handlers/
├── forwardHandler.js       # Core message forwarding logic
├── telegramHandler.js      # Telegram integration (optional)
├── configHandler.js        # Forward configuration management
└── translationHandler.js   # Translation service integration (optional)

events/
├── messageEvents.js        # Message create/update/delete events
├── reactionEvents.js       # Reaction add/remove events
└── configEvents.js         # Configuration change events

commands/
├── forwardCommands.js      # /forward setup, list, delete commands
├── configCommands.js       # Bot configuration commands
└── helpCommands.js         # Help and documentation

utils/
├── messageFormatter.js     # Format conversion between platforms
├── mediaHandler.js         # Handle attachments/embeds
└── permissionChecker.js    # Validate user permissions
```

## Implementation Phases

### Phase 0: Repository Blueprint Cleanup (Priority #1)
1. **Remove Boost Components**: Delete all boost-related files and code
2. **Clean Database**: Remove boost-specific database schemas and functions
3. **Update Intents**: Change from member tracking to message tracking intents
4. **Create Blueprint State**: Maintain only foundational architecture and patterns
5. **Update Package.json**: Clean name, description, and keywords for new purpose

### Phase 1: Core Foundation (Week 1)
1. **Implement New Database Schema**: Create forward configurations schema
2. **Basic Message Events**: Set up [`GuildMessages`](index.js:39) and [`MessageContent`](index.js:39) intent handling
3. **Core Commands**: Implement `/forward` command for basic setup
4. **Foundation Testing**: Ensure blueprint state works correctly

### Phase 2: Discord-to-Discord Forwarding (Week 2)
1. **Forward Handler**: Implement [`forwardHandler.js`](handlers/forwardHandler.js) for Discord-to-Discord
2. **Message Processing**: Handle text, embeds, attachments, reactions
3. **Configuration Management**: Store and manage forward configs in database
4. **Testing**: Comprehensive testing of same-server and cross-server forwarding

### Phase 3: Advanced Features (Week 3)
1. **Message Editing**: Handle message updates and deletions
2. **Reaction Forwarding**: Copy reactions between channels
3. **Bulk Forward**: Option to forward message history
4. **Admin Interface**: Enhanced commands for configuration

### Phase 4: Telegram Integration (Week 4)
1. **Telegram Bot Setup**: Implement [`telegramHandler.js`](handlers/telegramHandler.js)
2. **Format Conversion**: Discord markdown to Telegram formatting
3. **Media Forwarding**: Images, videos, files to Telegram
4. **Bidirectional Support**: Telegram to Discord (optional)

## Additional Feature Ideas

### 🤖 AI-Powered Features
1. **Smart Formatting**: Use AI to optimize message formatting for different platforms
2. **Content Summarization**: Generate summaries for long messages
3. **Spam Detection**: AI-powered spam filtering before forwarding
4. **Context Enhancement**: Add context or explanations to forwarded messages

### 🌐 Translation Features
1. **Auto-Translation Threads**: Create threads below main posts with translated content (e.g., "🇪🇸 Spanish - Translation")
2. **Multi-Language Thread Support**: Multiple translation threads per message for different languages
3. **Translation on Demand**: React with flag emojis to trigger translation threads
4. **Language Detection**: Automatically detect source language

### 🔧 Advanced Configuration
1. **Webhook Support**: Use webhooks for better message appearance
2. **Filter Rules**: Forward only messages matching certain criteria
3. **Schedule Forwarding**: Time-based forwarding rules
4. **User Whitelist/Blacklist**: Control which users' messages get forwarded

### 📊 Error Reporting
1. **Error Tracking**: Detailed error tracking and reporting for failed forwards
2. **Failure Notifications**: Alert administrators when forwarding fails
3. **Retry Mechanisms**: Automatic retry for failed message forwards
4. **Error Logs**: Comprehensive logging of all forwarding errors

### 🔐 Security Features
1. **Permission Validation**: Ensure users have rights to set up forwards
2. **Rate Limiting**: Prevent spam through forwarding
3. **Content Filtering**: Filter sensitive content before forwarding
4. **Audit Logging**: Log all configuration changes and forwards

## Package Dependencies

### Required Additions
```json
{
  "node-telegram-bot-api": "^0.61.0",  // Telegram integration
  "axios": "^1.6.0",                   // HTTP requests for APIs
  "sharp": "^0.32.0"                   // Image processing for media
}
```

### Optional AI/Translation Dependencies
```json
{
  "openai": "^4.20.0",                 // OpenAI API integration
  "@google-cloud/translate": "^8.0.0", // Google Translate
  "deepl-node": "^1.12.0"              // DeepL translation
}
```

## Migration Strategy

### 1. Repository Cleanup (Priority #1)
- [ ] Clean repository to blueprint state (remove all boost-related code)
- [ ] Keep only foundational architecture and coding patterns
- [ ] Preserve essential infrastructure: config system, logging, database architecture, file structure
- [ ] Create clean starting point while maintaining established development patterns

### 2. Database Migration
- [ ] Create backup of current database
- [ ] Implement database migration script
- [ ] Clear existing tables and create new schema
- [ ] Initialize default settings

### 3. Testing Strategy
- [ ] Unit tests for message forwarding logic
- [ ] Integration tests for Discord-to-Discord forwarding
- [ ] End-to-end tests with real Discord channels
- [ ] Performance testing for high-volume forwarding

### 4. Deployment
- [ ] Update environment variables and configuration
- [ ] Deploy to staging environment for testing
- [ ] Gradual rollout to production servers
- [ ] Monitor for issues and performance

## Success Metrics

### Core Functionality
- [ ] 100% message forwarding accuracy (content, formatting, attachments)
- [ ] <500ms average forwarding latency
- [ ] 99.9% forwarding success rate
- [ ] Support for all Discord message types (text, embeds, files, reactions)

### Additional Features
- [ ] Telegram integration with 95%+ formatting accuracy
- [ ] Translation feature with support for 10+ languages
- [ ] AI features with configurable quality settings
- [ ] Admin interface with comprehensive configuration options

---

*This document serves as the blueprint for transforming the current boost bot into a comprehensive message forwarding solution while maintaining the established coding patterns and infrastructure.*