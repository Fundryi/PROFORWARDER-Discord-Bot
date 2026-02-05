const { logInfo, logSuccess, logError } = require('../utils/logger');
const TelegramAPI = require('./telegram/telegramAPI');
const TelegramConverter = require('./telegram/telegramConverter');
const TelegramMessageSender = require('./telegram/telegramMessageSender');
const TelegramUtils = require('./telegram/telegramUtils');
const TelegramMediaHandler = require('./telegram/telegramMediaHandler');
const TelegramTextSplitter = require('./telegram/telegramTextSplitter');

/**
 * Telegram Bot API Handler for ProForwarder
 * Handles message forwarding from Discord to Telegram
 * 
 * REFACTORED: Now uses modular architecture with focused components
 * while maintaining 100% backward compatibility
 */
class TelegramHandler {
  constructor() {
    // Initialize all module components
    this.api = new TelegramAPI();
    this.converter = new TelegramConverter();
    this.messageSender = new TelegramMessageSender(this.api);
    this.utils = new TelegramUtils(this.api);
    this.mediaHandler = new TelegramMediaHandler();
    this.textSplitter = new TelegramTextSplitter();

    // Legacy properties for backward compatibility
    this.botToken = null;
    this.apiUrl = 'https://api.telegram.org';
    this.initialized = false;
  }

  /**
   * Initialize Telegram handler with bot token
   */
  async initialize() {
    const result = await this.api.initialize();
    
    // Update legacy properties for backward compatibility
    if (result) {
      this.botToken = this.api.getBotToken();
      this.apiUrl = this.api.getApiUrl();
      this.initialized = this.api.isInitialized();
    }
    
    return result;
  }

  /**
   * Send message to Telegram chat with enhanced chain support
   */
  async sendMessage(chatId, message, config = {}) {
    if (!this.initialized) {
      throw new Error('Telegram handler not initialized');
    }

    try {
      // Convert Discord message to Telegram format
      const telegramMessage = await this.converter.convertDiscordMessage(message, config);
      
      const envConfig = require('../config/env');
      const isDebugMode = envConfig.debugMode;
      
      // If we have media, send it with the text as caption
      if (telegramMessage.media && telegramMessage.media.length > 0) {
        if (isDebugMode) {
          logInfo(`🔍 SEND DEBUG: Detected ${telegramMessage.media.length} media items`);
          logInfo(`🔍 SEND DEBUG: Caption text: "${telegramMessage.text}"`);
          logInfo(`🔍 SEND DEBUG: Caption length: ${telegramMessage.text.length} characters`);
        }
        
        // Check if media is from embeds (which can cause issues) - if so, treat as text-only
        const hasEmbedMedia = this.mediaHandler.hasEmbedMedia(telegramMessage.media);
        
        if (hasEmbedMedia) {
          if (isDebugMode) {
            logInfo(`🔍 SEND DEBUG: Embed media detected, treating as text-only message`);
          }
          
          // Treat as text-only message with 4000 char limit
          const textLengthLimit = 4000; // Safe limit for text messages
          
          // Force disable web page preview for embed media (since we're treating as text-only)
          const disablePreview = true; // Always disable for embed media to prevent big previews
          
          if (telegramMessage.text.length > textLengthLimit) {
            logInfo(`📏 Text too long (${telegramMessage.text.length} chars), using smart text splitting`);
            return await this.messageSender.sendLongTextMessage(chatId, telegramMessage.text, disablePreview);
          }
          
          // Send as regular text message with preview disabled
          const messagePayload = {
            chat_id: chatId,
            text: telegramMessage.text,
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: disablePreview
          };

          // Only add reply_markup if it's actually provided (preserve existing logic)
          if (telegramMessage.replyMarkup) {
            messagePayload.reply_markup = telegramMessage.replyMarkup;
          }

          const result = await this.api.callTelegramAPI('sendMessage', messagePayload);

          if (result && result.ok) {
            logSuccess(`✅ Message sent to Telegram chat ${chatId} as text-only (embed media filtered, preview disabled)`);
            return result.result;
          } else {
            throw new Error(`Telegram API error: ${result ? result.description : 'Unknown error'}`);
          }
        }
        
        // Send media with text as caption (may return chain if split)
        const result = await this.messageSender.sendMediaWithCaption(chatId, telegramMessage.media, telegramMessage.text);
        
        // Check if result indicates a split message
        if (result.isSplit && result.messageChain) {
          return result; // Return chain information
        } else {
          return result; // Return normal result
        }
      } else {
        if (isDebugMode) {
          logInfo(`🔍 SEND DEBUG: Sending text-only message`);
          logInfo(`🔍 SEND DEBUG: Final text: "${telegramMessage.text}"`);
          logInfo(`🔍 SEND DEBUG: Text length: ${telegramMessage.text.length} characters`);
        }
        
        // Check if text is too long for normal message (4096 character limit)
        const textLengthLimit = 4000; // Safe limit, Telegram allows 4096
        
        if (telegramMessage.text.length > textLengthLimit) {
          logInfo(`📏 Text too long (${telegramMessage.text.length} chars), using smart text splitting`);
          return await this.messageSender.sendLongTextMessage(chatId, telegramMessage.text, telegramMessage.disableWebPagePreview);
        }
        
        // Send message with MarkdownV2 parsing using the converted message (includes embeds!)
        const messagePayload = {
          chat_id: chatId,
          text: telegramMessage.text,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: telegramMessage.disableWebPagePreview || false
        };

        // Only add reply_markup if it's actually provided
        if (telegramMessage.replyMarkup) {
          messagePayload.reply_markup = telegramMessage.replyMarkup;
        }

        const result = await this.api.callTelegramAPI('sendMessage', messagePayload);

        if (result && result.ok) {
          logSuccess(`✅ Message sent to Telegram chat ${chatId} (using MarkdownV2)`);
          return result.result;
        } else {
          throw new Error(`Telegram API error: ${result ? result.description : 'Unknown error'}`);
        }
      }
    } catch (error) {
      logError('Error sending Telegram message:', error);
      throw error;
    }
  }

