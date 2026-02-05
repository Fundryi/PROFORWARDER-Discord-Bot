const { logInfo, logSuccess, logError } = require('../../utils/logger');
const FormatConverter = require('../../utils/formatConverter');

/**
 * Telegram Utilities - Message chain management and helper functions
 * Handles message editing, deletion, and text escaping utilities
 */
class TelegramUtils {
  constructor(telegramAPI) {
    this.api = telegramAPI;
  }

  /**
   * Edit message caption for media messages
   */
  async editMessageCaption(chatId, messageId, newCaption) {
    try {
      const result = await this.api.callTelegramAPI('editMessageCaption', {
        chat_id: chatId,
        message_id: parseInt(messageId),
        caption: newCaption,
        parse_mode: 'MarkdownV2'
      });

      if (result && result.ok) {
        logSuccess(`✏️ Edited message caption ${messageId} in chat ${chatId}`);
        return result.result;
      } else {
        throw new Error(`Caption edit error: ${result ? result.description : 'Unknown error'}`);
      }
    } catch (error) {
      logError('Error editing message caption:', error);
      throw error;
    }
  }

  /**
   * Edit message text for text-only messages
   */
  async editMessageText(chatId, messageId, newText, disableWebPagePreview = false) {
    try {
      const result = await this.api.callTelegramAPI('editMessageText', {
        chat_id: chatId,
        message_id: parseInt(messageId),
        text: newText,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: disableWebPagePreview
      });

      if (result && result.ok) {
        logSuccess(`✏️ Edited message text ${messageId} in chat ${chatId}`);
        return result.result;
      } else {
        throw new Error(`Text edit error: ${result ? result.description : 'Unknown error'}`);
      }
    } catch (error) {
      logError('Error editing message text:', error);
      throw error;
    }
  }

  /**
   * Delete a Telegram message
   */
  async deleteMessage(chatId, messageId) {
    try {
      const result = await this.api.callTelegramAPI('deleteMessage', {
        chat_id: chatId,
        message_id: parseInt(messageId)
      });

      if (result && result.ok) {
        logSuccess(`🗑️ Deleted message ${messageId} in chat ${chatId}`);
        return true;
      } else {
        throw new Error(`Delete error: ${result ? result.description : 'Unknown error'}`);
      }
    } catch (error) {
      logError('Error deleting message:', error);
      throw error;
    }
  }

