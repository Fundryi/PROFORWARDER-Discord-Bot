const { logInfo, logSuccess, logError } = require('../utils/logger');
const ForwardHandler = require('../handlers/forwardHandler');
const { getForwardConfigsForChannel } = require('../utils/configManager');

// Global forward handler instance
let forwardHandler = null;

// Initialize forward handler
function initializeForwardHandler(client) {
  if (!forwardHandler) {
    forwardHandler = new ForwardHandler(client);
    
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
      initializeForwardHandler(client);
    }

    // Use enhanced forward handler
    await forwardHandler.processMessage(message);
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
        initializeForwardHandler(client);
      }

      // Get message logs to find forwarded versions of this message (using working approach from reactions)
      const { getMessageLogs } = require('../utils/database');
      const messageLogs = await getMessageLogs();
      
      logInfo(`🔍 EDIT DEBUG: Looking for forwarded versions of edited message ${newMessage.id}`);
      logInfo(`📊 EDIT DEBUG: Found ${messageLogs.length} total message logs in database`);
      
      const targetMessageId = String(newMessage.id);
      logInfo(`🎯 EDIT DEBUG: Searching for originalMessageId === "${targetMessageId}" (${typeof targetMessageId})`);
      
      const forwardedVersions = messageLogs.filter(log => {
        const matches = log.originalMessageId === targetMessageId && log.status === 'success';
        if (log.originalMessageId === targetMessageId) {
          logInfo(`🔍 EDIT DEBUG: Found matching originalMessageId: ${log.originalMessageId}, status: ${log.status}, matches: ${matches}`);
        }
        return matches;
      });

      logInfo(`✅ EDIT DEBUG: Found ${forwardedVersions.length} forwarded versions for message ${newMessage.id}`);

      if (forwardedVersions.length === 0) {
        logInfo(`❌ Message edit detected but no forwarded versions found for message ${newMessage.id}`);
        
        // Extra debug: check if any logs match loosely
        const looseMatches = messageLogs.filter(log =>
          log.originalMessageId == newMessage.id || log.forwardedMessageId == newMessage.id
        );
        logInfo(`🔍 EDIT DEBUG: Loose matches (== comparison): ${looseMatches.length}`);
        looseMatches.forEach(match => {
          logInfo(`  - Log ${match.id}: Original:${match.originalMessageId} -> Forwarded:${match.forwardedMessageId} Status:${match.status}`);
        });
        
        return;
      }

      logInfo(`Message edit detected: updating ${forwardedVersions.length} forwarded versions`);

      // Update each forwarded version
      for (const logEntry of forwardedVersions) {
        try {
          await updateForwardedMessage(newMessage, logEntry, client);
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

    // Get message logs to find forwarded versions of this message (using working approach from reactions)
    const { getMessageLogs } = require('../utils/database');
    const messageLogs = await getMessageLogs();
    
    logInfo(`🔍 DELETE DEBUG: Looking for forwarded versions of deleted message ${message.id}`);
    logInfo(`📊 DELETE DEBUG: Found ${messageLogs.length} total message logs in database`);
    
    // Log first few entries for debugging
    logInfo(`📋 DELETE DEBUG: Recent message logs (first 5):`);
    messageLogs.slice(0, 5).forEach((log, index) => {
      logInfo(`  ${index + 1}. ID:${log.id} Original:${log.originalMessageId} (${typeof log.originalMessageId}) -> Forwarded:${log.forwardedMessageId} Status:${log.status}`);
    });
    
    const targetMessageId = String(message.id);
    logInfo(`🎯 DELETE DEBUG: Searching for originalMessageId === "${targetMessageId}" (${typeof targetMessageId})`);
    
    const forwardedVersions = messageLogs.filter(log => {
      const matches = log.originalMessageId === targetMessageId && log.status === 'success';
      if (log.originalMessageId === targetMessageId) {
        logInfo(`🔍 DELETE DEBUG: Found matching originalMessageId: ${log.originalMessageId}, status: ${log.status}, matches: ${matches}`);
      }
      return matches;
    });

    logInfo(`✅ DELETE DEBUG: Found ${forwardedVersions.length} forwarded versions for message ${message.id}`);

    if (forwardedVersions.length === 0) {
      logInfo(`❌ Message deletion detected but no forwarded versions found for message ${message.id}`);
      
      // Extra debug: check if any logs match loosely
      const looseMatches = messageLogs.filter(log =>
        log.originalMessageId == message.id || log.forwardedMessageId == message.id
      );
      logInfo(`🔍 DELETE DEBUG: Loose matches (== comparison): ${looseMatches.length}`);
      looseMatches.forEach(match => {
        logInfo(`  - Log ${match.id}: Original:${match.originalMessageId} -> Forwarded:${match.forwardedMessageId} Status:${match.status}`);
      });
      
      return;
    }

    logInfo(`Message deletion detected: deleting ${forwardedVersions.length} forwarded versions`);

    // Delete each forwarded version
    for (const logEntry of forwardedVersions) {
      try {
        await deleteForwardedMessage(logEntry, client);
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

// Delete a specific forwarded message
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

    // Get and delete the forwarded message
    const forwardedMessage = await targetChannel.messages.fetch(logEntry.forwardedMessageId);
    if (forwardedMessage) {
      await forwardedMessage.delete();
      logSuccess(`Deleted forwarded message in ${targetChannel.name}`);
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