  /**
   * Send media with caption (supports formatted text with smart length handling)
   */
  async sendMediaWithCaption(chatId, media, caption) {
    return await this.messageSender.sendMediaWithCaption(chatId, media, caption);
  }

  /**
   * Handle long captions by intelligently splitting them
   * Returns message chain for proper tracking
   */
  async sendMediaWithLongCaption(chatId, media, fullCaption) {
    return await this.messageSender.sendMediaWithLongCaption(chatId, media, fullCaption);
  }

  /**
   * Handle long text messages by intelligently splitting them
   * Returns message chain for proper tracking
   */
  async sendLongTextMessage(chatId, fullText, disableWebPagePreview = false) {
    return await this.messageSender.sendLongTextMessage(chatId, fullText, disableWebPagePreview);
  }

  /**
   * Send media separately with header, then send full content as text
   */
  async sendMediaSeparately(chatId, media, fullContent) {
    return await this.messageSender.sendMediaSeparately(chatId, media, fullContent);
  }

  /**
   * Edit message caption for media messages
   */
  async editMessageCaption(chatId, messageId, newCaption) {
    return await this.utils.editMessageCaption(chatId, messageId, newCaption);
  }

  /**
   * Edit message text for text-only messages
   */
  async editMessageText(chatId, messageId, newText) {
    return await this.utils.editMessageText(chatId, messageId, newText);
  }

  /**
   * Delete a Telegram message
   */
  async deleteMessage(chatId, messageId) {
    return await this.utils.deleteMessage(chatId, messageId);
  }

  /**
   * Handle editing of split messages (message chains)
   */
  async editMessageChain(chatId, messageChain, newFullText, hasMedia) {
    return await this.utils.editMessageChain(chatId, messageChain, newFullText, hasMedia);
  }

  /**
   * Delete an entire message chain
   */
  async deleteMessageChain(chatId, messageChain) {
    return await this.utils.deleteMessageChain(chatId, messageChain);
  }

  /**
   * Send media group to Telegram
   */
  async sendMediaGroup(chatId, media) {
    return await this.messageSender.sendMediaGroup(chatId, media);
  }

  /**
   * Convert Discord message to Telegram format
   */
  async convertDiscordMessage(discordMessage, config = {}) {
    return await this.converter.convertDiscordMessage(discordMessage, config);
  }

  /**
   * Build source header showing Discord server and channel
   */
  async buildSourceHeader(discordMessage, config = {}) {
    return await this.converter.buildSourceHeader(discordMessage, config);
  }

  /**
   * Make API call to Telegram Bot API
   */
  async callTelegramAPI(method, params = {}) {
    return await this.api.callTelegramAPI(method, params);
  }

  /**
   * Get Telegram bot information
   */
  async getBotInfo() {
    return await this.api.getBotInfo();
  }

  /**
   * Test Telegram functionality
   */
  async testTelegram(chatId) {
    if (!this.initialized) {
      return { error: 'Telegram handler not initialized' };
    }

    try {
      const testMessage = {
        author: { displayName: 'ProForwarder Test' },
        content: '🤖 **Test message** from ProForwarder!\n\nThis is a test of Discord to Telegram forwarding.',
        embeds: [],
        attachments: new Map(),
        stickers: new Map(),
        guild: { name: 'Test Server' }
      };

      const result = await this.sendMessage(chatId, testMessage);
      return { success: true, messageId: result.message_id || result.result?.message_id };
    } catch (error) {
      logError('Telegram test failed:', error);
      return { error: error.message };
    }
  }

  // ==========================================
  // LEGACY COMPATIBILITY METHODS
  // ==========================================

  /**
   * Legacy compatibility methods - redirect to new converter
   */
  async convertToHTML(text, message = null) {
    return await this.converter.convertDiscordToTelegramMarkdown(text, message);
  }

  async simpleMarkdownV2Convert(text, message = null) {
    return await this.converter.convertDiscordToTelegramMarkdown(text, message);
  }

  async convertDiscordToTelegramMarkdown(text, message = null) {
    return await this.converter.convertDiscordToTelegramMarkdown(text, message);
  }

  /**
   * Legacy text processing methods - redirect to new modules
   */
  findOptimalSplitPoint(text, maxLength) {
    return this.textSplitter.findOptimalSplitPoint(text, maxLength);
  }

  removeSeparatorLine(text) {
    return this.textSplitter.removeSeparatorLine(text);
  }

  hasProblematicUrls(text) {
    return this.textSplitter.hasProblematicUrls(text);
  }

  /**
   * Legacy media methods - redirect to new media handler
   */
  isImageFile(filename) {
    return this.mediaHandler.isImageFile(filename);
  }

  isVideoFile(filename) {
    return this.mediaHandler.isVideoFile(filename);
  }

  /**
   * Legacy text escaping - redirect to utils
   */
  escapeMarkdownV2ForText(text) {
    return this.utils.escapeMarkdownV2ForText(text);
  }
}

module.exports = TelegramHandler;