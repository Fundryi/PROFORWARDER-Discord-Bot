# Reader Bot Implementation Guide

## Overview

This document describes how to implement a second Discord bot with read-only permissions that monitors channels and sends message data to the main ProForwarder bot for processing. This reader bot can be invited to servers where you want forwarding capabilities but don't want to grant sending permissions.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Implementation Steps](#implementation-steps)
3. [Configuration](#configuration)
4. [Code Structure](#code-structure)
5. [Security Considerations](#security-considerations)
6. [Usage Examples](#usage-examples)
7. [Troubleshooting](#troubleshooting)

## Architecture Overview

### Current Bot Structure
- **Main Bot**: Full permissions, handles commands, forwarding, and user interactions
- **Reader Bot** (New): Read-only permissions, sends message data to main bot for forwarding

### Reader Bot Responsibilities
- Join Discord servers with minimal read-only permissions
- Monitor specified channels for message content
- Send message data to main bot for processing and forwarding
- No command handling or user interactions
- No message sending capabilities - pure read-only operation

### Permission Requirements for Reader Bot
- `View Channels` - To see channel lists
- `Read Message History` - To access previous messages
- **NO** sending, webhook, or administrative permissions - read-only access only

## Implementation Steps

### Step 1: Create New Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application named "ProForwarder Reader Bot"
3. Go to the "Bot" section
4. Create a bot user
5. Copy the bot token for configuration
6. Under "Privileged Gateway Intents":
   - Enable "Message Content Intent" (required for reading message content)
   - Keep other intents disabled for minimal permissions

### Step 2: Bot Invite Setup

Generate an invite link with read-only permissions:
```
https://discord.com/oauth2/authorize?client_id=YOUR_READER_BOT_CLIENT_ID&permissions=66560&scope=bot

Permissions breakdown (66560):
- View Channels (1024)
- Read Message History (65536)
```

### Step 3: Environment Configuration

Add to [`config/.env`](config/.env):
```env
# Reader Bot Configuration
READER_BOT_ENABLED=false
READER_BOT_TOKEN=your_reader_bot_token_here
```

Add to [`config/env.js`](config/env.js):
```javascript
module.exports = {
  // ... existing configuration
  
  // Reader Bot Configuration
  readerBot: {
    enabled: process.env.READER_BOT_ENABLED === 'true',
    token: process.env.READER_BOT_TOKEN
  }
};
```

## Code Structure

### Step 4: Create Reader Bot Client

Create [`readerBot.js`](readerBot.js) in the root directory:

```javascript
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: './config/.env' });
require("./errorHandlers");

const { Client, GatewayIntentBits } = require("discord.js");
const { logInfo, logSuccess, logError } = require('./utils/logger');
const config = require('./config/env');

class ReaderBot {
  constructor(mainBotInstance) {
    this.client = null;
    this.isReady = false;
    this.mainBot = mainBotInstance; // Reference to main bot for forwarding data
  }

  async initialize() {
    if (!config.readerBot.enabled) {
      logInfo('Reader Bot is disabled in configuration');
      return false;
    }

    if (!config.readerBot.token) {
      logError('Reader Bot token not provided');
      return false;
    }

    try {
      logInfo('Reader Bot is starting up...');
      
      // Create client with minimal intents for reading only
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent
        ],
        presence: {
          status: 'invisible', // Stay invisible to minimize presence
          activities: []
        }
      });

      this.setupEventHandlers();
      await this.client.login(config.readerBot.token);
      
      return true;
    } catch (error) {
      logError('Failed to initialize Reader Bot:', error);
      return false;
    }
  }

  setupEventHandlers() {
    this.client.on("messageCreate", async (message) => {
      await this.handleMessageRead(message);
    });

    this.client.on("messageUpdate", async (oldMessage, newMessage) => {
      await this.handleMessageUpdate(oldMessage, newMessage);
    });

    this.client.on("messageDelete", async (message) => {
      await this.handleMessageDelete(message);
    });

    this.client.on("ready", async () => {
      this.isReady = true;
      logSuccess(`Reader Bot logged in as ${this.client.user.tag}`);
      logInfo(`Reader Bot monitoring ${this.client.guilds.cache.size} servers`);
      logInfo('Reader Bot ready to read messages (read-only mode)');
    });

    this.client.on('guildCreate', (guild) => {
      logInfo(`Reader Bot joined new guild: ${guild.name} (${guild.id})`);
    });

    this.client.on('guildDelete', (guild) => {
      logInfo(`Reader Bot left guild: ${guild.name} (${guild.id})`);
    });

    this.client.on('error', (error) => {
      logError('Reader Bot error:', error);
    });

    this.client.on('disconnect', () => {
      logInfo('Reader Bot disconnected');
      this.isReady = false;
    });
  }

  async handleMessageRead(message) {
    // Skip bot messages and system messages
    if (message.author.bot || message.system) return;

    // Create message data object
    const messageData = {
      id: message.id,
      content: message.content,
      author: {
        id: message.author.id,
        username: message.author.username,
        displayName: message.author.displayName,
        avatar: message.author.displayAvatarURL()
      },
      channel: {
        id: message.channel.id,
        name: message.channel.name,
        type: message.channel.type
      },
      guild: {
        id: message.guild?.id,
        name: message.guild?.name
      },
      timestamp: message.createdTimestamp,
      attachments: message.attachments.map(att => ({
        id: att.id,
        url: att.url,
        name: att.name,
        size: att.size,
        contentType: att.contentType
      })),
      embeds: message.embeds,
      hasThread: message.hasThread,
      reference: message.reference ? {
        messageId: message.reference.messageId,
        channelId: message.reference.channelId,
        guildId: message.reference.guildId
      } : null
    };

    // Send message data to main bot for processing
    await this.sendToMainBot('messageCreate', messageData, message);
  }

  async handleMessageUpdate(oldMessage, newMessage) {
    if (newMessage.author?.bot || newMessage.system) return;

    const updateData = {
      id: newMessage.id,
      oldContent: oldMessage.content,
      newContent: newMessage.content,
      editedTimestamp: newMessage.editedTimestamp,
      channel: {
        id: newMessage.channel.id,
        name: newMessage.channel.name
      },
      guild: {
        id: newMessage.guild?.id,
        name: newMessage.guild?.name
      }
    };

    await this.sendToMainBot('messageUpdate', updateData, newMessage);
  }

  async handleMessageDelete(message) {
    if (message.author?.bot || message.system) return;

    const deleteData = {
      id: message.id,
      content: message.content,
      channel: {
        id: message.channel.id,
        name: message.channel.name
      },
      guild: {
        id: message.guild?.id,
        name: message.guild?.name
      }
    };

    await this.sendToMainBot('messageDelete', deleteData, message);
  }

  async sendToMainBot(eventType, data, originalMessage) {
    try {
      // Import the main bot's message handlers
      const { handleMessageCreate, handleMessageUpdate, handleMessageDelete } = require('./events/messageEvents');
      
      // Process the message through main bot's logic using the reader bot's data
      switch (eventType) {
        case 'messageCreate':
          await handleMessageCreate(originalMessage, this.mainBot);
          break;
        case 'messageUpdate':
          // For updates, we need the old and new message objects
          // This is a simplified approach - you might need to reconstruct the old message
          await handleMessageUpdate(originalMessage, originalMessage, this.mainBot);
          break;
        case 'messageDelete':
          await handleMessageDelete(originalMessage, this.mainBot);
          break;
      }
    } catch (error) {
      logError('Error sending data to main bot:', error);
    }
  }

  // Simple status methods
  isInGuild(guildId) {
    return this.client?.guilds.cache.has(guildId) || false;
  }

  getGuildCount() {
    return this.client?.guilds.cache.size || 0;
  }

  async shutdown() {
    if (this.client) {
      await this.client.destroy();
      logInfo('Reader Bot shutdown complete');
    }
  }
}

module.exports = ReaderBot;
```

### Step 5: Integrate with Main Bot

Modify [`index.js`](index.js) to include the reader bot:

```javascript
// Add at the top with other imports
const ReaderBot = require('./readerBot');

// Add after client initialization
let readerBot = null;

// Add in the ready event handler
client.on("ready", async () => {
  // ... existing code ...
  
  // Initialize Reader Bot if enabled (pass main bot client as reference)
  if (config.readerBot.enabled) {
    logInfo('Initializing Reader Bot...');
    try {
      readerBot = new ReaderBot(client); // Pass main bot client
      const success = await readerBot.initialize();
      if (success) {
        logSuccess('Reader Bot initialized successfully');
      } else {
        logWarn('Reader Bot initialization failed');
      }
    } catch (error) {
      logError('Error initializing Reader Bot:', error);
    }
  }
  
  // ... rest of existing code ...
});

// Add to shutdown handler
process.on('SIGINT', async () => {
  logInfo('\nShutting down bots...');
  
  if (readerBot) {
    await readerBot.shutdown();
  }
  
  // ... existing database cleanup code ...
});

// Export reader bot for use in other modules
module.exports = { client, readerBot };
```

### Step 6: Add Reader Bot Status Command

Add reader bot status to [`commands/proforwardCommand.js`](commands/proforwardCommand.js):

```javascript
// Add new subcommand for reader bot status
{
  name: 'reader-status',
  description: 'Check reader bot status and generate invite link',
  type: 1 // SUB_COMMAND
}
```

And in the command handler:
```javascript
} else if (subcommand === 'reader-status') {
  const { readerBot } = require('../index');
  
  if (!config.readerBot.enabled) {
    return await interaction.reply({
      content: '❌ Reader Bot is disabled in configuration.',
      ephemeral: true
    });
  }
  
  const status = readerBot && readerBot.isReady ? '🟢 Online' : '🔴 Offline';
  const guildCount = readerBot ? readerBot.getGuildCount() : 0;
  
  const clientId = 'YOUR_READER_BOT_CLIENT_ID'; // Replace with actual client ID
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=66560&scope=bot`;
  
  await interaction.reply({
    embeds: [{
      title: '🤖 Reader Bot Status',
      color: 0x00ff00,
      fields: [
        { name: 'Status', value: status, inline: true },
        { name: 'Servers', value: guildCount.toString(), inline: true },
        { name: 'Invite Link', value: `[Click here to invite](${inviteUrl})`, inline: false }
      ],
      footer: { text: 'Reader Bot - Read-only monitoring' }
    }],
    ephemeral: true
  });
}
```

## Required Command Modifications

### Update `/proforward setup` Command

The current command needs additional optional parameters to support reader bot configurations:

```javascript
.addSubcommand(subcommand =>
  subcommand
    .setName('setup')
    .setDescription('Set up message forwarding from one channel to another')
    .addChannelOption(option =>
      option
        .setName('source')
        .setDescription('Source channel to forward messages from (for local server)')
        .setRequired(false) // Make optional when using source_server
    )
    .addStringOption(option =>
      option
        .setName('source_server')
        .setDescription('Source server ID (when using reader bot in different server)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('source_channel_id')
        .setDescription('Source channel ID (when using reader bot in different server)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('target_channel')
        .setDescription('Target channel ID (use channel ID for cross-server, or #channel for same server)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('target_server')
        .setDescription('Target server ID (required for cross-server forwarding)')
        .setRequired(false)
    )
)
```

### Command Validation Logic

The handler needs to validate parameter combinations:

```javascript
async function handleSetup(interaction) {
  const sourceChannel = interaction.options.getChannel('source');
  const sourceServerId = interaction.options.getString('source_server');
  const sourceChannelId = interaction.options.getString('source_channel_id');
  const targetChannelInput = interaction.options.getString('target_channel');
  const targetServerId = interaction.options.getString('target_server');

  // Validate source parameters
  if (!sourceChannel && (!sourceServerId || !sourceChannelId)) {
    await interaction.reply({
      content: '❌ **Invalid source configuration!**\n\n**Options:**\n• **Local server:** Use `source:#channel`\n• **Reader bot server:** Use both `source_server:SERVER_ID` and `source_channel_id:CHANNEL_ID`',
      ephemeral: true
    });
    return;
  }

  if (sourceChannel && (sourceServerId || sourceChannelId)) {
    await interaction.reply({
      content: '❌ **Conflicting source parameters!**\n\nUse either:\n• `source:#channel` for local server\n• `source_server` + `source_channel_id` for reader bot server',
      ephemeral: true
    });
    return;
  }

  // Handle reader bot configuration
  if (sourceServerId && sourceChannelId) {
    // Validate that we have reader bot access to the source server
    const { readerBot } = require('../index');
    
    if (!readerBot || !readerBot.isInGuild(sourceServerId)) {
      await interaction.reply({
        content: `❌ **Reader bot not found in source server!**\n\nSource server: \`${sourceServerId}\`\n\n**Steps to fix:**\n1. Invite reader bot to source server\n2. Use \`/proforward reader-status\` to get invite link\n3. Ensure reader bot has read permissions in target channel`,
        ephemeral: true
      });
      return;
    }

    // Create configuration for reader bot source
    const newConfig = {
      name: `Reader Bot Forward: ${sourceChannelId} to ${targetChannelInput}`,
      sourceType: 'discord',
      sourceServerId: sourceServerId,
      sourceChannelId: sourceChannelId,
      targetType: 'discord',
      targetServerId: targetServerId || interaction.guild.id,
      targetChannelId: targetChannelInput,
      createdBy: interaction.user.id,
      useReaderBot: true // Flag to indicate this uses reader bot
    };

    const configId = await addForwardConfig(newConfig);
    
    await interaction.reply({
      content: `✅ **Reader bot forward configured!**\n**From:** Channel \`${sourceChannelId}\` in server \`${sourceServerId}\`\n**To:** ${targetChannelInput} in ${targetServerId ? `server \`${targetServerId}\`` : 'this server'}\n**ID:** ${configId}\n\n🤖 **Reader bot will monitor the source channel and forward messages to the main bot for processing.**`,
      ephemeral: false
    });

    return;
  }

  // Continue with existing logic for standard setup...
}
```

### Telegram Forwarding Support

The reader bot approach also works seamlessly with Telegram forwarding. You'll need to modify the `/proforward telegram` command similarly:

```javascript
.addSubcommand(subcommand =>
  subcommand
    .setName('telegram')
    .setDescription('Set up message forwarding from Discord channel to Telegram chat')
    .addChannelOption(option =>
      option
        .setName('source')
        .setDescription('Source Discord channel to forward messages from (for local server)')
        .setRequired(false) // Make optional when using source_server
    )
    .addStringOption(option =>
      option
        .setName('source_server')
        .setDescription('Source server ID (when using reader bot in different server)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('source_channel_id')
        .setDescription('Source channel ID (when using reader bot in different server)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('chat_id')
        .setDescription('Telegram chat ID (negative for groups/channels, positive for private chats)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('name')
        .setDescription('Custom name for this forward configuration')
        .setRequired(false)
    )
)
```

**Example scenarios:**

**Standard Telegram forwarding (main bot in source server):**
```
/proforward telegram source:#announcements chat_id:-1001234567890
```

**Reader bot Telegram forwarding (reader bot in source server):**
```
/proforward telegram source_server:SERVER3_ID source_channel_id:ANNOUNCEMENTS_CHANNEL_ID chat_id:-1001234567890
```

**Complete workflow:**
1. **Server3**: Reader bot monitors #announcements (read-only permissions)
2. **Server1**: Main bot receives command and creates configuration
3. **Flow**: Server3 Reader Bot → Server1 Main Bot → Telegram
4. **All existing Telegram features work**: Smart link previews, markdown conversion, file handling, etc.

This means you can have reader bots in multiple high-security servers all forwarding to your central Telegram channels, managed entirely through your main bot's commands.

## Security Considerations

### Bot Token Security
- Use environment variables, never hardcode tokens

### Permission Minimization
- Only request read-only permissions (View Channels, Read Message History)
- No sending, webhook, or administrative permissions

### Data Flow Security
- Reader bot only reads and passes data to main bot
- Main bot handles all outgoing operations
- No direct external communications from reader bot

### Rate Limiting
- Reader bot only reads messages (minimal API usage)
- Main bot handles all rate limiting for forwarding
- Reduced overall API load due to read-only operations

## Usage Examples

### Basic Setup
1. Create reader bot application in Discord Developer Portal
2. Configure environment variables (`READER_BOT_TOKEN`, `READER_BOT_ENABLED=true`)
3. Enable reader bot in configuration
4. Restart the main bot
5. Invite reader bot to target servers with read-only permissions
6. Configure forwarding using main bot's `/proforward` commands as usual

### Setting Up Cross-Server Forwarding with Reader Bot
With the reader bot approach, you need enhanced command parameters to configure forwarding from servers that only have the reader bot:

**Current `/proforward setup` command needs these additional parameters:**
```
/proforward setup
  source: #channel                          (existing - local channel)
  target_channel: CHANNEL_ID                (existing - destination channel ID)
  target_server: SERVER_ID                  (existing - destination server ID)
  source_server: SERVER_ID                  (NEW - source server ID for reader bot)
  source_channel_id: CHANNEL_ID             (NEW - source channel ID for reader bot)
```

**Example scenarios:**
1. **Standard setup (main bot in both servers):**
   ```
   /proforward setup source:#announcements target_channel:123456 target_server:789012
   ```

2. **Reader bot setup (reader bot in source server, main bot in destination):**
   ```
   /proforward setup source_server:SERVER3_ID source_channel_id:ANNOUNCEMENTS_CHANNEL_ID target_channel:SERVER1_CHANNEL_ID target_server:SERVER1_ID
   ```

**Workflow:**
1. Main bot (on Server1) receives the setup command
2. Configuration includes Server3 as source (where reader bot is present)
3. Reader bot on Server3 monitors the specified channel
4. When messages appear, reader bot forwards data to main bot
5. Main bot processes and forwards to Server1 destination

### Use Cases
- **High-security servers**: Invite reader bot with minimal permissions while main bot stays in control server
- **Cross-server monitoring**: Reader bots in multiple servers, main bot in central control server
- **Permission-sensitive environments**: Read-only access where full bot permissions aren't allowed

**Your Example Scenario:**
```
Server1: Main Bot (Core Bot) - Has full permissions, handles commands
Server2: Main Bot (Core Bot) - Has full permissions, handles commands
Server3: Reader Bot - Read-only permissions, monitors #announcements

Command to set up forwarding from Server3 to Server1:
/proforward setup source_server:SERVER3_ID source_channel_id:ANNOUNCEMENTS_CHANNEL_ID target_channel:SERVER1_CHANNEL_ID target_server:SERVER1_ID
```

This allows Server1's main bot to configure forwarding even though it's not present in Server3.

## Troubleshooting

### Common Issues

**Reader Bot Not Starting**
- Check token validity in `.env` file
- Verify `READER_BOT_ENABLED=true` in configuration
- Check console logs for specific errors

**Messages Not Being Read**
- Ensure reader bot has read permissions in target channels
- Verify reader bot is in the correct guilds
- Check if channels are configured for monitoring

**Data Not Reaching Main Bot**
- Verify main bot is running and accessible
- Check console logs for data transfer errors
- Ensure both bots are using same forwarding configurations

**Permission Issues**
- Verify reader bot only has read-only permissions
- Check server-specific permission overrides
- Ensure no additional permissions are granted accidentally

### Debug Mode
Enable debug logging by setting `debugMode: true` in main configuration.

### Monitoring
- Use `/proforward reader-status` command to check status
- Monitor console logs for reader bot activity
- Check guild membership through Discord Developer Portal

## Future Enhancements

### Possible Features
- Reader bot management commands in main bot
- Message queuing system for reliable data transfer
- Multiple reader bots reporting to single main bot
- Reader bot health monitoring and alerting
- Selective channel monitoring configuration
- Cross-server configuration management interface

### Scaling Considerations
- Multiple reader bots in different server groups
- Centralized data processing through main bot
- Load balancing of read operations
- Redundant reader bots for high availability
- Configuration synchronization between reader and main bots

---

**Note**: This implementation provides a true read-only Discord bot that monitors channels and sends message data to the main bot for processing. The reader bot has minimal permissions and performs no sending operations, making it ideal for permission-sensitive environments.