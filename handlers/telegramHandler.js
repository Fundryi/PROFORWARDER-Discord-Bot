const { logInfo, logSuccess, logError } = require('../utils/logger');
const https = require('https');
const FormatConverter = require('../utils/formatConverter');
const AIFormatConverter = require('../utils/aiFormatConverter');

/**
 * Telegram Bot API Handler for ProForwarder
 * Handles message forwarding from Discord to Telegram
 */
class TelegramHandler {
  constructor() {
    this.botToken = null;
    this.apiUrl = 'https://api.telegram.org';
    this.initialized = false;
  }

  /**
   * Initialize Telegram handler with bot token
   */
  async initialize() {
    try {
      const config = require('../config/env');
      
      if (!config.telegram?.enabled) {
        logInfo('Telegram integration disabled in config');
        return false;
      }

      if (!config.telegram.botToken) {
        logError('Telegram bot token not provided');
        return false;
      }

      this.botToken = config.telegram.botToken;
      this.apiUrl = config.telegram.apiUrl || 'https://api.telegram.org';

      // Test the bot token by calling getMe
      const botInfo = await this.callTelegramAPI('getMe');
      if (botInfo && botInfo.ok) {
        logSuccess(`Telegram bot initialized: @${botInfo.result.username} (${botInfo.result.first_name})`);
        this.initialized = true;
        return true;
      } else {
        logError('Failed to initialize Telegram bot - invalid token or API error');
        return false;
      }
    } catch (error) {
      logError('Error initializing Telegram handler:', error);
      return false;
    }
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
      const telegramMessage = await this.convertDiscordMessage(message, config);
      
      const envConfig = require('../config/env');
      const isDebugMode = envConfig.debugMode;
      
      // If we have media, send it with the text as caption
      if (telegramMessage.media && telegramMessage.media.length > 0) {
        if (isDebugMode) {
          logInfo(`🔍 SEND DEBUG: Sending ${telegramMessage.media.length} media items with caption`);
          logInfo(`🔍 SEND DEBUG: Caption text: "${telegramMessage.text}"`);
          logInfo(`🔍 SEND DEBUG: Caption length: ${telegramMessage.text.length} characters`);
        }
        
        // Send media with text as caption (may return chain if split)
        const result = await this.sendMediaWithCaption(chatId, telegramMessage.media, telegramMessage.text);
        
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
          return await this.sendLongTextMessage(chatId, telegramMessage.text, telegramMessage.disableWebPagePreview);
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

        const result = await this.callTelegramAPI('sendMessage', messagePayload);

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
    try {
      const envConfig = require('../config/env');
      const isDebugMode = envConfig.debugMode;
      
      // Get caption length limit from config (default to 900 for safety)
      const captionLengthLimit = envConfig.telegram?.captionLengthLimit || 900;
      
      if (isDebugMode) {
        logInfo(`🔍 CAPTION LENGTH: Caption is ${caption.length} characters (limit: ${captionLengthLimit})`);
      }
      
      // Check if caption is too long
      if (caption.length > captionLengthLimit) {
        logInfo(`📏 Caption too long (${caption.length} chars), using smart splitting strategy`);
        return await this.sendMediaWithLongCaption(chatId, media, caption);
      }
      
      if (media.length === 1) {
        // Single media item - use sendPhoto/sendVideo with caption
        const mediaItem = media[0];
        let method = 'sendDocument'; // Default fallback
        
        if (mediaItem.type === 'photo') {
          method = 'sendPhoto';
        } else if (mediaItem.type === 'video') {
          method = 'sendVideo';
        }
        
        if (isDebugMode) {
          logInfo(`🔍 MEDIA DEBUG: Sending ${method} with caption`);
          logInfo(`🔍 MEDIA DEBUG: Raw caption: "${caption}"`);
          logInfo(`🔍 MEDIA DEBUG: Media URL: "${mediaItem.media}"`);
        }
        
        const result = await this.callTelegramAPI(method, {
          chat_id: chatId,
          [mediaItem.type === 'photo' ? 'photo' : mediaItem.type === 'video' ? 'video' : 'document']: mediaItem.media,
          caption: caption,
          parse_mode: 'MarkdownV2'
        });

        if (result && result.ok) {
          logSuccess(`📎 Sent ${mediaItem.type} with caption to Telegram chat ${chatId}`);
          return result.result;
        } else {
          throw new Error(`Media with caption send error: ${result ? result.description : 'Unknown error'}`);
        }
      } else {
        // Multiple media items - use sendMediaGroup with caption on first item
        if (isDebugMode) {
          logInfo(`🔍 MEDIA DEBUG: Sending media group with ${media.length} items`);
          logInfo(`🔍 MEDIA DEBUG: Caption on first item: "${caption}"`);
        }
        
        const mediaWithCaption = media.map((item, index) => ({
          ...item,
          caption: index === 0 ? caption : undefined,
          parse_mode: index === 0 ? 'MarkdownV2' : undefined
        }));

        if (isDebugMode) {
          logInfo(`🔍 MEDIA DEBUG: Media group payload: ${JSON.stringify(mediaWithCaption, null, 2)}`);
        }

        const result = await this.callTelegramAPI('sendMediaGroup', {
          chat_id: chatId,
          media: JSON.stringify(mediaWithCaption)
        });

        if (result && result.ok) {
          logSuccess(`📎 Sent ${media.length} media items with caption to Telegram chat ${chatId}`);
          return result.result;
        } else {
          throw new Error(`Media group with caption send error: ${result ? result.description : 'Unknown error'}`);
        }
      }
    } catch (error) {
      logError('Error sending media with caption:', error);
      throw error;
    }
  }

  /**
   * Handle long captions by intelligently splitting them
   * Returns message chain for proper tracking
   */
  async sendMediaWithLongCaption(chatId, media, fullCaption) {
    try {
      const envConfig = require('../config/env');
      const isDebugMode = envConfig.debugMode;
      const captionLengthLimit = envConfig.telegram?.captionLengthLimit || 900;
      const splitIndicator = envConfig.telegram?.splitIndicator || '...(continued)';
      const splitStrategy = envConfig.telegram?.captionSplitStrategy || 'smart';
      
      if (isDebugMode) {
        logInfo(`📏 SMART SPLIT: Processing long caption (${fullCaption.length} chars) using strategy: ${splitStrategy}`);
      }
      
      // Remove separator line when using splitting strategies to save space for content
      const fullCaptionWithoutSeparator = this.removeSeparatorLine(fullCaption);
      if (fullCaptionWithoutSeparator.length !== fullCaption.length) {
        logInfo(`📏 Removed separator line to save space: ${fullCaption.length} → ${fullCaptionWithoutSeparator.length} chars`);
      }
      
      // Handle different split strategies
      if (splitStrategy === 'separate') {
        // Send media separately with only header, then send full text
        logInfo(`📏 Using 'separate' strategy: sending media with header only, then full text`);
        return await this.sendMediaSeparately(chatId, media, fullCaptionWithoutSeparator);
      }
      
      // Default to smart splitting (using caption without separator)
      const splitPoint = this.findOptimalSplitPoint(fullCaptionWithoutSeparator, captionLengthLimit - splitIndicator.length - 10);
      
      const escapedSplitIndicator = FormatConverter.escapeMarkdownV2ForText(splitIndicator);
      const firstPart = fullCaptionWithoutSeparator.substring(0, splitPoint).trim() + '\n\n' + escapedSplitIndicator;
      const remainingPart = fullCaptionWithoutSeparator.substring(splitPoint).trim();
      
      if (isDebugMode) {
        logInfo(`📏 SMART SPLIT: First part (${firstPart.length} chars): "${firstPart.substring(0, 100)}..."`);
        logInfo(`📏 SMART SPLIT: Remaining part (${remainingPart.length} chars): "${remainingPart.substring(0, 100)}..."`);
      }
      
      // Send media with shortened caption
      let mediaResult;
      if (media.length === 1) {
        const mediaItem = media[0];
        let method = 'sendDocument';
        
        if (mediaItem.type === 'photo') {
          method = 'sendPhoto';
        } else if (mediaItem.type === 'video') {
          method = 'sendVideo';
        }
        
        mediaResult = await this.callTelegramAPI(method, {
          chat_id: chatId,
          [mediaItem.type === 'photo' ? 'photo' : mediaItem.type === 'video' ? 'video' : 'document']: mediaItem.media,
          caption: firstPart,
          parse_mode: 'MarkdownV2'
        });
      } else {
        const mediaWithCaption = media.map((item, index) => ({
          ...item,
          caption: index === 0 ? firstPart : undefined,
          parse_mode: index === 0 ? 'MarkdownV2' : undefined
        }));

        mediaResult = await this.callTelegramAPI('sendMediaGroup', {
          chat_id: chatId,
          media: JSON.stringify(mediaWithCaption)
        });
      }
      
      if (!mediaResult || !mediaResult.ok) {
        throw new Error(`Media send error: ${mediaResult ? mediaResult.description : 'Unknown error'}`);
      }
      
      // Send remaining text as separate message
      const textResult = await this.callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text: remainingPart,
        parse_mode: 'MarkdownV2'
      });
      
      if (!textResult || !textResult.ok) {
        throw new Error(`Follow-up text send error: ${textResult ? textResult.description : 'Unknown error'}`);
      }
      
      logSuccess(`📎 Sent media with smart-split caption to Telegram chat ${chatId} (${firstPart.length} + ${remainingPart.length} chars)`);
      
      // Return message chain data for database logging
      const primaryMessageId = Array.isArray(mediaResult.result) ? mediaResult.result[0].message_id : mediaResult.result.message_id;
      const secondaryMessageId = textResult.result.message_id;
      
      return {
        result: mediaResult.result,
        messageChain: [primaryMessageId.toString(), secondaryMessageId.toString()],
        isSplit: true
      };
      
    } catch (error) {
      logError('Error sending media with long caption:', error);
      throw error;
    }
  }

  /**
   * Handle long text messages by intelligently splitting them
   * Returns message chain for proper tracking
   */
  async sendLongTextMessage(chatId, fullText, disableWebPagePreview = false) {
    try {
      const envConfig = require('../config/env');
      const isDebugMode = envConfig.debugMode;
      const textLengthLimit = 4000; // Safe limit for text messages
      const splitIndicator = envConfig.telegram?.splitIndicator || '...(continued)';
      const splitStrategy = envConfig.telegram?.captionSplitStrategy || 'smart';
      
      if (isDebugMode) {
        logInfo(`📏 SMART TEXT SPLIT: Processing long text message (${fullText.length} chars) using strategy: ${splitStrategy}`);
      }
      
      const messages = [];
      let remainingText = fullText;
      let partIndex = 1;
      
      // No special preprocessing for text messages
      
      while (remainingText.length > 0) {
        let currentPart;
        
        if (remainingText.length <= textLengthLimit) {
          // Last part - send as is
          currentPart = remainingText;
          remainingText = '';
        } else {
          // Find optimal split point using smart splitting
          const availableLength = textLengthLimit - splitIndicator.length - 10;
          const splitPoint = this.findOptimalSplitPoint(remainingText, availableLength);
          
          const escapedSplitIndicator = FormatConverter.escapeMarkdownV2ForText(splitIndicator);
          currentPart = remainingText.substring(0, splitPoint).trim() + '\n\n' + escapedSplitIndicator;
          remainingText = remainingText.substring(splitPoint).trim();
        }
        
        if (isDebugMode) {
          logInfo(`📏 SMART TEXT SPLIT: Part ${partIndex} (${currentPart.length} chars): "${currentPart.substring(0, 100)}..."`);
        }
        
        // Send this part
        const result = await this.callTelegramAPI('sendMessage', {
          chat_id: chatId,
          text: currentPart,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: disableWebPagePreview
        });
        
        if (!result || !result.ok) {
          throw new Error(`Text part ${partIndex} send error: ${result ? result.description : 'Unknown error'}`);
        }
        
        messages.push(result.result.message_id.toString());
        partIndex++;
      }
      
      logSuccess(`📄 Sent long text message to Telegram chat ${chatId} (${messages.length} parts, ${fullText.length} total chars)`);
      
      // Return message chain data for database logging
      return {
        result: { message_id: messages[0] }, // Return first message as primary
        messageChain: messages,
        isSplit: messages.length > 1
      };
      
    } catch (error) {
      logError('Error sending long text message:', error);
      throw error;
    }
  }

  /**
   * Send media separately with header, then send full content as text
   */
  async sendMediaSeparately(chatId, media, fullContent) {
    try {
      const envConfig = require('../config/env');
      const isDebugMode = envConfig.debugMode;
      
      if (isDebugMode) {
        logInfo(`📏 SEPARATE STRATEGY: Sending ${media.length} media items with header only`);
      }
      
      // Extract header and content from the full content
      const lines = fullContent.split('\n');
      let headerEndIndex = -1;
      
      // Find the end of the header (look for the separator line with ━)
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('━')) {
          headerEndIndex = i;
          break;
        }
      }
      
      let headerForCaption = '';
      let contentWithoutHeader = fullContent;
      
      if (headerEndIndex >= 0) {
        // Found header separator, split content
        // Header for caption includes everything UP TO (but not including) the separator line
        headerForCaption = lines.slice(0, headerEndIndex).join('\n');
        // Content starts AFTER the separator line
        contentWithoutHeader = lines.slice(headerEndIndex + 1).join('\n').trim();
        
        if (isDebugMode) {
          logInfo(`📏 SEPARATE: Header for caption (${headerForCaption.length} chars): "${headerForCaption}"`);
          logInfo(`📏 SEPARATE: Content without header (${contentWithoutHeader.length} chars)`);
        }
      } else {
        // No header found - extract server info from the beginning
        // Look for the first double newline to separate header from content
        const doubleNewlineIndex = fullContent.indexOf('\n\n');
        if (doubleNewlineIndex > 0) {
          headerForCaption = fullContent.substring(0, doubleNewlineIndex).trim();
          contentWithoutHeader = fullContent.substring(doubleNewlineIndex + 2).trim();
        } else {
          headerForCaption = '';
          contentWithoutHeader = fullContent;
        }
        
        if (isDebugMode) {
          logInfo(`📏 SEPARATE: No separator found, extracted header (${headerForCaption.length} chars): "${headerForCaption}"`);
          logInfo(`📏 SEPARATE: Remaining content (${contentWithoutHeader.length} chars)`);
        }
      }
      
      // Send media with header as caption (or no caption if no header)
      let mediaResult;
      if (media.length === 1) {
        const mediaItem = media[0];
        let method = 'sendDocument';
        
        if (mediaItem.type === 'photo') {
          method = 'sendPhoto';
        } else if (mediaItem.type === 'video') {
          method = 'sendVideo';
        }
        
        const mediaPayload = {
          chat_id: chatId,
          [mediaItem.type === 'photo' ? 'photo' : mediaItem.type === 'video' ? 'video' : 'document']: mediaItem.media
        };
        
        // Add caption only if we have a header
        if (headerForCaption.trim()) {
          mediaPayload.caption = headerForCaption;
          mediaPayload.parse_mode = 'MarkdownV2';
        }
        
        mediaResult = await this.callTelegramAPI(method, mediaPayload);
      } else {
        const mediaItems = media.map((item, index) => {
          const mediaItem = { ...item };
          
          // Add caption to first item only if we have a header
          if (index === 0 && headerForCaption.trim()) {
            mediaItem.caption = headerForCaption;
            mediaItem.parse_mode = 'MarkdownV2';
          }
          
          return mediaItem;
        });

        mediaResult = await this.callTelegramAPI('sendMediaGroup', {
          chat_id: chatId,
          media: JSON.stringify(mediaItems)
        });
      }
      
      if (!mediaResult || !mediaResult.ok) {
        throw new Error(`Media send error: ${mediaResult ? mediaResult.description : 'Unknown error'}`);
      }
      
      // Determine web page preview settings (same logic as in convertDiscordMessage)
      let disableWebPagePreview = false;
      
      if (envConfig.telegram?.smartLinkPreviews === false) {
        // Always disable previews if smartLinkPreviews is disabled
        disableWebPagePreview = true;
      } else if (envConfig.telegram?.smartLinkPreviews !== false) {
        // Smart behavior (default):
        // Since we're sending media separately, we have media, so allow previews
        // But since this is a separate text message, disable previews to avoid conflicts
        disableWebPagePreview = true; // Disable for separate text messages to avoid duplicate previews
      }
      
      if (isDebugMode) {
        logInfo(`📏 SEPARATE: Web page preview disabled: ${disableWebPagePreview}`);
      }
      
      // Send full content as separate text message (up to 4000 chars)
      const textLengthLimit = 4000;
      let textResult;
      
      if (contentWithoutHeader.length <= textLengthLimit) {
        // Content fits in single message
        textResult = await this.callTelegramAPI('sendMessage', {
          chat_id: chatId,
          text: contentWithoutHeader,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: disableWebPagePreview
        });
        
        if (!textResult || !textResult.ok) {
          throw new Error(`Text send error: ${textResult ? textResult.description : 'Unknown error'}`);
        }
        
        logSuccess(`📎 Sent media separately + full text to Telegram chat ${chatId} (header: ${headerForCaption.length}, content: ${contentWithoutHeader.length} chars)`);
        
        // Return message chain data
        const primaryMessageId = Array.isArray(mediaResult.result) ? mediaResult.result[0].message_id : mediaResult.result.message_id;
        const secondaryMessageId = textResult.result.message_id;
        
        return {
          result: mediaResult.result,
          messageChain: [primaryMessageId.toString(), secondaryMessageId.toString()],
          isSplit: true
        };
      } else {
        // Content is too long, split it using smart splitting
        logInfo(`📏 SEPARATE: Content too long (${contentWithoutHeader.length} chars), using smart text splitting`);
        const textSplitResult = await this.sendLongTextMessage(chatId, contentWithoutHeader, disableWebPagePreview);
        
        // Combine media and text message IDs
        const primaryMessageId = Array.isArray(mediaResult.result) ? mediaResult.result[0].message_id : mediaResult.result.message_id;
        const allMessageIds = [primaryMessageId.toString(), ...textSplitResult.messageChain];
        
        logSuccess(`📎 Sent media separately + split text to Telegram chat ${chatId} (${allMessageIds.length} total messages)`);
        
        return {
          result: mediaResult.result,
          messageChain: allMessageIds,
          isSplit: true
        };
      }
      
    } catch (error) {
      logError('Error sending media separately:', error);
      throw error;
    }
  }


  /**
   * Remove separator line (━━━━━━━━━━━━━━━━━━━━━━━━━) when using splitting strategies
   */
  removeSeparatorLine(text) {
    // Look for the separator line pattern (multiple ━ characters)
    const separatorPattern = /\n━{10,}\n?/g;
    return text.replace(separatorPattern, '\n');
  }

  /**
   * Find optimal point to split long text while preserving formatting
   */
  findOptimalSplitPoint(text, maxLength) {
    if (text.length <= maxLength) {
      return text.length;
    }
    
    // Try to find good break points in order of preference
    const breakPoints = [
      // Double line breaks (paragraph separators)
      /\n\n/g,
      // Single line breaks
      /\n/g,
      // Sentence endings
      /[.!?]\s+/g,
      // Commas with spaces
      /,\s+/g,
      // Word boundaries
      /\s+/g
    ];
    
    for (const breakPattern of breakPoints) {
      const matches = [...text.matchAll(breakPattern)];
      
      // Find the best match within our limit
      let bestMatch = null;
      for (const match of matches) {
        if (match.index <= maxLength) {
          bestMatch = match;
        } else {
          break;
        }
      }
      
      if (bestMatch) {
        return bestMatch.index + bestMatch[0].length;
      }
    }
    
    // If no good break point found, cut at word boundary before limit
    let cutPoint = maxLength;
    while (cutPoint > 0 && text[cutPoint] !== ' ') {
      cutPoint--;
    }
    
    return Math.max(cutPoint, Math.floor(maxLength * 0.8)); // Ensure we don't cut too short
  }

  /**
   * Edit message caption for media messages
   */
  async editMessageCaption(chatId, messageId, newCaption) {
    try {
      const result = await this.callTelegramAPI('editMessageCaption', {
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
      const result = await this.callTelegramAPI('editMessageText', {
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
      const result = await this.callTelegramAPI('deleteMessage', {
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
   */
  async editMessageChain(chatId, messageChain, newFullText) {
    try {
      const envConfig = require('../config/env');
      const isDebugMode = envConfig.debugMode;
      const captionLengthLimit = envConfig.telegram?.captionLengthLimit || 900;
      
      if (isDebugMode) {
        logInfo(`✏️ CHAIN EDIT: Editing message chain with ${messageChain.length} messages`);
      }
      
      // Check if new text still needs splitting
      if (newFullText.length <= captionLengthLimit) {
        // Text now fits in single caption - need to restructure
        if (isDebugMode) {
          logInfo(`✏️ CHAIN EDIT: Text now fits in single caption, restructuring...`);
        }
        
        // Edit the first message (media caption)
        await this.editMessageCaption(chatId, messageChain[0], newFullText);
        
        // Delete the secondary text message since it's no longer needed
        for (let i = 1; i < messageChain.length; i++) {
          await this.deleteMessage(chatId, messageChain[i]);
        }
        
        return [messageChain[0]]; // Return new chain with just primary message
        
      } else {
        // Text still needs splitting
        const splitIndicator = envConfig.telegram?.splitIndicator || '...(continued)';
        const splitStrategy = envConfig.telegram?.captionSplitStrategy || 'smart';
        
        let splitPoint;
        if (splitStrategy === 'aismart') {
          splitPoint = await this.findAILanguageBoundary(newFullText, captionLengthLimit - splitIndicator.length - 10);
        } else {
          splitPoint = this.findOptimalSplitPoint(newFullText, captionLengthLimit - splitIndicator.length - 10);
        }
        
        const escapedSplitIndicator = FormatConverter.escapeMarkdownV2ForText(splitIndicator);
        const firstPart = newFullText.substring(0, splitPoint).trim() + '\n\n' + escapedSplitIndicator;
        const remainingPart = newFullText.substring(splitPoint).trim();
        
        if (isDebugMode) {
          logInfo(`✏️ CHAIN EDIT: Still needs splitting: ${firstPart.length} + ${remainingPart.length} chars`);
        }
        
        // Edit the first message (media caption)
        await this.editMessageCaption(chatId, messageChain[0], firstPart);
        
        // Edit or create secondary message
        if (messageChain.length > 1) {
          // Edit existing secondary message
          await this.editMessageText(chatId, messageChain[1], remainingPart);
        } else {
          // Create new secondary message
          const textResult = await this.callTelegramAPI('sendMessage', {
            chat_id: chatId,
            text: remainingPart,
            parse_mode: 'MarkdownV2'
          });
          
          if (textResult && textResult.ok) {
            messageChain.push(textResult.result.message_id.toString());
          }
        }
        
        return messageChain; // Return updated chain
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
   * Send media group to Telegram
   */
  async sendMediaGroup(chatId, media) {
    try {
      const result = await this.callTelegramAPI('sendMediaGroup', {
        chat_id: chatId,
        media: JSON.stringify(media)
      });

      if (result && result.ok) {
        logSuccess(`📎 Sent ${media.length} media items to Telegram chat ${chatId}`);
        return result.result;
      } else {
        throw new Error(`Media send error: ${result ? result.description : 'Unknown error'}`);
      }
    } catch (error) {
      logError('Error sending media group:', error);
      throw error;
    }
  }

  /**
   * Convert Discord message to Telegram format
   */
  async convertDiscordMessage(discordMessage, config = {}) {
    const envConfig = require('../config/env');
    const isDebugMode = envConfig.debugMode;
    
    let text = '';
    const media = [];

    if (isDebugMode) {
      logInfo('🔍 EMBED DEBUG: Starting Discord message conversion');
      logInfo(`🔍 EMBED DEBUG: Message content: "${discordMessage.content || 'NO CONTENT'}"`);
    }

    // Add source header for Discord server and channel
    const sourceHeader = await this.buildSourceHeader(discordMessage, config);
    if (sourceHeader) {
      text += sourceHeader + '\n\n';
    }

    // Convert message content directly without author prefix
    if (discordMessage.content) {
      if (isDebugMode) {
        logInfo(`🔍 EMBED DEBUG: Converting main content: "${discordMessage.content}"`);
      }
      const convertedContent = await this.convertDiscordToTelegramMarkdown(discordMessage.content, discordMessage);
      if (isDebugMode) {
        logInfo(`🔍 EMBED DEBUG: Converted main content: "${convertedContent}"`);
      }
      text += convertedContent;
    }

    // Handle embeds with better formatting
    if (discordMessage.embeds && discordMessage.embeds.length > 0) {
      if (isDebugMode) {
        logInfo(`🔍 EMBED DEBUG: Processing ${discordMessage.embeds.length} embeds`);
      }
      
      for (let i = 0; i < discordMessage.embeds.length; i++) {
        const embed = discordMessage.embeds[i];
        if (isDebugMode) {
          logInfo(`🔍 EMBED DEBUG: --- Processing Embed ${i + 1} ---`);
        }
        
        // Add spacing if there's already content
        if (text.trim()) {
          text += '\n\n';
        }
        
        if (embed.title) {
          if (isDebugMode) {
            logInfo(`🔍 EMBED DEBUG: Embed title: "${embed.title}"`);
          }
          const escapedTitle = FormatConverter.escapeMarkdownV2ForText(embed.title);
          if (isDebugMode) {
            logInfo(`🔍 EMBED DEBUG: Escaped title: "${escapedTitle}"`);
          }
          text += `*${escapedTitle}*\n`;
        }
        
        if (embed.description || embed.rawDescription) {
          const description = embed.rawDescription || embed.description;
          if (isDebugMode) {
            logInfo(`🔍 EMBED DEBUG: Raw embed description: "${description}"`);
            logInfo(`🔍 EMBED DEBUG: Description source: ${embed.rawDescription ? 'rawDescription' : 'description'}`);
          }
          
          const convertedDescription = await this.convertDiscordToTelegramMarkdown(description, discordMessage);
          if (isDebugMode) {
            logInfo(`🔍 EMBED DEBUG: Converted description: "${convertedDescription}"`);
          }
          
          text += `${convertedDescription}\n`;
        }
        
        if (embed.url) {
          if (isDebugMode) {
            logInfo(`🔍 EMBED DEBUG: Embed URL: "${embed.url}"`);
          }
          text += `🔗 [Link](${embed.url})\n`;
        }
        
        // Handle embed images
        if (embed.image && embed.image.url) {
          if (isDebugMode) {
            logInfo(`🔍 EMBED DEBUG: Adding embed image: "${embed.image.url}"`);
          }
          media.push({
            type: 'photo',
            media: embed.image.url
          });
        }
        
        // Handle embed thumbnails
        if (embed.thumbnail && embed.thumbnail.url) {
          if (isDebugMode) {
            logInfo(`🔍 EMBED DEBUG: Adding embed thumbnail: "${embed.thumbnail.url}"`);
          }
          media.push({
            type: 'photo',
            media: embed.thumbnail.url
          });
        }
        
        // Add fields with better formatting
        if (embed.fields && embed.fields.length > 0) {
          if (isDebugMode) {
            logInfo(`🔍 EMBED DEBUG: Processing ${embed.fields.length} fields`);
          }
          
          for (let j = 0; j < embed.fields.length; j++) {
            const field = embed.fields[j];
            const fieldName = field.rawName || field.name;
            const fieldValue = field.rawValue || field.value;
            
            if (isDebugMode) {
              logInfo(`🔍 EMBED DEBUG: Field ${j + 1} name: "${fieldName}"`);
              logInfo(`🔍 EMBED DEBUG: Field ${j + 1} value: "${fieldValue}"`);
            }
            
            const escapedFieldName = FormatConverter.escapeMarkdownV2ForText(fieldName);
            const convertedFieldValue = await this.convertDiscordToTelegramMarkdown(fieldValue, discordMessage);
            
            if (isDebugMode) {
              logInfo(`🔍 EMBED DEBUG: Field ${j + 1} escaped name: "${escapedFieldName}"`);
              logInfo(`🔍 EMBED DEBUG: Field ${j + 1} converted value: "${convertedFieldValue}"`);
            }
            
            text += `\n*${escapedFieldName}:*\n${convertedFieldValue}\n`;
          }
        }
        
        if (isDebugMode) {
          logInfo(`🔍 EMBED DEBUG: Text after embed ${i + 1}: "${text}"`);
        }
      }
      
      if (isDebugMode) {
        logInfo(`🔍 EMBED DEBUG: Final combined text with all embeds: "${text}"`);
        logInfo(`🔍 EMBED DEBUG: Media items found: ${media.length}`);
        media.forEach((item, index) => {
          logInfo(`🔍 EMBED DEBUG: Media ${index + 1}: ${item.type} - ${item.media}`);
        });
      }
    }

    // Handle attachments with better integration
    if (discordMessage.attachments && discordMessage.attachments.size > 0) {
      for (const attachment of discordMessage.attachments.values()) {
        if (this.isImageFile(attachment.name)) {
          // Add to media group
          media.push({
            type: 'photo',
            media: attachment.url
          });
        } else if (this.isVideoFile(attachment.name)) {
          // Add to media group
          media.push({
            type: 'video',
            media: attachment.url
          });
        } else {
          // Add as file link in text only if we don't have media
          // (if we have media, the text will be sent as caption)
          if (text.trim()) {
            text += `\n📎 [${FormatConverter.escapeMarkdownV2ForText(attachment.name)}](${attachment.url})`;
          } else {
            text += `📎 [${FormatConverter.escapeMarkdownV2ForText(attachment.name)}](${attachment.url})`;
          }
        }
      }
    }

    // Handle stickers with better formatting
    if (discordMessage.stickers && discordMessage.stickers.size > 0) {
      const stickerNames = Array.from(discordMessage.stickers.values())
        .map(sticker => sticker.name)
        .join(', ');
      
      if (text.trim()) {
        text += `\n🎭 ${FormatConverter.escapeMarkdownV2ForText(stickerNames)}`;
      } else {
        text += `🎭 ${FormatConverter.escapeMarkdownV2ForText(stickerNames)}`;
      }
    }

    // Ensure we have some content with a cleaner fallback
    if (!text.trim() && media.length === 0) {
      text = '💬 *Message*';
    }

    // Determine whether to disable web page previews
    let disableWebPagePreview = false;
    
    if (envConfig.telegram?.smartLinkPreviews === false) {
      // Always disable previews if smartLinkPreviews is disabled
      disableWebPagePreview = true;
    } else if (envConfig.telegram?.smartLinkPreviews !== false) {
      // Smart behavior (default):
      // - If Discord has images/videos: Allow previews (Telegram will show images, not link previews)
      // - If Discord has only text/links: Disable previews (prevent big link previews)
      disableWebPagePreview = media.length === 0;
    }

    return {
      text: text,
      media: media,
      disableWebPagePreview: disableWebPagePreview
      // Don't include replyMarkup unless we actually have one
    };
  }

  /**
   * Build source header showing Discord server and channel
   */
  async buildSourceHeader(discordMessage, config = {}) {
    try {
      const envConfig = require('../config/env');
      const isDebugMode = envConfig.debugMode;
      
      // Skip header if disabled in config
      if (config.hideSourceHeader || envConfig.telegram?.hideSourceHeader) {
        return null;
      }

      if (!discordMessage.guild || !discordMessage.channel) {
        if (isDebugMode) {
          logInfo('🔍 SOURCE DEBUG: No guild or channel info available');
        }
        return null;
      }

      // Get Discord invite manager
      const discordInviteManager = require('../utils/discordInviteManager');
      
      // Get server name and invite link
      const serverName = discordMessage.guild.name;
      const inviteLink = await discordInviteManager.getGuildInvite(discordMessage.guild);
      
      // Get channel name
      const channelName = discordMessage.channel.name;
      
      if (isDebugMode) {
        logInfo(`🔍 SOURCE DEBUG: Server: ${serverName}, Channel: ${channelName}, Invite: ${inviteLink}`);
      }

      // Build header with proper escaping for MarkdownV2
      let header = '';
      
      if (inviteLink) {
        // Server name as clickable link
        const escapedServerName = this.escapeMarkdownV2ForText(serverName);
        const escapedInviteLink = inviteLink.replace(/([)\\])/g, '\\$1');
        header += `[${escapedServerName}](${escapedInviteLink})`;
      } else {
        // Server name as plain text if no invite available
        header += this.escapeMarkdownV2ForText(serverName);
      }
      
      // Add arrow and channel name
      header += ` → `;
      header += `\\#${this.escapeMarkdownV2ForText(channelName)}`;
      
      // Add elegant separator using Unicode box drawing characters
      // These work well in Telegram and look clean on all screen sizes
      const separator = '━'.repeat(25); // Unicode heavy horizontal line
      header += `\n${separator}`;

      if (isDebugMode) {
        logInfo(`🔍 SOURCE DEBUG: Built header: "${header}"`);
      }

      return header;
    } catch (error) {
      logError('Error building source header:', error);
      return null;
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

  /**
   * Legacy compatibility methods - redirect to FormatConverter
   */
  async convertToHTML(text, message = null) {
    return await AIFormatConverter.convertDiscordToTelegramMarkdownV2(text, message);
  }

  async simpleMarkdownV2Convert(text, message = null) {
    return await AIFormatConverter.convertDiscordToTelegramMarkdownV2(text, message);
  }

  async convertDiscordToTelegramMarkdown(text, message = null) {
    return await AIFormatConverter.convertDiscordToTelegramMarkdownV2(text, message);
  }

  /**
   * Check if file is an image
   */
  isImageFile(filename) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    return imageExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }

  /**
   * Check if file is a video
   */
  isVideoFile(filename) {
    const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'];
    return videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }

  /**
   * Make API call to Telegram Bot API
   */
  async callTelegramAPI(method, params = {}) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(params);
      
      const options = {
        hostname: this.apiUrl.replace('https://', '').replace('http://', ''),
        port: 443,
        path: `/bot${this.botToken}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            resolve(response);
          } catch (error) {
            reject(new Error('Invalid JSON response from Telegram API'));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Get Telegram bot information
   */
  async getBotInfo() {
    if (!this.initialized) {
      return { error: 'Telegram handler not initialized' };
    }

    try {
      const result = await this.callTelegramAPI('getMe');
      return result;
    } catch (error) {
      logError('Error getting bot info:', error);
      return { error: error.message };
    }
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
      return { success: true, messageId: result.message_id };
    } catch (error) {
      logError('Telegram test failed:', error);
      return { error: error.message };
    }
  }
}

module.exports = TelegramHandler;