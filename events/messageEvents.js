const { logInfo, logSuccess, logError } = require('../utils/logger');
const ForwardHandler = require('../handlers/forwardHandler');
const { getForwardConfigsForChannel } = require('../utils/configManager');
const { getMessageChain, isMessageChain } = require('../utils/database');

// Global forward handler instance
let forwardHandler = null;
let isProcessingRetryQueue = false;

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
      try {
        const webhook = await newMessage.fetchWebhook();
        if (webhook && webhook.name === 'ProForwarder') {
          logInfo(`Skipping edit event for our own webhook message ${newMessage.id}`);
          return; // Skip our own webhook messages
        }
      } catch (error) {
        // If we can't fetch webhook info, skip to prevent potential loops
        logInfo(`Could not verify webhook for message ${newMessage.id}, skipping to prevent loops`);
        return;
      }
    }
    
    // Skip if content hasn't actually changed
    const embedsChanged = oldMessage.embeds.length !== newMessage.embeds.length ||
      JSON.stringify(oldMessage.embeds.map(e => e.data)) !== JSON.stringify(newMessage.embeds.map(e => e.data));

    if (oldMessage.content === newMessage.content &&
        !embedsChanged &&
        oldMessage.attachments.size === newMessage.attachments.size) {
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

      const envConfig = require('../config/env');
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

      // Separate Discord and Telegram targets
      // For Telegram, deduplicate by configId to avoid processing chains multiple times
      const discordTargets = forwardedVersions.filter(log => log.forwardedServerId);
      const telegramTargets = forwardedVersions.filter(log => !log.forwardedServerId);

      // Deduplicate Telegram targets by configId (chains have same originalMessageId + configId)
      const seenTelegramConfigs = new Set();
      const uniqueTelegramTargets = telegramTargets.filter(log => {
        const key = `${log.originalMessageId}-${log.configId}`;
        if (seenTelegramConfigs.has(key)) return false;
        seenTelegramConfigs.add(key);
        return true;
      });

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
          const updatedContent = await forwardHandler.buildEnhancedMessage(newMessage, {
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
      const updatedContent = await forwardHandler.buildEnhancedMessage(newMessage, {
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
      try {
        const webhook = await message.fetchWebhook();
        if (webhook && webhook.name === 'ProForwarder') {
          logInfo(`Skipping delete event for our own webhook message ${message.id}`);
          return; // Skip our own webhook messages
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

    const envConfig = require('../config/env');
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

    // Separate Discord and Telegram targets
    // For Telegram, deduplicate by configId to avoid processing chains multiple times
    const discordTargets = forwardedVersions.filter(log => log.forwardedServerId);
    const telegramTargets = forwardedVersions.filter(log => !log.forwardedServerId);

    // Deduplicate Telegram targets by configId (chains have same originalMessageId + configId)
    const seenTelegramConfigs = new Set();
    const uniqueTelegramTargets = telegramTargets.filter(log => {
      const key = `${log.originalMessageId}-${log.configId}`;
      if (seenTelegramConfigs.has(key)) return false;
      seenTelegramConfigs.add(key);
      return true;
    });

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

// Update a Telegram forwarded message with smart media and chain handling
async function updateTelegramForwardedMessage(newMessage, logEntry, client) {
  try {
    logInfo(`Smart editing Telegram message ${logEntry.forwardedMessageId} in chat ${logEntry.forwardedChannelId}`);
    
    // Check if this is part of a message chain (split message)
    const messageChain = await getMessageChain(logEntry.originalMessageId);
    const isChain = messageChain.length > 1;
    
    const envConfig = require('../config/env');
    if (isChain && envConfig.debugMode) {
      logInfo(`🔗 CHAIN EDIT: Detected message chain with ${messageChain.length} parts`);
      messageChain.forEach((chainEntry, index) => {
        logInfo(`  Part ${index}: ${chainEntry.forwardedMessageId} (position: ${chainEntry.chainPosition})`);
      });
    }
    
    // Get the config for this forward
    const { getForwardConfigById } = require('../utils/configManager');
    const config = await getForwardConfigById(logEntry.configId);
    
    if (!config) {
      throw new Error(`Config ${logEntry.configId} not found`);
    }

    // Initialize Telegram handler
    const TelegramHandler = require('../handlers/telegramHandler');
    const telegramHandler = new TelegramHandler();
    await telegramHandler.initialize();

    // Convert new message content
    const telegramMessage = await telegramHandler.convertDiscordMessage(newMessage, config);
    
    if (isChain) {
      // Handle chain editing with smart caption length management
      if (envConfig.debugMode) {
        logInfo(`🔗 CHAIN EDIT: Editing message chain with new content (${telegramMessage.text.length} chars)`);
      }
      
      // Extract message IDs from the chain
      const chainMessageIds = messageChain.map(entry => entry.forwardedMessageId);
      
      // Use enhanced chain editing method
      const updatedChain = await telegramHandler.editMessageChain(
        logEntry.forwardedChannelId,
        chainMessageIds,
        telegramMessage.text
      );
      
      // Update database with new chain structure if it changed
      if (updatedChain.length !== chainMessageIds.length) {
        const { updateMessageLog, deleteMessageChain, logMessageChain } = require('../utils/database');
        
        // Clean up old chain entries
        await deleteMessageChain(logEntry.originalMessageId);
        
        // Log new chain
        await logMessageChain(
          logEntry.originalMessageId,
          logEntry.originalChannelId,
          logEntry.originalServerId,
          updatedChain,
          logEntry.forwardedChannelId,
          logEntry.forwardedServerId,
          logEntry.configId,
          'success'
        );
        
        logInfo(`🔗 CHAIN EDIT: Updated chain structure (${chainMessageIds.length} → ${updatedChain.length} messages)`);
      }
      
      logSuccess(`✅ Chain edit successful for message ${logEntry.originalMessageId} (${updatedChain.length} parts)`);
      return { chainUpdated: true, newChain: updatedChain };
      
    } else {
      // Handle single message editing (existing logic)
      return await updateSingleTelegramMessage(newMessage, logEntry, client, telegramHandler, telegramMessage);
    }

  } catch (error) {
    logError('Error in smart Telegram message update:', error);
    throw error;
  }
}

// Update a single Telegram message (non-chain)
async function updateSingleTelegramMessage(newMessage, logEntry, client, telegramHandler, telegramMessage) {
  try {
    // Get the original message to compare media
    let originalMessage = null;
    try {
      const sourceGuild = client.guilds.cache.find(guild =>
        guild.channels.cache.has(logEntry.originalChannelId)
      );
      if (sourceGuild) {
        const sourceChannel = sourceGuild.channels.cache.get(logEntry.originalChannelId);
        if (sourceChannel) {
          originalMessage = await sourceChannel.messages.fetch(logEntry.originalMessageId);
        }
      }
    } catch (error) {
      logInfo(`Could not fetch original message ${logEntry.originalMessageId} for comparison`);
    }

    // Analyze media changes
    const newHasMedia = newMessage.attachments.size > 0 ||
                       (newMessage.embeds && newMessage.embeds.some(embed => embed.image || embed.thumbnail));
    const originalHasMedia = originalMessage ?
                            (originalMessage.attachments.size > 0 ||
                             (originalMessage.embeds && originalMessage.embeds.some(embed => embed.image || embed.thumbnail))) :
                            false;

    const envConfig = require('../config/env');
    if (envConfig.debugMode) {
      logInfo(`🔍 SMART EDIT DEBUG: Original had media: ${originalHasMedia}, New has media: ${newHasMedia}`);
      logInfo(`🔍 SMART EDIT DEBUG: Media items in new message: ${telegramMessage.media ? telegramMessage.media.length : 0}`);
    }

    // Decision logic for smart editing
    if (!originalHasMedia && !newHasMedia) {
      // Case 1: No media in either version - simple text edit
      if (envConfig.debugMode) {
        logInfo(`🔍 SMART EDIT: Case 1 - Text-only edit`);
      }
      
      try {
        const result = await telegramHandler.callTelegramAPI('editMessageText', {
          chat_id: logEntry.forwardedChannelId,
          message_id: logEntry.forwardedMessageId,
          text: telegramMessage.text,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: false
        });

        if (result && result.ok) {
          logSuccess(`✅ Text-only edit successful for Telegram message ${logEntry.forwardedMessageId}`);
          return result.result;
        } else {
          throw new Error(`Text edit failed: ${result ? result.description : 'Unknown error'}`);
        }
      } catch (editError) {
        logInfo(`Text edit failed (${editError.message}), falling back to delete and resend`);
        return await deleteAndResendTelegram(telegramHandler, logEntry, telegramMessage);
      }
      
    } else if (originalHasMedia && !newHasMedia) {
      // Case 2: Had media, now text-only - delete and resend as text
      if (envConfig.debugMode) {
        logInfo(`🔍 SMART EDIT: Case 2 - Media removed, converting to text-only`);
      }
      
      logInfo(`Media removed from message, converting to text-only`);
      return await deleteAndResendTelegram(telegramHandler, logEntry, telegramMessage);
      
    } else if (!originalHasMedia && newHasMedia) {
      // Case 3: Was text-only, now has media - delete and resend with media
      if (envConfig.debugMode) {
        logInfo(`🔍 SMART EDIT: Case 3 - Media added to text-only message`);
      }
      
      logInfo(`Media added to message, converting to media message`);
      return await deleteAndResendTelegram(telegramHandler, logEntry, telegramMessage);
      
    } else {
      // Case 4: Both had media - check if media changed or if caption is too long
      if (envConfig.debugMode) {
        logInfo(`🔍 SMART EDIT: Case 4 - Both have media, checking for changes and length`);
      }
      
      const captionLengthLimit = envConfig.telegram?.captionLengthLimit || 900;
      const captionTooLong = telegramMessage.text.length > captionLengthLimit;
      
      if (captionTooLong) {
        // Caption is now too long - need to convert to chain
        if (envConfig.debugMode) {
          logInfo(`🔍 SMART EDIT: Case 4-special - Caption now too long (${telegramMessage.text.length} > ${captionLengthLimit}), converting to chain`);
        }
        
        logInfo(`Caption is now too long, converting single message to chain`);
        return await convertToChainAndUpdate(telegramHandler, logEntry, telegramMessage, newMessage);
      }
      
      const mediaChanged = await hasMediaChanged(originalMessage, newMessage);
      
      if (!mediaChanged) {
        // Media unchanged, try to edit caption only
        if (envConfig.debugMode) {
          logInfo(`🔍 SMART EDIT: Case 4a - Media unchanged, editing caption only`);
        }
        
        try {
          const result = await telegramHandler.callTelegramAPI('editMessageCaption', {
            chat_id: logEntry.forwardedChannelId,
            message_id: logEntry.forwardedMessageId,
            caption: telegramMessage.text,
            parse_mode: 'MarkdownV2'
          });

          if (result && result.ok) {
            logSuccess(`✅ Caption-only edit successful for Telegram message ${logEntry.forwardedMessageId}`);
            return result.result;
          } else {
            throw new Error(`Caption edit failed: ${result ? result.description : 'Unknown error'}`);
          }
        } catch (editError) {
          logInfo(`Caption edit failed (${editError.message}), falling back to delete and resend`);
          return await deleteAndResendTelegram(telegramHandler, logEntry, telegramMessage);
        }
      } else {
        // Media changed - use editMessageMedia to replace media
        if (envConfig.debugMode) {
          logInfo(`🔍 SMART EDIT: Case 4b - Media changed, using editMessageMedia`);
        }
        
        logInfo(`Media changed in message, updating media with editMessageMedia`);
        return await editTelegramMessageMedia(telegramHandler, logEntry, telegramMessage);
      }
    }

  } catch (error) {
    logError('Error in single Telegram message update:', error);
    throw error;
  }
}

// Convert single message to chain when caption becomes too long
async function convertToChainAndUpdate(telegramHandler, logEntry, telegramMessage, newMessage) {
  try {
    logInfo(`Converting single message to chain due to long caption`);
    
    // Delete the original single message
    await telegramHandler.deleteMessage(logEntry.forwardedChannelId, logEntry.forwardedMessageId);
    
    // Send as new split message
    const result = await telegramHandler.sendMediaWithLongCaption(
      logEntry.forwardedChannelId,
      telegramMessage.media,
      telegramMessage.text
    );
    
    if (result.isSplit && result.messageChain) {
      // Update database with new chain structure
      const { deleteMessageChain, logMessageChain } = require('../utils/database');
      
      // Clean up old single message entry
      await deleteMessageChain(logEntry.originalMessageId);
      
      // Log new chain
      await logMessageChain(
        logEntry.originalMessageId,
        logEntry.originalChannelId,
        logEntry.originalServerId,
        result.messageChain,
        logEntry.forwardedChannelId,
        logEntry.forwardedServerId,
        logEntry.configId,
        'success'
      );
      
      logSuccess(`✅ Converted single message to chain (${result.messageChain.length} parts)`);
      return { convertedToChain: true, newChain: result.messageChain };
    }
    
    return result;
    
  } catch (error) {
    logError('Error converting single message to chain:', error);
    throw error;
  }
}

// Helper function to delete and resend Telegram message
async function deleteAndResendTelegram(telegramHandler, logEntry, telegramMessage) {
  try {
    // Delete the old message
    await telegramHandler.callTelegramAPI('deleteMessage', {
      chat_id: logEntry.forwardedChannelId,
      message_id: logEntry.forwardedMessageId
    });
    logInfo(`Deleted old Telegram message ${logEntry.forwardedMessageId}`);
  } catch (deleteError) {
    logInfo(`Could not delete old Telegram message: ${deleteError.message}`);
  }

  // Send new message with proper media handling
  let result;
  if (telegramMessage.media && telegramMessage.media.length > 0) {
    // Send with media
    result = await telegramHandler.sendMediaWithCaption(
      logEntry.forwardedChannelId,
      telegramMessage.media,
      telegramMessage.text
    );
  } else {
    // Send text-only
    result = await telegramHandler.callTelegramAPI('sendMessage', {
      chat_id: logEntry.forwardedChannelId,
      text: telegramMessage.text,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: false
    });
    result = result.result;
  }
  
  if (result) {
    // Update the database log with new message ID
    const { updateMessageLog } = require('../utils/database');
    const newMessageId = result.message_id || (result[0] && result[0].message_id);
    await updateMessageLog(logEntry.id, newMessageId.toString());
    
    logSuccess(`Smart repost successful in Telegram chat ${logEntry.forwardedChannelId}`);
    return result;
  } else {
    throw new Error(`Failed to send new message`);
  }
}

// Helper function to edit Telegram message media using editMessageMedia API
async function editTelegramMessageMedia(telegramHandler, logEntry, telegramMessage) {
  try {
    // Check if we have media to send
    if (!telegramMessage.media || telegramMessage.media.length === 0) {
      throw new Error('No media found in message for editMessageMedia');
    }

    const envConfig = require('../config/env');
    if (envConfig.debugMode) {
      logInfo(`🔍 EDIT MEDIA DEBUG: Editing media for message ${logEntry.forwardedMessageId}`);
      logInfo(`🔍 EDIT MEDIA DEBUG: New media count: ${telegramMessage.media.length}`);
    }

    // For editMessageMedia, we need to send the first media item
    // Note: Telegram's editMessageMedia only supports single media replacement
    const mediaItem = telegramMessage.media[0];
    
    // Prepare media object for editMessageMedia
    const mediaObject = {
      type: mediaItem.type,
      media: mediaItem.media,
      caption: telegramMessage.text,
      parse_mode: 'MarkdownV2'
    };

    if (envConfig.debugMode) {
      logInfo(`🔍 EDIT MEDIA DEBUG: Media object:`, JSON.stringify(mediaObject, null, 2));
    }

    // Use editMessageMedia API
    const result = await telegramHandler.callTelegramAPI('editMessageMedia', {
      chat_id: logEntry.forwardedChannelId,
      message_id: logEntry.forwardedMessageId,
      media: JSON.stringify(mediaObject)
    });

    if (result && result.ok) {
      logSuccess(`✅ Media edit successful for Telegram message ${logEntry.forwardedMessageId}`);
      
      // If original message had multiple media but we can only edit to single media,
      // send additional media as separate messages
      if (telegramMessage.media.length > 1) {
        logInfo(`Original had ${telegramMessage.media.length} media items, sending remaining ${telegramMessage.media.length - 1} as follow-up`);
        
        const remainingMedia = telegramMessage.media.slice(1);
        for (const additionalMedia of remainingMedia) {
          try {
            const method = additionalMedia.type === 'photo' ? 'sendPhoto' :
                          additionalMedia.type === 'video' ? 'sendVideo' : 'sendDocument';
            
            await telegramHandler.callTelegramAPI(method, {
              chat_id: logEntry.forwardedChannelId,
              [additionalMedia.type === 'photo' ? 'photo' : additionalMedia.type === 'video' ? 'video' : 'document']: additionalMedia.media
            });
          } catch (additionalError) {
            logError(`Failed to send additional media item:`, additionalError);
          }
        }
      }
      
      return result.result;
    } else {
      throw new Error(`editMessageMedia failed: ${result ? result.description : 'Unknown error'}`);
    }

  } catch (error) {
    logError(`editMessageMedia failed (${error.message}), falling back to delete and resend`);
    
    // Fallback to delete and resend if editMessageMedia fails
    return await deleteAndResendTelegram(telegramHandler, logEntry, telegramMessage);
  }
}

// Helper function to check if media has changed between messages
async function hasMediaChanged(originalMessage, newMessage) {
  try {
    // Compare attachment counts and URLs
    if (originalMessage.attachments.size !== newMessage.attachments.size) {
      return true;
    }
    
    // Compare attachment URLs
    const originalUrls = Array.from(originalMessage.attachments.values()).map(a => a.url).sort();
    const newUrls = Array.from(newMessage.attachments.values()).map(a => a.url).sort();
    
    for (let i = 0; i < originalUrls.length; i++) {
      if (originalUrls[i] !== newUrls[i]) {
        return true;
      }
    }
    
    // Compare embed images
    const originalEmbedImages = originalMessage.embeds
      .map(e => [e.image?.url, e.thumbnail?.url])
      .flat()
      .filter(Boolean)
      .sort();
    
    const newEmbedImages = newMessage.embeds
      .map(e => [e.image?.url, e.thumbnail?.url])
      .flat()
      .filter(Boolean)
      .sort();
    
    if (originalEmbedImages.length !== newEmbedImages.length) {
      return true;
    }
    
    for (let i = 0; i < originalEmbedImages.length; i++) {
      if (originalEmbedImages[i] !== newEmbedImages[i]) {
        return true;
      }
    }
    
    return false; // No media changes detected
  } catch (error) {
    logError('Error comparing media:', error);
    return true; // Assume changed if we can't compare
  }
}

// Delete a Telegram forwarded message (handles both single messages and chains)
async function deleteTelegramForwardedMessage(logEntry, client) {
  try {
    // Check if this is part of a message chain
    const messageChain = await getMessageChain(logEntry.originalMessageId);
    const isChain = messageChain.length > 1;
    
    const envConfig = require('../config/env');
    if (isChain && envConfig.debugMode) {
      logInfo(`🔗 CHAIN DELETE: Detected message chain with ${messageChain.length} parts for deletion`);
    }
    
    const TelegramHandler = require('../handlers/telegramHandler');
    const telegramHandler = new TelegramHandler();
    
    // Check if Telegram handler can initialize
    const initialized = await telegramHandler.initialize();
    if (!initialized) {
      throw new Error('Telegram handler failed to initialize');
    }

    if (isChain) {
      // Delete entire message chain
      const chainMessageIds = messageChain.map(entry => entry.forwardedMessageId);
      
      logInfo(`Deleting Telegram message chain with ${chainMessageIds.length} parts in chat ${logEntry.forwardedChannelId}`);
      
      await telegramHandler.deleteMessageChain(logEntry.forwardedChannelId, chainMessageIds);
      
      logSuccess(`Deleted Telegram message chain (${chainMessageIds.length} parts) in chat ${logEntry.forwardedChannelId}`);
    } else {
      // Delete single message
      logInfo(`Deleting Telegram message ${logEntry.forwardedMessageId} in chat ${logEntry.forwardedChannelId}`);
      
      await telegramHandler.deleteMessage(logEntry.forwardedChannelId, logEntry.forwardedMessageId);
      
      logSuccess(`Deleted Telegram message ${logEntry.forwardedMessageId} in chat ${logEntry.forwardedChannelId}`);
    }

  } catch (error) {
    // If message is already deleted, that's ok
    if (error.message && (
        error.message.includes('message to delete not found') ||
        error.message.includes('Message to delete not found') ||
        error.message.includes('Bad Request: message can\'t be deleted')
      )) {
      logInfo(`Telegram message(s) already deleted or cannot be deleted`);
    } else {
      throw error;
    }
  }
}

// Handle auto-publish functionality
async function handleAutoPublish(message, client) {
  try {
    // Skip if message is from a bot to prevent loops
    if (message.author.bot) return;
    
    // Skip if not in an announcement channel
    if (message.channel.type !== 5) return; // 5 = GUILD_ANNOUNCEMENT
    
    // Skip if message is already published (crossposted)
    if (message.flags && message.flags.has('Crossposted')) return;
    
    // Check if auto-publish is enabled for this channel
    const { isChannelAutoPublishEnabled } = require('../utils/configManager');
    const isEnabled = await isChannelAutoPublishEnabled(message.guild.id, message.channel.id);
    
    if (!isEnabled) return;
    
    // Check if bot has permission to manage messages
    const permissions = message.channel.permissionsFor(client.user);
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