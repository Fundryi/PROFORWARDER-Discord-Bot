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
async function sendWebhookMessage(targetChannel, originalMessage, client = null) {
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
        parse: [] // Disable all mentions to prevent spam/abuse
      }
    };

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

module.exports = {
  getWebhook,
  sendWebhookMessage,
  hasWebhookPermissions,
  initializeAppEmojiManager
};
