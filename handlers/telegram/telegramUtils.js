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
  async editMessageText(chatId, messageId, newText) {
    try {
      const result = await this.api.callTelegramAPI('editMessageText', {
        chat_id: chatId,
        message_id: parseInt(messageId),
        text: newText,
        parse_mode: 'MarkdownV2'
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
  async editMessageChain(chatId, messageChain, newFullText, hasMedia) {
    try {
      const envConfig = require('../../config/env');
      const isDebugMode = envConfig.debugMode;
      const firstMessageLimit = hasMedia
        ? (envConfig.telegram?.captionLengthLimit || 900)
        : 4000; // Telegram text message limit

      if (isDebugMode) {
        logInfo(`✏️ CHAIN EDIT: Editing message chain with ${messageChain.length} messages (hasMedia: ${hasMedia})`);
      }

      // Helper to edit the first message based on its type
      const editFirstMessage = async (text) => {
        if (hasMedia) {
          await this.editMessageCaption(chatId, messageChain[0], text);
        } else {
          await this.editMessageText(chatId, messageChain[0], text);
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
        // Text still needs splitting
        const splitIndicator = envConfig.telegram?.splitIndicator || '...(continued)';

        const TelegramTextSplitter = require('./telegramTextSplitter');
        const textSplitter = new TelegramTextSplitter();

        const splitPoint = textSplitter.findOptimalSplitPoint(newFullText, firstMessageLimit - splitIndicator.length - 10);

        const escapedSplitIndicator = this.escapeMarkdownV2ForText(splitIndicator);
        const firstPart = newFullText.substring(0, splitPoint).trim() + '\n\n' + escapedSplitIndicator;
        const remainingPart = newFullText.substring(splitPoint).trim();

        if (isDebugMode) {
          logInfo(`✏️ CHAIN EDIT: Still needs splitting: ${firstPart.length} + ${remainingPart.length} chars`);
        }

        // Edit the first message
        await editFirstMessage(firstPart);

        // Edit or create secondary message
        if (messageChain.length > 1) {
          await this.editMessageText(chatId, messageChain[1], remainingPart);
        } else {
          // Create new secondary message
          const textResult = await this.api.callTelegramAPI('sendMessage', {
            chat_id: chatId,
            text: remainingPart,
            parse_mode: 'MarkdownV2'
          });

          if (textResult && textResult.ok) {
            messageChain.push(textResult.result.message_id.toString());
          }
        }

        // Delete any extra messages beyond the 2 we need (handles >2 part chains shrinking)
        for (let i = 2; i < messageChain.length; i++) {
          await this.deleteMessage(chatId, messageChain[i]);
        }

        return [messageChain[0], messageChain[1]]; // Return the 2-part chain
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