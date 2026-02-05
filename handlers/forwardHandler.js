const { logInfo, logSuccess, logError } = require('../utils/logger');
const { logForwardedMessage, logMessageChain } = require('../utils/database');
const { getForwardConfigsForChannel } = require('../utils/configManager');
const { sendWebhookMessage, hasWebhookPermissions } = require('../utils/webhookManager');
const AIHandler = require('./aiHandler');
const TelegramHandler = require('./telegramHandler');

// Enhanced forward handler with advanced message processing
class ForwardHandler {
  constructor(client) {
    this.client = client;
    this.forwardQueue = new Map(); // For rate limiting and batching
    this.retryQueue = new Map(); // For failed messages
    this.aiHandler = new AIHandler(client);
    this.telegramHandler = new TelegramHandler();
    this.aiInitialized = false;
    this.telegramInitialized = false;
  }

  /**
   * Initialize the ForwardHandler with AI features
   */
  async initialize() {
    try {
      // Initialize AI handler
      this.aiInitialized = await this.aiHandler.initialize();
      if (this.aiInitialized) {
        logSuccess('ForwardHandler initialized with AI features');
      } else {
        logInfo('ForwardHandler initialized without AI features');
      }

      // Initialize Telegram handler
      this.telegramInitialized = await this.telegramHandler.initialize();
      if (this.telegramInitialized) {
        logSuccess('ForwardHandler initialized with Telegram support');
      } else {
        logInfo('ForwardHandler initialized without Telegram support');
      }
    } catch (error) {
      logError('Error initializing ForwardHandler features:', error);
      this.aiInitialized = false;
      this.telegramInitialized = false;
    }
  }

  // Main forwarding orchestrator
  async processMessage(message) {
    try {
      // Skip our own messages to prevent infinite loops
      if (message.author.id === this.client.user.id) return;
      
      // Skip webhook messages from ProForwarder to prevent loops
      if (message.webhookId && message.author.bot) {
        // Check if this is from a ProForwarder webhook
        try {
          const webhook = await message.fetchWebhook();
          if (webhook && webhook.name === 'ProForwarder') {
            return; // Skip our own webhook messages
          }
        } catch (error) {
          // If we can't fetch webhook info, assume it's safe to forward
        }
      }

      // Check if bot message forwarding is enabled
      const config = require('../config/env');
      if (message.author.bot && !config.forwardBotMessages) {
        return; // Skip bot messages if disabled in config
      }
      
      // Skip if no meaningful content
      if (!this.hasForwardableContent(message)) return;

      // Get all forward configurations for this source channel
      const configs = await getForwardConfigsForChannel(message.channel.id);
      if (configs.length === 0) return;

      logInfo(`Processing message for forwarding: ${configs.length} config(s) found`);

      // Process each configuration
      const forwardPromises = configs.map(config => this.forwardToTarget(message, config));
      await Promise.allSettled(forwardPromises);

    } catch (error) {
      logError('Error in processMessage:', error);
    }
  }

  // Check if message has content worth forwarding
  hasForwardableContent(message) {
    return (
      message.content.length > 0 ||
      message.attachments.size > 0 ||
      message.embeds.length > 0 ||
      message.stickers.size > 0 ||
      message.reactions.cache.size > 0
    );
  }

  // Forward message to specific target based on configuration
  async forwardToTarget(message, config) {
    try {
      // Only support Discord as source for now
      if (config.sourceType !== 'discord') {
        logInfo(`Skipping non-Discord source: ${config.sourceType} -> ${config.targetType}`);
        return;
      }

      // Route to appropriate handler based on target type
      if (config.targetType === 'discord') {
        return await this.forwardToDiscord(message, config);
      } else if (config.targetType === 'telegram') {
        return await this.forwardToTelegram(message, config);
      } else {
        logInfo(`Unsupported target type: ${config.targetType}`);
        return;
      }
    } catch (error) {
      logError(`❌ Failed to forward message: ${error.message}`);
      
      // Log failed forward
      try {
        await logForwardedMessage(
          message.id,
          message.channel.id,
          message.guild?.id || null,
          null,
          config.targetChannelId || config.targetChatId,
          config.targetServerId,
          config.id,
          'failed',
          error.message
        );
      } catch (logError) {
        logError('Error logging failed forward:', logError);
      }

      // Add to retry queue for later processing
      this.addToRetryQueue(message, config, error);
    }
  }

