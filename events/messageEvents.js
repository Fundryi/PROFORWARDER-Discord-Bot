const { logInfo, logSuccess, logError } = require('../utils/logger');
const ForwardHandler = require('../handlers/forwardHandler');
const { getForwardConfigsForChannel } = require('../utils/configManager');

// Global forward handler instance
let forwardHandler = null;

// Initialize forward handler
async function initializeForwardHandler(client) {
  if (!forwardHandler) {
    forwardHandler = new ForwardHandler(client);
    
    // Initialize AI features
    await forwardHandler.initialize();
    
    // Start retry queue processor (runs every 5 minutes)
    setInterval(() => {
      forwardHandler.processRetryQueue();
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
        // If we can't fetch webhook info, continue processing
        logInfo(`Could not fetch webhook info for message ${newMessage.id}, continuing...`);
      }
    }
    
    // Skip if content hasn't actually changed
    if (oldMessage.content === newMessage.content &&
        oldMessage.embeds.length === newMessage.embeds.length &&
        oldMessage.attachments.size === newMessage.attachments.size) {
      return;
    }

    // Mark message as being edited to prevent deletion interference
    currentlyEditing.add(newMessage.id);

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
      const { getMessageLogs } = require('../utils/database');
      const messageLogs = await getMessageLogs();
      
      const envConfig = require('../config/env');
      if (envConfig.debugMode) {
        logInfo(`🔍 EDIT DEBUG: Looking for forwarded versions of edited message ${newMessage.id}`);
        logInfo(`📊 EDIT DEBUG: Found ${messageLogs.length} total message logs in database`);
      }
      
      const targetMessageId = String(newMessage.id);
      if (envConfig.debugMode) {
        logInfo(`🎯 EDIT DEBUG: Searching for originalMessageId === "${targetMessageId}" (${typeof targetMessageId})`);
      }
      
      const forwardedVersions = messageLogs.filter(log => {
        const matches = log.originalMessageId === targetMessageId && log.status === 'success';
        if (envConfig.debugMode && log.originalMessageId === targetMessageId) {
          logInfo(`🔍 EDIT DEBUG: Found matching originalMessageId: ${log.originalMessageId}, status: ${log.status}, matches: ${matches}`);
        }
        return matches;
      });

      if (envConfig.debugMode) {
        logInfo(`✅ EDIT DEBUG: Found ${forwardedVersions.length} forwarded versions for message ${newMessage.id}`);
      }

      if (forwardedVersions.length === 0) {
        logInfo(`❌ Message edit detected but no forwarded versions found for message ${newMessage.id}`);
        
        if (envConfig.debugMode) {
          // Extra debug: check if any logs match loosely
          const looseMatches = messageLogs.filter(log =>
            log.originalMessageId == newMessage.id || log.forwardedMessageId == newMessage.id
          );
          logInfo(`🔍 EDIT DEBUG: Loose matches (== comparison): ${looseMatches.length}`);
          looseMatches.forEach(match => {
            logInfo(`  - Log ${match.id}: Original:${match.originalMessageId} -> Forwarded:${match.forwardedMessageId} Status:${match.status}`);
          });
        }
        
        return;
      }

      logInfo(`Message edit detected: updating ${forwardedVersions.length} forwarded versions`);

      // Update each forwarded version
      for (const logEntry of forwardedVersions) {
        try {
          if (logEntry.forwardedServerId) {
            // Discord target
            await updateForwardedMessage(newMessage, logEntry, client);
          } else {
            // Telegram target - handle differently
            await updateTelegramForwardedMessage(newMessage, logEntry, client);
          }
        } catch (error) {
          logError(`Failed to update forwarded message ${logEntry.forwardedMessageId}:`, error);
        }
      }
    } finally {
      // Remove from editing set after a delay to allow deletion to complete
      setTimeout(() => {
        currentlyEditing.delete(newMessage.id);
      }, 5000); // 5 second delay
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
const currentlyEditing = new Set();

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
        // If we can't fetch webhook info, continue processing
        logInfo(`Could not fetch webhook info for deleted message ${message.id}, continuing...`);
      }
    }

    // Skip if this message is currently being edited (to avoid interference)
    if (currentlyEditing.has(message.id)) {
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
    const { getMessageLogs } = require('../utils/database');
    const messageLogs = await getMessageLogs();
    
    const envConfig = require('../config/env');
    if (envConfig.debugMode) {
      logInfo(`🔍 DELETE DEBUG: Looking for forwarded versions of deleted message ${message.id}`);
      logInfo(`📊 DELETE DEBUG: Found ${messageLogs.length} total message logs in database`);
      
      // Log first few entries for debugging
      logInfo(`📋 DELETE DEBUG: Recent message logs (first 5):`);
      messageLogs.slice(0, 5).forEach((log, index) => {
        logInfo(`  ${index + 1}. ID:${log.id} Original:${log.originalMessageId} (${typeof log.originalMessageId}) -> Forwarded:${log.forwardedMessageId} Status:${log.status}`);
      });
    }
    
    const targetMessageId = String(message.id);
    if (envConfig.debugMode) {
      logInfo(`🎯 DELETE DEBUG: Searching for originalMessageId === "${targetMessageId}" (${typeof targetMessageId})`);
    }
    
    const forwardedVersions = messageLogs.filter(log => {
      const matches = log.originalMessageId === targetMessageId && log.status === 'success';
      if (envConfig.debugMode && log.originalMessageId === targetMessageId) {
        logInfo(`🔍 DELETE DEBUG: Found matching originalMessageId: ${log.originalMessageId}, status: ${log.status}, matches: ${matches}`);
      }
      return matches;
    });

    if (envConfig.debugMode) {
      logInfo(`✅ DELETE DEBUG: Found ${forwardedVersions.length} forwarded versions for message ${message.id}`);
    }

    if (forwardedVersions.length === 0) {
      logInfo(`❌ Message deletion detected but no forwarded versions found for message ${message.id}`);
      
      if (envConfig.debugMode) {
        // Extra debug: check if any logs match loosely
        const looseMatches = messageLogs.filter(log =>
          log.originalMessageId == message.id || log.forwardedMessageId == message.id
        );
        logInfo(`🔍 DELETE DEBUG: Loose matches (== comparison): ${looseMatches.length}`);
        looseMatches.forEach(match => {
          logInfo(`  - Log ${match.id}: Original:${match.originalMessageId} -> Forwarded:${match.forwardedMessageId} Status:${match.status}`);
        });
      }
      
      return;
    }

    logInfo(`Message deletion detected: deleting ${forwardedVersions.length} forwarded versions`);

    // Delete each forwarded version
    for (const logEntry of forwardedVersions) {
      try {
        if (logEntry.forwardedServerId) {
          // Discord target
          await deleteForwardedMessage(logEntry, client);
        } else {
          // Telegram target - handle differently
          await deleteTelegramForwardedMessage(logEntry, client);
        }
      } catch (error) {
        logError(`Failed to delete forwarded message ${logEntry.forwardedMessageId}:`, error);
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

// Update a Telegram forwarded message with smart media handling
async function updateTelegramForwardedMessage(newMessage, logEntry, client) {
  try {
    logInfo(`Smart editing Telegram message ${logEntry.forwardedMessageId} in chat ${logEntry.forwardedChannelId}`);
    
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

    // Convert message content for comparison and sending
    const telegramMessage = await telegramHandler.convertDiscordMessage(newMessage, config);
    
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
      // Case 4: Both had media - check if media changed
      if (envConfig.debugMode) {
        logInfo(`🔍 SMART EDIT: Case 4 - Both have media, checking for changes`);
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
    logError('Error in smart Telegram message update:', error);
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

// Delete a Telegram forwarded message
async function deleteTelegramForwardedMessage(logEntry, client) {
  try {
    logInfo(`Deleting Telegram message ${logEntry.forwardedMessageId} in chat ${logEntry.forwardedChannelId}`);
    
    const TelegramHandler = require('../handlers/telegramHandler');
    const telegramHandler = new TelegramHandler();
    
    // Check if Telegram handler can initialize
    const initialized = await telegramHandler.initialize();
    if (!initialized) {
      throw new Error('Telegram handler failed to initialize');
    }

    await telegramHandler.callTelegramAPI('deleteMessage', {
      chat_id: logEntry.forwardedChannelId,
      message_id: parseInt(logEntry.forwardedMessageId) // Ensure it's a number
    });
    
    logSuccess(`Deleted Telegram message ${logEntry.forwardedMessageId} in chat ${logEntry.forwardedChannelId}`);

  } catch (error) {
    // If message is already deleted, that's ok
    if (error.message && (
        error.message.includes('message to delete not found') ||
        error.message.includes('Message to delete not found') ||
        error.message.includes('Bad Request: message can\'t be deleted')
      )) {
      logInfo(`Telegram message ${logEntry.forwardedMessageId} already deleted or cannot be deleted`);
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