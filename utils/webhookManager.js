const { logInfo, logSuccess, logError } = require('./logger');
const ApplicationEmojiManager = require('./applicationEmojiManager');

// Cache for webhooks to avoid recreating them
const webhookCache = new Map();

// Global application emoji manager instance
let appEmojiManager = null;

// Initialize application emoji manager
function initializeAppEmojiManager(client) {
  if (!appEmojiManager && client) {
    appEmojiManager = new ApplicationEmojiManager(client);
  }
  return appEmojiManager;
}

// Get or create a webhook for a target channel
async function getWebhook(targetChannel) {
  const cacheKey = targetChannel.id;
  
  // Check if we have a cached webhook
  if (webhookCache.has(cacheKey)) {
    const cachedWebhook = webhookCache.get(cacheKey);
    try {
      // Verify the webhook still exists
      await cachedWebhook.fetch();
      return cachedWebhook;
    } catch (error) {
      // Webhook was deleted, remove from cache
      webhookCache.delete(cacheKey);
    }
  }

  try {
    // Check if ProForwarder webhook already exists
    const existingWebhooks = await targetChannel.fetchWebhooks();
    let webhook = existingWebhooks.find(wh => wh.name === 'ProForwarder');

    if (!webhook) {
      // Create new webhook
      webhook = await targetChannel.createWebhook({
        name: 'ProForwarder',
        reason: 'ProForwarder message forwarding'
      });
      logInfo(`Created webhook for channel ${targetChannel.name}`);
    }

    // Cache the webhook
    webhookCache.set(cacheKey, webhook);
    return webhook;

  } catch (error) {
    logError(`Failed to get/create webhook for ${targetChannel.name}:`, error);
    throw error;
  }
}

