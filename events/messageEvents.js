const { ChannelType } = require('discord.js');
const { logInfo, logSuccess, logError } = require('../utils/logger');
const ForwardHandler = require('../handlers/forwardHandler');
const { getForwardConfigsForChannel } = require('../utils/configManager');
const { updateTelegramForwardedMessage, deleteTelegramForwardedMessage } = require('../handlers/telegram/telegramMessageUpdater');
const { WEBHOOK_NAME, isOurWebhook } = require('../utils/webhookManager');

// Global forward handler instance
let forwardHandler = null;

let isProcessingRetryQueue = false;

/**
 * Separate forwarded versions into Discord and Telegram targets,
 * deduplicating Telegram targets by configId to avoid processing chains multiple times.
 */
function separateAndDeduplicateTargets(forwardedVersions) {
  const discordTargets = forwardedVersions.filter(log => log.forwardedServerId);
  const telegramTargets = forwardedVersions.filter(log => !log.forwardedServerId);

  const seenTelegramConfigs = new Set();
  const uniqueTelegramTargets = telegramTargets.filter(log => {
    const key = `${log.originalMessageId}-${log.configId}`;
    if (seenTelegramConfigs.has(key)) return false;
    seenTelegramConfigs.add(key);
    return true;
  });

  return { discordTargets, uniqueTelegramTargets };
}

// Initialize forward handler
async function initializeForwardHandler(client) {
  if (!forwardHandler) {
    forwardHandler = new ForwardHandler(client);

    // Initialize AI features
    await forwardHandler.initialize();

    // Start retry queue processor (runs every 5 minutes)
    // Use lock to prevent concurrent executions
    setInterval(async () => {
      if (isProcessingRetryQueue) {
        logInfo('Retry queue already processing, skipping...');
        return;
      }
      isProcessingRetryQueue = true;
      try {
        await forwardHandler.processRetryQueue();
      } catch (error) {
        logError('Error processing retry queue:', error);
      } finally {
        isProcessingRetryQueue = false;
      }
    }, 5 * 60 * 1000);

    logInfo('Forward handler initialized with retry queue processor');
  }
  return forwardHandler;
}

// Handle new messages for forwarding
async function handleMessageCreate(message, client) {
  try {
    // Initialize handler if not already done
    if (!forwardHandler) {
      await initializeForwardHandler(client);
    }

    // Use enhanced forward handler
    await forwardHandler.processMessage(message);
    
    // Handle auto-publish for announcement channels
    await handleAutoPublish(message, client);
  } catch (error) {
    logError('Error in handleMessageCreate:', error);
  }
}


