const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: './config/.env' });
require("./errorHandlers");

const { Client, GatewayIntentBits } = require("discord.js");
const { logInfo, logSuccess, logError } = require('./utils/logger');
const config = require('./config/config');

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

    await this.sendToMainBot('messageUpdate', updateData, newMessage, oldMessage);
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

  async sendToMainBot(eventType, data, originalMessage, oldMessage) {
    try {
      // Import the main bot's message handlers
      const { handleMessageCreate, handleMessageUpdate, handleMessageDelete } = require('./events/messageEvents');

      // Process the message through main bot's logic using the reader bot's data
      switch (eventType) {
        case 'messageCreate':
          await handleMessageCreate(originalMessage, this.mainBot);
          break;
        case 'messageUpdate':
          // Pass the real oldMessage and newMessage (originalMessage) from the reader bot's Discord event
          await handleMessageUpdate(oldMessage, originalMessage, this.mainBot);
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