// Send a message using webhook to perfectly mimic the original user
async function sendWebhookMessage(targetChannel, originalMessage, client = null, config = null) {
  try {
    const webhook = await getWebhook(targetChannel);
    
    // Initialize application emoji manager if client is provided
    if (client && !appEmojiManager) {
      initializeAppEmojiManager(client);
    }
    
    // Process content for cross-server emojis using application-level emoji storage
    let processedContent = originalMessage.content || '';
    if (appEmojiManager && processedContent) {
      processedContent = await appEmojiManager.processMessageEmojis(processedContent, targetChannel.guild);
    }
    
    // Build webhook message options to perfectly mimic original
    const webhookOptions = {
      content: processedContent || undefined,
      username: originalMessage.member?.displayName || originalMessage.author.displayName || originalMessage.author.username,
      avatarURL: originalMessage.author.displayAvatarURL({ dynamic: true, size: 256 }),
      embeds: originalMessage.embeds.length > 0 ? originalMessage.embeds.slice(0, 10) : undefined, // Discord limit
      files: [],
      allowedMentions: {
        parse: [] // Default: disable all mentions
      }
    };

    // Handle @everyone/@here mentions if enabled in config
    if (config && config.allowEveryoneHereMentions === true) {
      const hasEveryone = processedContent && processedContent.includes('@everyone');
      const hasHere = processedContent && processedContent.includes('@here');
      
      if (hasEveryone || hasHere) {
        // Check if bot has MENTION_EVERYONE permission in target channel
        const botMember = targetChannel.guild.members.cache.get(client?.user?.id);
        const canMentionEveryone = botMember?.permissions?.has('MentionEveryone');
        
        if (canMentionEveryone) {
          // Allow @everyone mentions, but replace @here with indicator (API limitation)
          if (hasEveryone) {
            webhookOptions.allowedMentions = {
              parse: ['everyone'], // Only @everyone is supported by webhook API
              users: [], // Still block user mentions for safety
              roles: []  // Still block role mentions for safety
            };
          }
          
          // @here doesn't work with webhooks, so replace it with indicator
          if (hasHere) {
            webhookOptions.content = processedContent.replace(/@here/g, '**[📢 @here]**');
          }
          
          logInfo(`Allowing @everyone mentions in ${targetChannel.name} (config enabled, @here replaced with indicator)`);
        } else {
          // Bot doesn't have permission, replace both with text indicators
          webhookOptions.content = processedContent
            .replace(/@everyone/g, '**[📢 @everyone]**')
            .replace(/@here/g, '**[📢 @here]**');
          logInfo(`Replaced @everyone/@here with indicators in ${targetChannel.name} (no bot permission)`);
        }
      }
    } else if (processedContent && (processedContent.includes('@everyone') || processedContent.includes('@here'))) {
      // Config disabled or not provided, replace with text indicators
      webhookOptions.content = processedContent
        .replace(/@everyone/g, '**[📢 @everyone]**')
        .replace(/@here/g, '**[📢 @here]**');
      logInfo(`Replaced @everyone/@here with indicators in ${targetChannel.name} (config disabled)`);
    }

    // For bot messages, add a subtle indicator if needed
    if (originalMessage.author.bot && originalMessage.webhookId) {
      // This is already a webhook message, preserve as-is
    } else if (originalMessage.author.bot) {
      // Regular bot message - add bot indicator to username
      webhookOptions.username = `${webhookOptions.username} 🤖`;
    }

    // Handle attachments
    if (originalMessage.attachments.size > 0) {
      for (const attachment of originalMessage.attachments.values()) {
        try {
          // Check file size (8MB limit for most servers)
          if (attachment.size > 8 * 1024 * 1024) {
            logInfo(`Skipping large attachment: ${attachment.name} (${attachment.size} bytes)`);
            continue;
          }

          webhookOptions.files.push({
            attachment: attachment.url,
            name: attachment.name,
            description: attachment.description || undefined
          });
        } catch (attachmentError) {
          logError(`Error processing attachment ${attachment.name}:`, attachmentError);
        }
      }
    }

    // Handle stickers by adding them as text
    if (originalMessage.stickers.size > 0) {
      const stickerText = Array.from(originalMessage.stickers.values())
        .map(sticker => `*[Sticker: ${sticker.name}]*`)
        .join(' ');
      
      if (webhookOptions.content) {
        webhookOptions.content += `\n${stickerText}`;
      } else {
        webhookOptions.content = stickerText;
      }
    }

    // Ensure we have some content to send
    if (!webhookOptions.content && !webhookOptions.embeds?.length && !webhookOptions.files?.length) {
      webhookOptions.content = '*[Message with unsupported content]*';
    }

    // Send the webhook message
    const forwardedMessage = await webhook.send(webhookOptions);
    
    logSuccess(`Webhook message sent to ${targetChannel.name} as ${webhookOptions.username}`);
    return forwardedMessage;

  } catch (error) {
    logError(`Failed to send webhook message to ${targetChannel.name}:`, error);
    throw error;
  }
}

// Check if bot has webhook permissions in channel
function hasWebhookPermissions(channel, clientUser) {
  const permissions = channel.permissionsFor(clientUser);
  return permissions && permissions.has(['ViewChannel', 'ManageWebhooks']);
}

