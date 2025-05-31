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

      // Get message logs to find forwarded versions of this message
      const { getMessageLogsByOriginalMessage } = require('../utils/database');
      const forwardedVersions = await getMessageLogsByOriginalMessage(newMessage.id);

      if (forwardedVersions.length === 0) {
        logInfo(`Message edit detected but no forwarded versions found for message ${newMessage.id}`);
        
        // Debug: Let's check what's actually in the database
        const { getMessageLogs } = require('../utils/database');
        const allLogs = await getMessageLogs(null, 50);
        logInfo(`Debug: Found ${allLogs.length} total message logs in database`);
        
        // Check if any logs match this message ID
        const debugMatches = allLogs.filter(log => log.originalMessageId === newMessage.id);
        logInfo(`Debug: Found ${debugMatches.length} logs matching message ID ${newMessage.id}`);
        
        if (debugMatches.length > 0) {
          logInfo(`Debug: Matching logs found but query failed - possible data type issue`);
          for (const match of debugMatches) {
            logInfo(`  - ${match.originalMessageId} (${typeof match.originalMessageId}) -> ${match.forwardedMessageId} (status: ${match.status})`);
          }
        }
        
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

    // Check if this is a webhook message (can't be edited)
    if (forwardedMessage.webhookId) {
      // For webhook messages, we need to delete and recreate
      logInfo(`Webhook message detected - deleting and recreating for edit`);
      
      // Delete the old webhook message
      await forwardedMessage.delete();
      
      // Send a new webhook message with updated content
      const { sendWebhookMessage, hasWebhookPermissions } = require('../utils/webhookManager');
      
      if (hasWebhookPermissions(targetChannel, client.user)) {
        const newForwardedMessage = await sendWebhookMessage(targetChannel, newMessage, client);
        
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

    // Skip if this message is currently being edited (to avoid interference)
    if (currentlyEditing.has(message.id)) {
      logInfo(`Skipping deletion of message ${message.id} - currently being edited`);
      return;
    }

    // Get message logs to find forwarded versions of this message
    const { getMessageLogsByOriginalMessage } = require('../utils/database');
    const forwardedVersions = await getMessageLogsByOriginalMessage(message.id);

    if (forwardedVersions.length === 0) {
      logInfo(`Message deletion detected but no forwarded versions found for message ${message.id}`);
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