  /**
   * Forward message to Discord target
   */
  async forwardToDiscord(message, config) {
    try {

      const targetChannel = await this.getTargetChannel(config);
      if (!targetChannel) {
        throw new Error(`Target channel ${config.targetChannelId} not accessible`);
      }

      // Check if we can use webhooks (preferred method)
      if (hasWebhookPermissions(targetChannel, this.client.user)) {
        // Use webhook for perfect 1:1 forwarding
        const forwardedMessage = await sendWebhookMessage(targetChannel, message, this.client, config);
        
        // Log successful forward
        await logForwardedMessage(
          message.id,
          message.channel.id,
          message.guild?.id || null,
          forwardedMessage.id,
          targetChannel.id,
          targetChannel.guild?.id || null,
          config.id,
          'success'
        );

        logSuccess(`✅ Webhook forwarded message from ${message.channel.name} to ${targetChannel.name}`);
        logInfo(`Debug: Logged forward - Original: ${message.id} -> Forwarded: ${forwardedMessage.id}`);
        
        // Process AI features for the forwarded message
        if (this.aiInitialized && config.ai?.enabled) {
          this.processAIFeatures(forwardedMessage, message, config);
        }
        
        return forwardedMessage;
      }
      
      // Fallback to regular bot message if no webhook permissions
      logInfo(`No webhook permissions in ${targetChannel.name}, using fallback method`);
      
      // Check basic permissions for fallback
      if (!this.hasForwardPermissions(targetChannel)) {
        throw new Error(`Missing permissions in target channel: ${targetChannel.name}`);
      }

      // Build enhanced message content for fallback
      const forwardContent = await this.buildEnhancedMessage(message, config);
      
      // Send the forwarded message using fallback method
      const forwardedMessage = await this.sendForwardedMessage(targetChannel, forwardContent);
      
      // Handle reactions if original message has them (only for fallback method)
      if (message.reactions.cache.size > 0) {
        await this.forwardReactions(message, forwardedMessage);
      }

      // Log successful forward
      await logForwardedMessage(
        message.id,
        message.channel.id,
        message.guild?.id || null,
        forwardedMessage.id,
        targetChannel.id,
        targetChannel.guild?.id || null,
        config.id,
        'success'
      );

      logSuccess(`✅ Fallback forwarded message from ${message.channel.name} to ${targetChannel.name}`);
      
      // Process AI features for the forwarded message
      if (this.aiInitialized && config.ai?.enabled) {
        this.processAIFeatures(forwardedMessage, message, config);
      }
      
      return forwardedMessage;
    } catch (error) {
      throw error; // Re-throw to be handled by forwardToTarget
    }
  }

  /**
   * Forward message to Telegram target with smart caption handling
   */
  async forwardToTelegram(message, config) {
    try {
      if (!this.telegramInitialized) {
        throw new Error('Telegram handler not initialized');
      }

      if (!config.targetChatId) {
        throw new Error('Telegram chat ID not specified in config');
      }

      // Send message to Telegram
      const telegramResult = await this.telegramHandler.sendMessage(config.targetChatId, message, config);
      
      // Check if message was split into a chain
      if (telegramResult.isSplit && telegramResult.messageChain) {
        // Log as message chain
        await logMessageChain(
          message.id,
          message.channel.id,
          message.guild?.id || null,
          telegramResult.messageChain,
          config.targetChatId,
          null, // No server ID for Telegram
          config.id,
          'success'
        );

        logSuccess(`✅ Forwarded split message from ${message.channel.name} to Telegram chat ${config.targetChatId} (${telegramResult.messageChain.length} parts)`);
      } else {
        // Log as single message
        const messageId = telegramResult.message_id || (Array.isArray(telegramResult) ? telegramResult[0].message_id : telegramResult.result?.message_id);
        
        await logForwardedMessage(
          message.id,
          message.channel.id,
          message.guild?.id || null,
          messageId.toString(),
          config.targetChatId,
          null, // No server ID for Telegram
          config.id,
          'success'
        );

        logSuccess(`✅ Forwarded message from ${message.channel.name} to Telegram chat ${config.targetChatId}`);
      }
      
      return telegramResult;
    } catch (error) {
      throw error; // Re-throw to be handled by forwardToTarget
    }
  }

  // Get target channel with enhanced validation
  async getTargetChannel(config) {
    try {
      let targetChannel;

      if (config.targetServerId) {
        // Cross-server forwarding
        const targetGuild = this.client.guilds.cache.get(config.targetServerId);
        if (!targetGuild) {
          throw new Error(`Target guild ${config.targetServerId} not found`);
        }

        targetChannel = targetGuild.channels.cache.get(config.targetChannelId);
        if (!targetChannel) {
          // Try fetching channel if not in cache
          try {
            targetChannel = await targetGuild.channels.fetch(config.targetChannelId);
          } catch (fetchError) {
            throw new Error(`Target channel ${config.targetChannelId} not found in guild ${targetGuild.name}`);
          }
        }
      } else {
        // Same server forwarding - need to get source guild
        const sourceGuild = this.client.guilds.cache.find(guild => 
          guild.channels.cache.has(config.sourceChannelId)
        );
        
        if (!sourceGuild) {
          throw new Error('Source guild not found');
        }

        targetChannel = sourceGuild.channels.cache.get(config.targetChannelId);
        if (!targetChannel) {
          try {
            targetChannel = await sourceGuild.channels.fetch(config.targetChannelId);
          } catch (fetchError) {
            throw new Error(`Target channel ${config.targetChannelId} not found`);
          }
        }
      }

      return targetChannel;
    } catch (error) {
      logError('Error getting target channel:', error);
      return null;
    }
  }