// Handle message updates (edits)
async function handleMessageUpdate(oldMessage, newMessage, client) {
  try {
    // Skip our own messages to prevent loops
    if (newMessage.author?.id === client.user.id) return;
    
    // Skip partial messages (Discord.js optimization)
    if (newMessage.partial || oldMessage.partial) return;
    
    // Skip webhook messages from ProForwarder to prevent loops
    if (newMessage.webhookId) {
      // Check cache first (no API call), fall back to fetch on miss
      if (isOurWebhook(newMessage.webhookId)) {
        logInfo(`Skipping edit event for our own webhook message ${newMessage.id}`);
        return;
      }
      // If not in cache, it could be our webhook from before a restart — fetch to be safe
      try {
        const webhook = await newMessage.fetchWebhook();
        if (webhook && webhook.name === WEBHOOK_NAME) {
          logInfo(`Skipping edit event for our own webhook message ${newMessage.id}`);
          return;
        }
      } catch (error) {
        // If we can't fetch webhook info, skip to prevent potential loops
        logInfo(`Could not verify webhook for message ${newMessage.id}, skipping to prevent loops`);
        return;
      }
    }
    
    // Skip if content hasn't actually changed
    // Short-circuit: check simple comparisons first before expensive JSON stringify
    const contentChanged = oldMessage.content !== newMessage.content;
    const attachmentsChanged = oldMessage.attachments.size !== newMessage.attachments.size;
    const embedCountChanged = oldMessage.embeds.length !== newMessage.embeds.length;

    // Only compute embed content comparison if counts are equal and nothing else changed
    let embedContentChanged = false;
    if (!contentChanged && !attachmentsChanged && !embedCountChanged && oldMessage.embeds.length > 0) {
      // Compare embed data - exclude volatile timestamp field to avoid false positives
      const stripTimestamp = (embed) => {
        const data = { ...embed.data };
        delete data.timestamp;
        return data;
      };
      embedContentChanged = JSON.stringify(oldMessage.embeds.map(stripTimestamp)) !==
                            JSON.stringify(newMessage.embeds.map(stripTimestamp));
    }

    if (!contentChanged && !attachmentsChanged && !embedCountChanged && !embedContentChanged) {
      return;
    }

    // Mark message as being edited to prevent deletion interference
    markAsEditing(newMessage.id);

    try {
      // Initialize handler if not already done
      if (!forwardHandler) {
        await initializeForwardHandler(client);
      }

      // Handle AI-related processing for message edits
      const configs = await getForwardConfigsForChannel(newMessage.channel.id);
      for (const config of configs) {
        await forwardHandler.handleMessageEdit(oldMessage, newMessage, config);
      }

      // Get message logs to find forwarded versions of this message (all targets)
      // Using getMessageLogsByOriginalMessage for efficient lookup without limit
      const { getMessageLogsByOriginalMessage } = require('../utils/database');
      const forwardedVersions = await getMessageLogsByOriginalMessage(newMessage.id);

      const envConfig = require('../config/config');
      if (envConfig.debugMode) {
        logInfo(`🔍 EDIT DEBUG: Looking for forwarded versions of edited message ${newMessage.id}`);
        logInfo(`✅ EDIT DEBUG: Found ${forwardedVersions.length} forwarded versions`);
      }

      if (forwardedVersions.length === 0) {
        if (envConfig.debugMode) {
          logInfo(`❌ Message edit detected but no forwarded versions found for message ${newMessage.id}`);
        }
        return;
      }

      logInfo(`Message edit detected: updating ${forwardedVersions.length} forwarded versions`);

      const { discordTargets, uniqueTelegramTargets } = separateAndDeduplicateTargets(forwardedVersions);

      // Update Discord targets
      for (const logEntry of discordTargets) {
        try {
          await updateForwardedMessage(newMessage, logEntry, client);
        } catch (error) {
          logError(`Failed to update forwarded message ${logEntry.forwardedMessageId}:`, error);
        }
      }

      // Update Telegram targets (deduplicated - chain handling is inside the function)
      for (const logEntry of uniqueTelegramTargets) {
        try {
          await updateTelegramForwardedMessage(newMessage, logEntry, client);
        } catch (error) {
          logError(`Failed to update Telegram message ${logEntry.forwardedMessageId}:`, error);
        }
      }
    } finally {
      // Auto-cleanup handled by markAsEditing timeout
      // Explicit delete for faster cleanup on success
      currentlyEditing.delete(newMessage.id);
    }
    
  } catch (error) {
    logError('Error in handleMessageUpdate:', error);
  }
}

