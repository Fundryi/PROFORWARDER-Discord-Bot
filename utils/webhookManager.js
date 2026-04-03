const { logInfo, logSuccess, logError } = require('./logger');
const ApplicationEmojiManager = require('./applicationEmojiManager');

const WEBHOOK_NAME = 'ProForwarder';

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

/**
 * Process @everyone/@here mentions based on config and permissions.
 * Mutates nothing — returns { content, allowedMentions }.
 */
function processMentions(content, config, targetChannel, clientUserId) {
  const allowedMentions = { parse: [] }; // default: disable all
  if (!content) return { content, allowedMentions };

  const hasEveryone = content.includes('@everyone');
  const hasHere = content.includes('@here');
  if (!hasEveryone && !hasHere) return { content, allowedMentions };

  if (config && config.allowEveryoneHereMentions === true) {
    const botMember = targetChannel.guild.members.cache.get(clientUserId);
    const canMentionEveryone = botMember?.permissions?.has('MentionEveryone');

    if (canMentionEveryone) {
      const result = { content, allowedMentions };
      if (hasEveryone) {
        result.allowedMentions = {
          parse: ['everyone'],
          users: [],
          roles: []
        };
      }
      if (hasHere) {
        result.content = content.replace(/@here/g, '**[📢 @here]**');
      }
      logInfo(`Allowing @everyone mentions in ${targetChannel.name} (config enabled, @here replaced with indicator)`);
      return result;
    } else {
      const replaced = content
        .replace(/@everyone/g, '**[📢 @everyone]**')
        .replace(/@here/g, '**[📢 @here]**');
      logInfo(`Replaced @everyone/@here with indicators in ${targetChannel.name} (no bot permission)`);
      return { content: replaced, allowedMentions };
    }
  } else {
    const replaced = content
      .replace(/@everyone/g, '**[📢 @everyone]**')
      .replace(/@here/g, '**[📢 @here]**');
    logInfo(`Replaced @everyone/@here with indicators in ${targetChannel.name} (config disabled)`);
    return { content: replaced, allowedMentions };
  }
}

/**
 * Process attachments (size check) and stickers (to text) from a message.
 * Returns { files: Array, stickerText: string|null }.
 */
function processAttachmentsAndStickers(message) {
  const files = [];
  let stickerText = null;

  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      try {
        if (attachment.size > 8 * 1024 * 1024) {
          logInfo(`Skipping large attachment: ${attachment.name} (${attachment.size} bytes)`);
          continue;
        }
        files.push({
          attachment: attachment.url,
          name: attachment.name,
          description: attachment.description || undefined
        });
      } catch (attachmentError) {
        logError(`Error processing attachment ${attachment.name}:`, attachmentError);
      }
    }
  }

  if (message.stickers.size > 0) {
    stickerText = Array.from(message.stickers.values())
      .map(sticker => `*[Sticker: ${sticker.name}]*`)
      .join(' ');
  }

  return { files, stickerText };
}