  // Check if bot has necessary permissions in target channel
  hasForwardPermissions(channel) {
    const permissions = channel.permissionsFor(this.client.user);
    return permissions && permissions.has([
      'ViewChannel',
      'SendMessages',
      'EmbedLinks',
      'AttachFiles',
      'ReadMessageHistory'
    ]);
  }

  // Check if bot has webhook permissions (preferred method)
  hasWebhookPermissions(channel) {
    return hasWebhookPermissions(channel, this.client.user);
  }

  // Build enhanced message with better formatting and metadata
  async buildEnhancedMessage(message, config) {
    const messageOptions = {};

    // Handle text content with enhanced formatting
    if (message.content) {
      let content = message.content;
      
      // Add author information for cross-server forwards
      if (config.sourceServerId !== config.targetServerId) {
        content = `**${message.author.displayName}** from **${message.guild?.name || 'Unknown Server'}**:\n${content}`;
      }
      
      messageOptions.content = content;
    }

    // Handle embeds
    if (message.embeds.length > 0) {
      messageOptions.embeds = message.embeds.filter(embed => embed.data).slice(0, 10); // Discord limit
    }

    // Handle attachments with better error handling
    if (message.attachments.size > 0) {
      messageOptions.files = [];
      
      for (const attachment of message.attachments.values()) {
        try {
          // Check file size (Discord limit: 8MB for most servers)
          if (attachment.size > 8 * 1024 * 1024) {
            logInfo(`Skipping large attachment: ${attachment.name} (${attachment.size} bytes)`);
            continue;
          }

          messageOptions.files.push({
            attachment: attachment.url,
            name: attachment.name,
            description: attachment.description || undefined
          });
        } catch (attachmentError) {
          logError(`Error processing attachment ${attachment.name}:`, attachmentError);
        }
      }
    }

    // Handle stickers
    if (message.stickers.size > 0) {
      const stickerText = Array.from(message.stickers.values())
        .map(sticker => `*[Sticker: ${sticker.name}]*`)
        .join(' ');
      
      if (messageOptions.content) {
        messageOptions.content += `\n${stickerText}`;
      } else {
        messageOptions.content = stickerText;
      }
    }

    // Ensure we have some content
    if (!messageOptions.content && !messageOptions.embeds?.length && !messageOptions.files?.length) {
      messageOptions.content = '*[Message with unsupported content]*';
    }

    return messageOptions;
  }

  // Send message with retry logic
  async sendForwardedMessage(targetChannel, messageOptions) {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await targetChannel.send(messageOptions);
      } catch (error) {
        lastError = error;
        logError(`Send attempt ${attempt} failed:`, error);
        
        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError;
  }

  // Forward reactions from original to forwarded message
  async forwardReactions(originalMessage, forwardedMessage) {
    try {
      for (const reaction of originalMessage.reactions.cache.values()) {
        // Skip if reaction has no emoji or if it's a custom emoji from different server
        if (!reaction.emoji) continue;
        
        try {
          await forwardedMessage.react(reaction.emoji);
          logInfo(`Forwarded reaction: ${reaction.emoji.name || reaction.emoji}`);
        } catch (reactionError) {
          logError(`Failed to forward reaction ${reaction.emoji.name}:`, reactionError);
        }
      }
    } catch (error) {
      logError('Error forwarding reactions:', error);
    }
  }

  // Add failed message to retry queue
  addToRetryQueue(message, config, error) {
    const MAX_RETRY_QUEUE_SIZE = 100;
    const MAX_RETRY_AGE = 60 * 60 * 1000; // 1 hour max age for retry entries

    // Enforce size limit - remove oldest entries if at capacity
    if (this.retryQueue.size >= MAX_RETRY_QUEUE_SIZE) {
      const oldestKey = this.retryQueue.keys().next().value;
      this.retryQueue.delete(oldestKey);
      logInfo(`Retry queue at capacity, removed oldest entry: ${oldestKey}`);
    }

    const retryKey = `${message.id}-${config.id}`;
    const retryData = {
      messageId: message.id,
      channelId: message.channel.id,
      guildId: message.guild?.id,
      config,
      error: error.message,
      attempts: 1,
      createdAt: Date.now(),
      nextRetry: Date.now() + (5 * 60 * 1000), // Retry in 5 minutes
      maxRetries: 3
    };

    this.retryQueue.set(retryKey, retryData);
    logInfo(`Added to retry queue: ${retryKey}`);

    // Clean up stale entries on every add
    this.cleanupStaleRetries(MAX_RETRY_AGE);
  }