// Update a specific forwarded message
async function updateForwardedMessage(newMessage, logEntry, client) {
  try {
    // Get the config for this forward to check mention settings
    const { getForwardConfigById } = require('../utils/configManager');
    const config = await getForwardConfigById(logEntry.configId);
    // Get the target channel
    let targetChannel;
    
    if (logEntry.forwardedServerId) {
      const targetGuild = client.guilds.cache.get(logEntry.forwardedServerId);
      if (!targetGuild) {
        throw new Error(`Target guild ${logEntry.forwardedServerId} not found`);
      }
      targetChannel = targetGuild.channels.cache.get(logEntry.forwardedChannelId);
    } else {
      // Same server - find the guild
      const sourceGuild = client.guilds.cache.find(guild =>
        guild.channels.cache.has(logEntry.originalChannelId)
      );
      targetChannel = sourceGuild?.channels.cache.get(logEntry.forwardedChannelId);
    }

    if (!targetChannel) {
      throw new Error(`Target channel ${logEntry.forwardedChannelId} not found`);
    }

    // Get the forwarded message
    const forwardedMessage = await targetChannel.messages.fetch(logEntry.forwardedMessageId);
    if (!forwardedMessage) {
      throw new Error(`Forwarded message ${logEntry.forwardedMessageId} not found`);
    }

    // Check if this is a webhook message
    if (forwardedMessage.webhookId) {
      // For webhook messages, use direct webhook editing
      logInfo(`Webhook message detected - editing directly`);
      
      const { editWebhookMessage } = require('../utils/webhookManager');
      
      try {
        await editWebhookMessage(forwardedMessage, newMessage, client, config);
        logSuccess(`✅ Edited webhook message in ${targetChannel.name}`);
      } catch (editError) {
        // If webhook editing fails, fall back to delete and recreate
        logInfo(`Webhook edit failed, falling back to delete and recreate: ${editError.message}`);
        
        // Delete the old webhook message
        await forwardedMessage.delete();
        
        // Send a new webhook message with updated content
        const { sendWebhookMessage, hasWebhookPermissions } = require('../utils/webhookManager');
        
        if (hasWebhookPermissions(targetChannel, client.user)) {
          const newForwardedMessage = await sendWebhookMessage(targetChannel, newMessage, client, config);
          
          // Update the database log with new message ID
          const { updateMessageLog } = require('../utils/database');
          await updateMessageLog(logEntry.id, newForwardedMessage.id);
          
          logSuccess(`Recreated webhook message in ${targetChannel.name} for edit`);
        } else {
          // Fallback to regular message if no webhook permissions
          // Use full config to preserve mention settings (allowEveryoneHereMentions)
          const updatedContent = await forwardHandler.buildEnhancedMessage(newMessage, config || {
            sourceServerId: logEntry.originalServerId,
            targetServerId: logEntry.forwardedServerId
          });

          const newForwardedMessage = await targetChannel.send(updatedContent);

          // Update the database log with new message ID
          const { updateMessageLog } = require('../utils/database');
          await updateMessageLog(logEntry.id, newForwardedMessage.id);

          logSuccess(`Recreated fallback message in ${targetChannel.name} for edit`);
        }
      }
    } else {
      // Regular bot message - can be edited normally
      // Use full config to preserve mention settings (allowEveryoneHereMentions)
      const updatedContent = await forwardHandler.buildEnhancedMessage(newMessage, config || {
        sourceServerId: logEntry.originalServerId,
        targetServerId: logEntry.forwardedServerId
      });

      await forwardedMessage.edit(updatedContent);
      logSuccess(`Updated forwarded message in ${targetChannel.name}`);
    }

  } catch (error) {
    logError('Error updating forwarded message:', error);
    throw error;
  }
}

// Track messages being edited to avoid double-deletion
// Uses Map with timestamps for auto-cleanup
const currentlyEditing = new Map();
const EDITING_TIMEOUT = 30000; // 30 seconds max edit time

// Helper to add message to editing set with auto-cleanup
function markAsEditing(messageId) {
  currentlyEditing.set(messageId, Date.now());
  // Auto-remove after timeout
  setTimeout(() => {
    currentlyEditing.delete(messageId);
  }, EDITING_TIMEOUT);
}

// Helper to check if message is being edited (with stale cleanup)
function isBeingEdited(messageId) {
  const timestamp = currentlyEditing.get(messageId);
  if (!timestamp) return false;
  // Clean up stale entries
  if (Date.now() - timestamp > EDITING_TIMEOUT) {
    currentlyEditing.delete(messageId);
    return false;
  }
  return true;
}

