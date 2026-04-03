const { logInfo, logSuccess, logError } = require('../../utils/logger');
const { getMessageChain, MESSAGE_STATUS, updateMessageLog, deleteMessageChain, logMessageChain } = require('../../utils/database');
const { getForwardConfigById } = require('../../utils/configManager');
const TelegramHandler = require('../telegramHandler');

// Shared TelegramHandler instance for edit/delete paths
let sharedTelegramHandler = null;

async function getSharedTelegramHandler() {
  if (!sharedTelegramHandler) {
    sharedTelegramHandler = new TelegramHandler();
    await sharedTelegramHandler.initialize();
  }
  return sharedTelegramHandler;
}

// Update a Telegram forwarded message with smart media and chain handling
async function updateTelegramForwardedMessage(newMessage, logEntry, client) {
  try {
    logInfo(`Smart editing Telegram message ${logEntry.forwardedMessageId} in chat ${logEntry.forwardedChannelId}`);

    // Check if this is part of a message chain (split message), scoped to this config
    const messageChain = await getMessageChain(logEntry.originalMessageId, logEntry.configId);
    const isChain = messageChain.length > 1;

    const envConfig = require('../../config/config');
    if (isChain && envConfig.debugMode) {
      logInfo(`🔗 CHAIN EDIT: Detected message chain with ${messageChain.length} parts (config ${logEntry.configId})`);
      messageChain.forEach((chainEntry, index) => {
        logInfo(`  Part ${index}: ${chainEntry.forwardedMessageId} (position: ${chainEntry.chainPosition})`);
      });
    }

    // Get the config for this forward
    const config = await getForwardConfigById(logEntry.configId);

    if (!config) {
      throw new Error(`Config ${logEntry.configId} not found`);
    }

    // Get shared Telegram handler (lazy-initialized)
    const telegramHandler = await getSharedTelegramHandler();

    // Convert new message content
    const telegramMessage = await telegramHandler.convertDiscordMessage(newMessage, config);

    if (isChain) {
      // Handle chain editing with smart caption length management
      if (envConfig.debugMode) {
        logInfo(`🔗 CHAIN EDIT: Editing message chain with new content (${telegramMessage.text.length} chars)`);
      }

      // Extract message IDs from the chain
      const chainMessageIds = messageChain.map(entry => entry.forwardedMessageId);
      const hasMedia = telegramMessage.media && telegramMessage.media.length > 0;
      const captionLengthLimit = envConfig.telegram?.captionLengthLimit || 900;
      const isLikelyMediaGroup = hasMedia && telegramMessage.media.length > 1 && chainMessageIds.length === telegramMessage.media.length;

      if (isLikelyMediaGroup) {
        if (envConfig.debugMode) {
          logInfo(`🔗 CHAIN EDIT: Media group detected (${telegramMessage.media.length} media items), editing caption only`);
        }

        if (telegramMessage.text.length > captionLengthLimit) {
          const mediaGroupIds = chainMessageIds;
          const updatedChainPartial = await telegramHandler.editMessageChain(
            logEntry.forwardedChannelId,
            [mediaGroupIds[0]],
            telegramMessage.text,
            true,
            telegramMessage.disableWebPagePreview || false
          );

          const combinedChain = [
            ...mediaGroupIds,
            ...updatedChainPartial.filter(id => id !== mediaGroupIds[0])
          ];

          if (combinedChain.length !== chainMessageIds.length) {
            await deleteMessageChain(logEntry.originalMessageId, logEntry.configId);
            await logMessageChain(
              logEntry.originalMessageId,
              logEntry.originalChannelId,
              logEntry.originalServerId,
              combinedChain,
              logEntry.forwardedChannelId,
              logEntry.forwardedServerId,
              logEntry.configId,
              MESSAGE_STATUS.SUCCESS
            );
          }

          logSuccess(`✅ Chain edit successful for media group ${logEntry.originalMessageId} (${combinedChain.length} parts)`);
          return { chainUpdated: true, newChain: combinedChain };
        }

        await telegramHandler.editMessageCaption(
          logEntry.forwardedChannelId,
          chainMessageIds[0],
          telegramMessage.text
        );

        logSuccess(`✅ Chain edit successful for media group ${logEntry.originalMessageId} (${chainMessageIds.length} parts)`);
        return { chainUpdated: false, newChain: chainMessageIds };
      }

      // Use enhanced chain editing method
      // Pass hasMedia so the editor knows whether the first message is media (caption) or text-only
      const updatedChain = await telegramHandler.editMessageChain(
        logEntry.forwardedChannelId,
        chainMessageIds,
        telegramMessage.text,
        hasMedia,
        telegramMessage.disableWebPagePreview || false
      );

      // Update database with new chain structure if it changed
      if (updatedChain.length !== chainMessageIds.length) {
        // Clean up old chain entries (scoped to this config)
        await deleteMessageChain(logEntry.originalMessageId, logEntry.configId);

        // Log new chain
        await logMessageChain(
          logEntry.originalMessageId,
          logEntry.originalChannelId,
          logEntry.originalServerId,
          updatedChain,
          logEntry.forwardedChannelId,
          logEntry.forwardedServerId,
          logEntry.configId,
          MESSAGE_STATUS.SUCCESS
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

    const envConfig = require('../../config/config');
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
          disable_web_page_preview: telegramMessage.disableWebPagePreview || false
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
      // Clean up old single message entry (scoped to this config)
      await deleteMessageChain(logEntry.originalMessageId, logEntry.configId);

      // Log new chain
      await logMessageChain(
        logEntry.originalMessageId,
        logEntry.originalChannelId,
        logEntry.originalServerId,
        result.messageChain,
        logEntry.forwardedChannelId,
        logEntry.forwardedServerId,
        logEntry.configId,
        MESSAGE_STATUS.SUCCESS
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
      disable_web_page_preview: telegramMessage.disableWebPagePreview || false
    });
    result = result.result;
  }

  if (result) {
    if (result.isSplit && result.messageChain) {
      // sendMediaWithCaption returned a split result — log as a chain
      await deleteMessageChain(logEntry.originalMessageId, logEntry.configId);
      await logMessageChain(
        logEntry.originalMessageId,
        logEntry.originalChannelId,
        logEntry.originalServerId,
        result.messageChain,
        logEntry.forwardedChannelId,
        logEntry.forwardedServerId,
        logEntry.configId,
        MESSAGE_STATUS.SUCCESS
      );
      logSuccess(`Smart repost (split) successful in Telegram chat ${logEntry.forwardedChannelId} (${result.messageChain.length} parts)`);
    } else {
      // Single message result — extract the message ID
      const newMessageId = result.message_id || (Array.isArray(result) && result[0] && result[0].message_id);
      if (newMessageId) {
        await updateMessageLog(logEntry.id, newMessageId.toString());
      }
      logSuccess(`Smart repost successful in Telegram chat ${logEntry.forwardedChannelId}`);
    }

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

    const envConfig = require('../../config/config');
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
    // Check if this is part of a message chain (scoped to this config)
    const messageChain = await getMessageChain(logEntry.originalMessageId, logEntry.configId);
    const isChain = messageChain.length > 1;

    const envConfig = require('../../config/config');
    if (isChain && envConfig.debugMode) {
      logInfo(`🔗 CHAIN DELETE: Detected message chain with ${messageChain.length} parts for deletion (config ${logEntry.configId})`);
    }

    // Get shared Telegram handler (lazy-initialized)
    const telegramHandler = await getSharedTelegramHandler();
    if (!telegramHandler) {
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

module.exports = {
  updateTelegramForwardedMessage,
  deleteTelegramForwardedMessage
};