  // Clean up stale retry entries
  cleanupStaleRetries(maxAge) {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, data] of this.retryQueue.entries()) {
      if (now - data.createdAt > maxAge) {
        this.retryQueue.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logInfo(`Cleaned up ${cleanedCount} stale retry queue entries`);
    }
  }

  // Process retry queue for failed messages
  async processRetryQueue() {
    const now = Date.now();
    const toRetry = [];

    for (const [key, retryData] of this.retryQueue.entries()) {
      if (retryData.nextRetry <= now) {
        toRetry.push({ key, ...retryData });
      }
    }

    if (toRetry.length === 0) return;

    logInfo(`Processing ${toRetry.length} items from retry queue`);

    for (const { key, messageId, channelId, guildId, config, attempts, maxRetries } of toRetry) {
      try {
        // Fetch fresh message to avoid stale data
        let message = null;
        let channel = null;
        try {
          // Use fetch() instead of cache to handle uncached channels
          if (guildId) {
            const guild = this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
              channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
            }
          } else {
            channel = this.client.channels.cache.get(channelId) || await this.client.channels.fetch(channelId).catch(() => null);
          }

          if (channel) {
            message = await channel.messages.fetch(messageId);
          }
        } catch (fetchError) {
          // Message no longer exists, remove from queue
          this.retryQueue.delete(key);
          logInfo(`Message ${messageId} no longer exists, removing from retry queue`);
          continue;
        }

        if (!channel) {
          this.retryQueue.delete(key);
          logInfo(`Could not fetch channel ${channelId}, removing from retry queue`);
          continue;
        }

        if (!message) {
          this.retryQueue.delete(key);
          logInfo(`Could not fetch message ${messageId}, removing from retry queue`);
          continue;
        }

        await this.forwardToTarget(message, config);
        this.retryQueue.delete(key);
        logSuccess(`Retry successful for ${key}`);
      } catch (error) {
        if (attempts >= maxRetries) {
          this.retryQueue.delete(key);
          logError(`Max retries exceeded for ${key}, removing from queue`);
        } else {
          // Update retry data
          const retryData = this.retryQueue.get(key);
          if (retryData) {
            retryData.attempts++;
            retryData.nextRetry = now + (Math.pow(2, attempts) * 5 * 60 * 1000); // Exponential backoff
            logInfo(`Retry failed for ${key}, scheduling next attempt`);
          }
        }
      }
    }
  }

  // Get retry queue statistics
  getRetryQueueStats() {
    return {
      queueSize: this.retryQueue.size,
      items: Array.from(this.retryQueue.entries()).map(([key, data]) => ({
        key,
        attempts: data.attempts,
        maxRetries: data.maxRetries,
        nextRetry: new Date(data.nextRetry),
        error: data.error
      }))
    };
  }

  /**
   * Process AI features for forwarded message (async, non-blocking)
   */
  processAIFeatures(forwardedMessage, originalMessage, config) {
    // Process AI features asynchronously to not block forwarding
    setImmediate(async () => {
      try {
        await this.aiHandler.processForwardedMessage(forwardedMessage, originalMessage, config);
      } catch (error) {
        logError('AI processing error (non-blocking):', error);
      }
    });
  }

  /**
   * Handle message edits for AI-processed messages
   */
  async handleMessageEdit(oldMessage, newMessage, config) {
    if (this.aiInitialized && config.ai?.enabled) {
      try {
        await this.aiHandler.handleMessageEdit(oldMessage, newMessage, config);
      } catch (error) {
        logError('AI message edit handling error:', error);
      }
    }
  }

  /**
   * Handle message deletion for AI-processed messages
   */
  async handleMessageDelete(message) {
    if (this.aiInitialized) {
      try {
        await this.aiHandler.handleMessageDelete(message);
      } catch (error) {
        logError('AI message deletion handling error:', error);
      }
    }
  }

  /**
   * Get AI processing statistics
   */
  getAIStats() {
    if (this.aiInitialized) {
      return this.aiHandler.getStats();
    }
    return { initialized: false, reason: 'AI Handler not initialized' };
  }

  /**
   * Test AI functionality
   */
  async testAI() {
    if (this.aiInitialized) {
      return await this.aiHandler.testAIFunctionality();
    }
    return { error: 'AI Handler not initialized' };
  }
}

module.exports = ForwardHandler;