  /**
   * Handle editing of split messages (message chains)
   * @param {string} chatId - Telegram chat ID
   * @param {string[]} messageChain - Array of message IDs in the chain
   * @param {string} newFullText - New full text content
   * @param {boolean} hasMedia - Whether the first message in the chain is a media message (caption vs text)
   */
  async editMessageChain(chatId, messageChain, newFullText, hasMedia, disableWebPagePreview = false) {
    try {
      const envConfig = require('../../config/env');
      const isDebugMode = envConfig.debugMode;
      const captionLengthLimit = envConfig.telegram?.captionLengthLimit || 900;
      const textLengthLimit = envConfig.telegram?.textLengthLimit || 4000;
      const firstMessageLimit = hasMedia ? captionLengthLimit : textLengthLimit;

      if (isDebugMode) {
        logInfo(`✏️ CHAIN EDIT: Editing message chain with ${messageChain.length} messages (hasMedia: ${hasMedia})`);
      }

      // Helper to edit the first message based on its type
      const editFirstMessage = async (text) => {
        if (hasMedia) {
          await this.editMessageCaption(chatId, messageChain[0], text);
        } else {
          await this.editMessageText(chatId, messageChain[0], text, disableWebPagePreview);
        }
      };

      // Check if new text fits in a single message
      if (newFullText.length <= firstMessageLimit) {
        // Text now fits in single message - restructure
        if (isDebugMode) {
          logInfo(`✏️ CHAIN EDIT: Text now fits in single message, restructuring...`);
        }

        await editFirstMessage(newFullText);

        // Delete all secondary messages since they're no longer needed
        for (let i = 1; i < messageChain.length; i++) {
          await this.deleteMessage(chatId, messageChain[i]);
        }

        return [messageChain[0]]; // Return new chain with just primary message

      } else {
        // Text still needs splitting — use multi-part splitting for N parts
        const splitIndicator = envConfig.telegram?.splitIndicator || '...(continued)';

        const TelegramTextSplitter = require('./telegramTextSplitter');
        const textSplitter = new TelegramTextSplitter();

        // Split the first part to fit the first message (media caption or text)
        const escapedSplitIndicator = this.escapeMarkdownV2ForText(splitIndicator);
        const availableFirstLength = firstMessageLimit - escapedSplitIndicator.length - 10;
        let firstSplitPoint = textSplitter.findOptimalSplitPoint(newFullText, availableFirstLength);
        if (!firstSplitPoint || firstSplitPoint <= 0) {
          firstSplitPoint = Math.max(1, Math.min(availableFirstLength, newFullText.length));
        }
        const firstPart = newFullText.substring(0, firstSplitPoint).trim() + '\n\n' + escapedSplitIndicator;
        const afterFirst = newFullText.substring(firstSplitPoint).trim();

        // Split the remainder into N secondary parts using the standard text limit
        const secondaryParts = textSplitter.splitLongText(afterFirst, textLengthLimit, escapedSplitIndicator);

        const totalParts = 1 + secondaryParts.length; // first message + secondary parts
        if (isDebugMode) {
          logInfo(`✏️ CHAIN EDIT: Splitting into ${totalParts} parts (1 primary + ${secondaryParts.length} secondary)`);
        }

        // Edit the first message
        await editFirstMessage(firstPart);

        // Build the new chain starting with the first message
        const newChain = [messageChain[0]];

        // Edit existing, or create new, secondary messages
        for (let i = 0; i < secondaryParts.length; i++) {
          const existingIndex = i + 1; // index in the old messageChain

          if (existingIndex < messageChain.length) {
            // Edit existing message
            await this.editMessageText(chatId, messageChain[existingIndex], secondaryParts[i], disableWebPagePreview);
            newChain.push(messageChain[existingIndex]);
          } else {
            // Create new message
            const textResult = await this.api.callTelegramAPI('sendMessage', {
              chat_id: chatId,
              text: secondaryParts[i],
              parse_mode: 'MarkdownV2',
              disable_web_page_preview: disableWebPagePreview
            });

            if (textResult && textResult.ok) {
              newChain.push(textResult.result.message_id.toString());
            }
          }
        }

        // Delete any extra old messages beyond what we now need
        for (let i = 1 + secondaryParts.length; i < messageChain.length; i++) {
          await this.deleteMessage(chatId, messageChain[i]);
        }

        if (isDebugMode) {
          logInfo(`✏️ CHAIN EDIT: Final chain has ${newChain.length} messages`);
        }

        return newChain;
      }

    } catch (error) {
      logError('Error editing message chain:', error);
      throw error;
    }
  }

  /**
   * Delete an entire message chain
   */
  async deleteMessageChain(chatId, messageChain) {
    try {
      const deletePromises = messageChain.map(messageId =>
        this.deleteMessage(chatId, messageId).catch(error => {
          logError(`Failed to delete message ${messageId}:`, error);
        })
      );
      
      await Promise.allSettled(deletePromises);
      logSuccess(`🗑️ Deleted message chain with ${messageChain.length} messages in chat ${chatId}`);
      
    } catch (error) {
      logError('Error deleting message chain:', error);
      throw error;
    }
  }

  /**
   * Escape text for use in Telegram MarkdownV2 (for plain text content)
   */
  escapeMarkdownV2ForText(text) {
    if (!text) return '';
    
    // Characters that need escaping in MarkdownV2 plain text:
    // _ * [ ] ( ) ~ ` > # + - = | { } . ! \
    return text.replace(/([_*\[\]()~`>#+=\-|{}.!\\])/g, '\\$1');
  }
}

module.exports = TelegramUtils;
