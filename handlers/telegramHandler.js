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

  getTelegramErrorMessage(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (typeof error.message === 'string') return error.message;
    return String(error);
  }

  isMarkdownEntityError(errorMessage) {
    const message = String(errorMessage || '');
    return /can't parse entities|parse entities|character '.+' is reserved/i.test(message);
  }

  isWebPreviewMediaError(errorMessage) {
    return /(WEBPAGE_MEDIA_EMPTY|WEBPAGE_CURL_FAILED)/i.test(String(errorMessage || ''));
  }

  async sendPlainTextMessage(chatId, text, disableWebPagePreview = false, replyMarkup = null) {
    const payload = {
      chat_id: chatId,
      text: text,
      disable_web_page_preview: disableWebPagePreview
    };

    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const result = await this.api.callTelegramAPI('sendMessage', payload);
    if (result && result.ok) {
      return result.result;
    }

    throw new Error(`Telegram API error (plain text fallback): ${result ? result.description : 'Unknown error'}`);
  }

  async sendPlainTextSplit(chatId, fullText, disableWebPagePreview = false) {
    const textLengthLimit = 4000;
    const splitIndicator = '...(continued)';
    const parts = this.textSplitter.splitLongText(fullText, textLengthLimit, splitIndicator);
    const sentMessages = [];

    for (let i = 0; i < parts.length; i++) {
      const messageResult = await this.sendPlainTextMessage(chatId, parts[i], disableWebPagePreview, null);
      sentMessages.push(messageResult);
    }

    if (sentMessages.length === 1) {
      return sentMessages[0];
    }

    return {
      result: sentMessages[0],
      messageChain: sentMessages.map(msg => String(msg.message_id)),
      isSplit: true
    };
  }

  async sendTextWithFallback(chatId, text, disableWebPagePreview = false, replyMarkup = null) {
    const textLengthLimit = 4000;

    if (text.length > textLengthLimit) {
      try {
        return await this.messageSender.sendLongTextMessage(chatId, text, disableWebPagePreview);
      } catch (error) {
        const errorMessage = this.getTelegramErrorMessage(error);
        if (!this.isMarkdownEntityError(errorMessage)) {
          throw error;
        }

        logInfo(`Telegram MarkdownV2 split send failed, retrying plain text split fallback: ${errorMessage}`);
        return await this.sendPlainTextSplit(chatId, text, disableWebPagePreview);
      }
    }

    const markdownPayload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: disableWebPagePreview
    };

    if (replyMarkup) {
      markdownPayload.reply_markup = replyMarkup;
    }

    const markdownResult = await this.api.callTelegramAPI('sendMessage', markdownPayload);
    if (markdownResult && markdownResult.ok) {
      return markdownResult.result;
    }

    const apiError = markdownResult ? markdownResult.description : 'Unknown error';
    if (!this.isMarkdownEntityError(apiError)) {
      throw new Error(`Telegram API error: ${apiError}`);
    }

    logInfo(`Telegram MarkdownV2 send failed, retrying plain text fallback: ${apiError}`);
    return await this.sendPlainTextMessage(chatId, text, disableWebPagePreview, replyMarkup);
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
      
      const envConfig = require('../config/config');
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

          // Force disable web page previews for embed-media fallback mode.
          const disablePreview = true;
          const fallbackResult = await this.sendTextWithFallback(
            chatId,
            telegramMessage.text,
            disablePreview,
            telegramMessage.replyMarkup || null
          );
          logSuccess(`✅ Message sent to Telegram chat ${chatId} as text-only fallback (embed media filtered)`);
          return fallbackResult;
        }

        // Send media with caption; if Telegram formatting/preview errors occur, fallback to text-only.
        try {
          const result = await this.messageSender.sendMediaWithCaption(chatId, telegramMessage.media, telegramMessage.text);
          if (result.isSplit && result.messageChain) {
            return result;
          }
          return result;
        } catch (mediaError) {
          const mediaErrorMessage = this.getTelegramErrorMessage(mediaError);
          const canFallback = this.isMarkdownEntityError(mediaErrorMessage) || this.isWebPreviewMediaError(mediaErrorMessage);

          if (!canFallback) {
            throw mediaError;
          }

          logInfo(`Telegram media send failed, retrying as text-only fallback: ${mediaErrorMessage}`);
          return await this.sendTextWithFallback(
            chatId,
            telegramMessage.text,
            true,
            telegramMessage.replyMarkup || null
          );
        }
      } else {
        if (isDebugMode) {
          logInfo(`🔍 SEND DEBUG: Sending text-only message`);
          logInfo(`🔍 SEND DEBUG: Final text: "${telegramMessage.text}"`);
          logInfo(`🔍 SEND DEBUG: Text length: ${telegramMessage.text.length} characters`);
        }
        
        const result = await this.sendTextWithFallback(
          chatId,
          telegramMessage.text,
          telegramMessage.disableWebPagePreview || false,
          telegramMessage.replyMarkup || null
        );

        logSuccess(`✅ Message sent to Telegram chat ${chatId} (with MarkdownV2 fallback protection)`);
        return result;
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
  async editMessageText(chatId, messageId, newText, disableWebPagePreview = false) {
    return await this.utils.editMessageText(chatId, messageId, newText, disableWebPagePreview);
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
  async editMessageChain(chatId, messageChain, newFullText, hasMedia, disableWebPagePreview = false) {
    return await this.utils.editMessageChain(chatId, messageChain, newFullText, hasMedia, disableWebPagePreview);
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