// Edit an existing webhook message
async function editWebhookMessage(webhookMessage, newMessage, client = null, config = null) {
  try {
    // Get the webhook that sent this message
    const webhook = await webhookMessage.fetchWebhook();
    if (!webhook) {
      throw new Error('Could not fetch webhook for message');
    }

    // Initialize application emoji manager if client is provided
    if (client && !appEmojiManager) {
      initializeAppEmojiManager(client);
    }
    
    // Process content for cross-server emojis using application-level emoji storage
    let processedContent = newMessage.content || '';
    if (appEmojiManager && processedContent) {
      processedContent = await appEmojiManager.processMessageEmojis(processedContent, webhookMessage.guild);
    }
    
    // Build webhook edit options to match original message format
    const editOptions = {
      content: processedContent || undefined,
      embeds: newMessage.embeds.length > 0 ? newMessage.embeds.slice(0, 10) : [],
      files: [],
      allowedMentions: {
        parse: [] // Default: disable all mentions
      }
    };

    // Handle @everyone/@here mentions if enabled in config
    if (config && config.allowEveryoneHereMentions === true) {
      const hasEveryone = processedContent && processedContent.includes('@everyone');
      const hasHere = processedContent && processedContent.includes('@here');
      
      if (hasEveryone || hasHere) {
        // Check if bot has MENTION_EVERYONE permission in target channel
        const botMember = webhookMessage.guild.members.cache.get(client?.user?.id);
        const canMentionEveryone = botMember?.permissions?.has('MentionEveryone');
        
        if (canMentionEveryone) {
          // Allow @everyone mentions, but replace @here with indicator (API limitation)
          if (hasEveryone) {
            editOptions.allowedMentions = {
              parse: ['everyone'], // Only @everyone is supported by webhook API
              users: [], // Still block user mentions for safety
              roles: []  // Still block role mentions for safety
            };
          }
          
          // @here doesn't work with webhooks, so replace it with indicator
          if (hasHere) {
            editOptions.content = processedContent.replace(/@here/g, '**[📢 @here]**');
          }
          
          logInfo(`Allowing @everyone mentions in edit for ${webhookMessage.channel.name} (config enabled, @here replaced with indicator)`);
        } else {
          // Bot doesn't have permission, replace both with text indicators
          editOptions.content = processedContent
            .replace(/@everyone/g, '**[📢 @everyone]**')
            .replace(/@here/g, '**[📢 @here]**');
          logInfo(`Replaced @everyone/@here with indicators in edit for ${webhookMessage.channel.name} (no bot permission)`);
        }
      }
    } else if (processedContent && (processedContent.includes('@everyone') || processedContent.includes('@here'))) {
      // Config disabled or not provided, replace with text indicators
      editOptions.content = processedContent
        .replace(/@everyone/g, '**[📢 @everyone]**')
        .replace(/@here/g, '**[📢 @here]**');
      logInfo(`Replaced @everyone/@here with indicators in edit for ${webhookMessage.channel.name} (config disabled)`);
    }

    // Handle attachments
    if (newMessage.attachments.size > 0) {
      for (const attachment of newMessage.attachments.values()) {
        try {
          // Check file size (8MB limit for most servers)
          if (attachment.size > 8 * 1024 * 1024) {
            logInfo(`Skipping large attachment: ${attachment.name} (${attachment.size} bytes)`);
            continue;
          }

          editOptions.files.push({
            attachment: attachment.url,
            name: attachment.name,
            description: attachment.description || undefined
          });
        } catch (attachmentError) {
          logError(`Error processing attachment ${attachment.name}:`, attachmentError);
        }
      }
    }

    // Handle stickers by adding them as text
    if (newMessage.stickers.size > 0) {
      const stickerText = Array.from(newMessage.stickers.values())
        .map(sticker => `*[Sticker: ${sticker.name}]*`)
        .join(' ');
      
      if (editOptions.content) {
        editOptions.content += `\n${stickerText}`;
      } else {
        editOptions.content = stickerText;
      }
    }

    // Ensure we have some content to send
    if (!editOptions.content && !editOptions.embeds?.length && !editOptions.files?.length) {
      editOptions.content = '*[Message with unsupported content]*';
    }

    // Edit the webhook message
    const editedMessage = await webhook.editMessage(webhookMessage.id, editOptions);
    
    logSuccess(`✅ Edited webhook message in ${webhookMessage.channel.name}`);
    return editedMessage;

  } catch (error) {
    logError(`Failed to edit webhook message:`, error);
    throw error;
  }
}

module.exports = {
  getWebhook,
  sendWebhookMessage,
  editWebhookMessage,
  hasWebhookPermissions,
  initializeAppEmojiManager
};