// Handle message deletions
async function handleMessageDelete(message, client) {
  try {
    // Skip our own messages to prevent loops
    if (message.author?.id === client.user.id) return;
    
    // Skip partial messages
    if (message.partial) return;

    // Skip webhook messages from ProForwarder to prevent loops
    if (message.webhookId) {
      // Check cache first (no API call), fall back to fetch on miss
      if (isOurWebhook(message.webhookId)) {
        logInfo(`Skipping delete event for our own webhook message ${message.id}`);
        return;
      }
      // If not in cache, it could be our webhook from before a restart — fetch to be safe
      try {
        const webhook = await message.fetchWebhook();
        if (webhook && webhook.name === WEBHOOK_NAME) {
          logInfo(`Skipping delete event for our own webhook message ${message.id}`);
          return;
        }
      } catch (error) {
        // If we can't fetch webhook info, skip to prevent potential loops
        logInfo(`Could not verify webhook for deleted message ${message.id}, skipping to prevent loops`);
        return;
      }
    }

    // Skip if this message is currently being edited (to avoid interference)
    if (isBeingEdited(message.id)) {
      logInfo(`Skipping deletion of message ${message.id} - currently being edited`);
      return;
    }

    // Initialize handler if not already done for AI processing
    if (!forwardHandler) {
      await initializeForwardHandler(client);
    }

    // Handle AI-related processing for message deletion
    await forwardHandler.handleMessageDelete(message);

    // Get message logs to find forwarded versions of this message (all targets)
    // Using getMessageLogsByOriginalMessage for efficient lookup without limit
    const { getMessageLogsByOriginalMessage } = require('../utils/database');
    const forwardedVersions = await getMessageLogsByOriginalMessage(message.id);

    const envConfig = require('../config/config');
    if (envConfig.debugMode) {
      logInfo(`🔍 DELETE DEBUG: Looking for forwarded versions of deleted message ${message.id}`);
      logInfo(`✅ DELETE DEBUG: Found ${forwardedVersions.length} forwarded versions`);
    }

    if (forwardedVersions.length === 0) {
      if (envConfig.debugMode) {
        logInfo(`❌ Message deletion detected but no forwarded versions found for message ${message.id}`);
      }
      return;
    }

    logInfo(`Message deletion detected: deleting ${forwardedVersions.length} forwarded versions`);

    const { discordTargets, uniqueTelegramTargets } = separateAndDeduplicateTargets(forwardedVersions);

    // Delete Discord targets
    for (const logEntry of discordTargets) {
      try {
        await deleteForwardedMessage(logEntry, client);
      } catch (error) {
        logError(`Failed to delete forwarded message ${logEntry.forwardedMessageId}:`, error);
      }
    }

    // Delete Telegram targets (deduplicated - chain handling is inside the function)
    for (const logEntry of uniqueTelegramTargets) {
      try {
        await deleteTelegramForwardedMessage(logEntry, client);
      } catch (error) {
        logError(`Failed to delete Telegram message ${logEntry.forwardedMessageId}:`, error);
      }
    }

    // Clean up database entries for the deleted original message
    const { cleanupDeletedMessage } = require('../utils/database');
    await cleanupDeletedMessage(message.id);
    
  } catch (error) {
    logError('Error in handleMessageDelete:', error);
  }
}

// Delete a specific forwarded message and its translation threads
async function deleteForwardedMessage(logEntry, client) {
  try {
    // Get the target channel
    let targetChannel;
    
    if (logEntry.forwardedServerId) {
      const targetGuild = client.guilds.cache.get(logEntry.forwardedServerId);
      if (!targetGuild) {
        throw new Error(`Target guild ${logEntry.forwardedServerId} not found`);
      }
      targetChannel = targetGuild.channels.cache.get(logEntry.forwardedChannelId);
    } else {
      // Same server - find the guild
      const sourceGuild = client.guilds.cache.find(guild =>
        guild.channels.cache.has(logEntry.originalChannelId)
      );
      targetChannel = sourceGuild?.channels.cache.get(logEntry.forwardedChannelId);
    }

    if (!targetChannel) {
      throw new Error(`Target channel ${logEntry.forwardedChannelId} not found`);
    }

    // Get the forwarded message first (before deleting)
    let forwardedMessage = null;
    try {
      forwardedMessage = await targetChannel.messages.fetch(logEntry.forwardedMessageId);
    } catch (fetchError) {
      if (fetchError.code === 10008) { // Unknown Message
        logInfo(`Forwarded message ${logEntry.forwardedMessageId} already deleted`);
        return; // Message already gone, no threads to clean up
      }
      throw fetchError;
    }

    // Delete translation threads if they exist
    if (forwardedMessage) {
      await deleteTranslationThreads(forwardedMessage, client);
      
      // Delete the forwarded message
      await forwardedMessage.delete();
      logSuccess(`Deleted forwarded message and translation threads in ${targetChannel.name}`);
    }

  } catch (error) {
    // If message is already deleted, that's ok
    if (error.code === 10008) { // Unknown Message
      logInfo(`Forwarded message ${logEntry.forwardedMessageId} already deleted`);
    } else {
      throw error;
    }
  }
}

