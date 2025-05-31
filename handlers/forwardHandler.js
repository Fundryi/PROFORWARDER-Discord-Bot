const { logInfo, logSuccess, logError } = require('../utils/logger');
const { logForwardedMessage } = require('../utils/database');
const { getForwardConfigsForChannel } = require('../utils/configManager');
const { sendWebhookMessage, hasWebhookPermissions } = require('../utils/webhookManager');

// Enhanced forward handler with advanced message processing
class ForwardHandler {
  constructor(client) {
    this.client = client;
    this.forwardQueue = new Map(); // For rate limiting and batching
    this.retryQueue = new Map(); // For failed messages
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
      // Only handle Discord forwarding for now
      if (config.sourceType !== 'discord' || config.targetType !== 'discord') {
        logInfo(`Skipping non-Discord forward: ${config.sourceType} -> ${config.targetType}`);
        return;
      }

      const targetChannel = await this.getTargetChannel(config);
      if (!targetChannel) {
        throw new Error(`Target channel ${config.targetChannelId} not accessible`);
      }

      // Check if we can use webhooks (preferred method)
      if (hasWebhookPermissions(targetChannel, this.client.user)) {
        // Use webhook for perfect 1:1 forwarding
        const forwardedMessage = await sendWebhookMessage(targetChannel, message);
        
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
      return forwardedMessage;

    } catch (error) {
      logError(`❌ Failed to forward message: ${error.message}`);
      
      // Log failed forward
      try {
        await logForwardedMessage(
          message.id,
          message.channel.id,
          message.guild?.id || null,
          null,
          config.targetChannelId,
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
    const retryKey = `${message.id}-${config.id}`;
    const retryData = {
      message,
      config,
      error: error.message,
      attempts: 1,
      nextRetry: Date.now() + (5 * 60 * 1000), // Retry in 5 minutes
      maxRetries: 3
    };

    this.retryQueue.set(retryKey, retryData);
    logInfo(`Added to retry queue: ${retryKey}`);
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

    for (const { key, message, config, attempts, maxRetries } of toRetry) {
      try {
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
          retryData.attempts++;
          retryData.nextRetry = now + (Math.pow(2, attempts) * 5 * 60 * 1000); // Exponential backoff
          logInfo(`Retry failed for ${key}, scheduling next attempt`);
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
}

module.exports = ForwardHandler;