// Get or create a webhook for a target channel
async function getWebhook(targetChannel) {
  const cacheKey = targetChannel.id;
  
  // Check if we have a cached webhook — trust the cache, callers handle 10015
  if (webhookCache.has(cacheKey)) {
    return webhookCache.get(cacheKey);
  }

  try {
    // Check if ProForwarder webhook already exists
    const existingWebhooks = await targetChannel.fetchWebhooks();
    let webhook = existingWebhooks.find(wh => wh.name === WEBHOOK_NAME);

    if (!webhook) {
      // Create new webhook
      webhook = await targetChannel.createWebhook({
        name: WEBHOOK_NAME,
        reason: `${WEBHOOK_NAME} message forwarding`
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
    let webhook = await getWebhook(targetChannel);

    // Initialize application emoji manager if client is provided
    if (client && !appEmojiManager) {
      initializeAppEmojiManager(client);
    }

    // Process content for cross-server emojis using application-level emoji storage
    let processedContent = originalMessage.content || '';
    if (appEmojiManager && processedContent) {
      processedContent = await appEmojiManager.processMessageEmojis(processedContent, targetChannel.guild);
    }

    // Process mentions
    const mentionResult = processMentions(processedContent, config, targetChannel, client?.user?.id);
    processedContent = mentionResult.content;

    // Build webhook message options to perfectly mimic original
    const webhookOptions = {
      content: processedContent || undefined,
      username: originalMessage.member?.displayName || originalMessage.author.displayName || originalMessage.author.username,
      avatarURL: originalMessage.author.displayAvatarURL({ dynamic: true, size: 256 }),
      embeds: originalMessage.embeds.length > 0 ? originalMessage.embeds.slice(0, 10) : undefined, // Discord limit
      files: [],
      allowedMentions: mentionResult.allowedMentions
    };

    // For bot messages, add a subtle indicator if needed
    if (originalMessage.author.bot && originalMessage.webhookId) {
      // This is already a webhook message, preserve as-is
    } else if (originalMessage.author.bot) {
      // Regular bot message - add bot indicator to username
      webhookOptions.username = `${webhookOptions.username} 🤖`;
    }

    // Handle attachments and stickers
    const { files, stickerText } = processAttachmentsAndStickers(originalMessage);
    webhookOptions.files = files;

    if (stickerText) {
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

    // Send the webhook message, with Unknown Webhook (10015) recovery
    let forwardedMessage;
    try {
      forwardedMessage = await webhook.send(webhookOptions);
    } catch (sendError) {
      if (sendError.code === 10015) {
        // Webhook was deleted externally — evict cache, recreate, retry once
        logInfo(`Webhook deleted for ${targetChannel.name}, recreating...`);
        webhookCache.delete(targetChannel.id);
        webhook = await getWebhook(targetChannel);
        forwardedMessage = await webhook.send(webhookOptions);
      } else {
        throw sendError;
      }
    }

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
    let webhook = await webhookMessage.fetchWebhook();
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

    // Process mentions
    const mentionResult = processMentions(processedContent, config, webhookMessage.channel, client?.user?.id);
    processedContent = mentionResult.content;

    // Build webhook edit options to match original message format
    const editOptions = {
      content: processedContent || undefined,
      embeds: newMessage.embeds.length > 0 ? newMessage.embeds.slice(0, 10) : [],
      files: [],
      allowedMentions: mentionResult.allowedMentions
    };

    // Handle attachments and stickers
    const { files, stickerText } = processAttachmentsAndStickers(newMessage);
    editOptions.files = files;

    if (stickerText) {
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

    // Edit the webhook message, with Unknown Webhook (10015) recovery
    let editedMessage;
    try {
      editedMessage = await webhook.editMessage(webhookMessage.id, editOptions);
    } catch (editError) {
      if (editError.code === 10015) {
        logInfo(`Webhook deleted for ${webhookMessage.channel.name}, recreating...`);
        webhookCache.delete(webhookMessage.channel.id);
        webhook = await getWebhook(webhookMessage.channel);
        editedMessage = await webhook.editMessage(webhookMessage.id, editOptions);
      } else {
        throw editError;
      }
    }

    logSuccess(`Edited webhook message in ${webhookMessage.channel.name}`);
    return editedMessage;

  } catch (error) {
    logError(`Failed to edit webhook message:`, error);
    throw error;
  }
}

// Check if a webhook ID belongs to one of our cached webhooks (no API call)
function isOurWebhook(webhookId) {
  if (!webhookId) return false;
  for (const webhook of webhookCache.values()) {
    if (webhook.id === webhookId) return true;
  }
  return false;
}

module.exports = {
  WEBHOOK_NAME,
  isOurWebhook,
  getWebhook,
  sendWebhookMessage,
  editWebhookMessage,
  hasWebhookPermissions,
  initializeAppEmojiManager,
  processMentions
};