// Delete translation threads for a forwarded message
async function deleteTranslationThreads(forwardedMessage, client) {
  try {
    const threadManager = require('../utils/threadManager');
    
    // Get threads associated with this message (now async)
    const messageThreads = await threadManager.getThreadsForMessage(forwardedMessage.id);
    
    if (messageThreads.length === 0) {
      logInfo(`No translation threads found for message ${forwardedMessage.id}`);
      return;
    }

    logInfo(`Found ${messageThreads.length} translation threads to delete for message ${forwardedMessage.id}`);

    // Delete each thread
    for (const threadData of messageThreads) {
      try {
        const thread = await client.channels.fetch(threadData.threadId);
        if (thread) {
          await thread.delete('Source message deleted');
          logSuccess(`Deleted translation thread: ${thread.name} (${threadData.language})`);
        }
      } catch (threadError) {
        if (threadError.code === 10008) { // Unknown Channel (thread already deleted)
          logInfo(`Translation thread ${threadData.threadId} already deleted`);
        } else {
          logError(`Failed to delete translation thread ${threadData.threadId}:`, threadError);
        }
      }
    }

    // Clean up thread tracking for this specific message (now async)
    await threadManager.cleanupMessageThreads(forwardedMessage.id);
    
  } catch (error) {
    logError('Error deleting translation threads:', error);
    // Don't throw - we still want to delete the main message
  }
}

// Handle auto-publish functionality
async function handleAutoPublish(message, client) {
  try {
    // Skip if message is from a bot to prevent loops
    if (message.author.bot) return;
    
    // Skip if not in an announcement channel
    if (message.channel.type !== ChannelType.GuildAnnouncement) return;
    
    // Skip if message is already published (crossposted)
    if (message.flags && message.flags.has('Crossposted')) return;
    
    // Check if auto-publish is enabled for this channel
    const { isChannelAutoPublishEnabled } = require('../utils/configManager');
    const isEnabled = await isChannelAutoPublishEnabled(message.guild?.id, message.channel.id);
    
    if (!isEnabled) return;
    
    // Check if bot has permission to manage messages
    const actingUser = message.client && message.client.user ? message.client.user : client.user;
    const permissions = message.channel.permissionsFor(actingUser);
    if (!permissions || !permissions.has(['ManageMessages'])) {
      logError(`Auto-publish: Bot lacks Manage Messages permission in ${message.channel.name} (${message.guild.name})`);
      return;
    }
    
    logInfo(`Auto-publish: Scheduling message ${message.id} for publishing in 1 minute (${message.channel.name})`);
    
    // Schedule auto-publish after 1 minute (60000 ms)
    setTimeout(async () => {
      try {
        // Fetch the message again to ensure it still exists
        const freshMessage = await message.channel.messages.fetch(message.id);
        
        if (!freshMessage) {
          logInfo(`Auto-publish: Message ${message.id} no longer exists, skipping publish`);
          return;
        }
        
        // Check if already published
        if (freshMessage.flags && freshMessage.flags.has('Crossposted')) {
          logInfo(`Auto-publish: Message ${message.id} already published, skipping`);
          return;
        }
        
        // Publish the message
        await freshMessage.crosspost();
        logSuccess(`✅ Auto-published message ${message.id} in ${message.channel.name} (${message.guild.name})`);
        
      } catch (publishError) {
        if (publishError.code === 10008) { // Unknown Message
          logInfo(`Auto-publish: Message ${message.id} was deleted before publishing`);
        } else if (publishError.code === 50083) { // Already crossposted
          logInfo(`Auto-publish: Message ${message.id} was already crossposted`);
        } else {
          logError(`Auto-publish failed for message ${message.id}:`, publishError);
        }
      }
    }, 60000); // 1 minute delay
    
  } catch (error) {
    logError('Error in auto-publish handler:', error);
  }
}

// Get forward handler instance for external access
function getForwardHandler() {
  return forwardHandler;
}

module.exports = {
  handleMessageCreate,
  handleMessageUpdate,
  handleMessageDelete,
  initializeForwardHandler,
  getForwardHandler
};
