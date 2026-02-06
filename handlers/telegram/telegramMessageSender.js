const { logInfo, logSuccess, logError } = require('../../utils/logger');
const FormatConverter = require('../../utils/formatConverter');
const TelegramTextSplitter = require('./telegramTextSplitter');
const TelegramMediaHandler = require('./telegramMediaHandler');

/**
 * Telegram Message Sender - All message sending logic and strategies
 * Handles media with captions, long captions, text splitting, and separate sending
 */
class TelegramMessageSender {
  constructor(telegramAPI) {
    this.api = telegramAPI;
    this.textSplitter = new TelegramTextSplitter();
    this.mediaHandler = new TelegramMediaHandler();
  }

  /**
   * Send media with caption (supports formatted text with smart length handling)
   */
  async sendMediaWithCaption(chatId, media, caption) {
    try {
      const envConfig = require('../../config/config');
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
        
        const result = await this.api.callTelegramAPI(method, {
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

        const result = await this.api.callTelegramAPI('sendMediaGroup', {
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
      const envConfig = require('../../config/config');
      const isDebugMode = envConfig.debugMode;
      const captionLengthLimit = envConfig.telegram?.captionLengthLimit || 900;
      const splitIndicator = envConfig.telegram?.splitIndicator || '...(continued)';
      const splitStrategy = envConfig.telegram?.captionSplitStrategy || 'smart';
      
      if (isDebugMode) {
        logInfo(`📏 SMART SPLIT: Processing long caption (${fullCaption.length} chars) using strategy: ${splitStrategy}`);
        logInfo(`📏 SMART SPLIT: Media array contains ${media.length} items`);
        media.forEach((item, index) => {
          logInfo(`📏 SMART SPLIT DEBUG: Media ${index + 1}: type=${item.type}, url="${item.media}"`);
        });
      }
      
      // Remove separator line when using splitting strategies to save space for content
      const fullCaptionWithoutSeparator = this.textSplitter.removeSeparatorLine(fullCaption);
      if (fullCaptionWithoutSeparator.length !== fullCaption.length) {
        logInfo(`📏 Removed separator line to save space: ${fullCaption.length} → ${fullCaptionWithoutSeparator.length} chars`);
      }
      
      // Handle different split strategies
      if (splitStrategy === 'separate') {
        // Simple fix: Disable separate strategy for messages with embed media due to WEBPAGE_MEDIA_EMPTY issues
        // Check if media contains any potential embed-sourced URLs that could cause issues
        const hasEmbedMedia = this.mediaHandler.hasEmbedMedia(media);
        
        if (hasEmbedMedia) {
          logInfo(`📏 Detected embed-sourced media, falling back to text splitting to avoid WEBPAGE_MEDIA_EMPTY error`);
          // Fall back to smart splitting as text-only
          const splitPoint = this.textSplitter.findOptimalSplitPoint(fullCaptionWithoutSeparator, captionLengthLimit - splitIndicator.length - 10);
          const escapedSplitIndicator = FormatConverter.escapeMarkdownV2ForText(splitIndicator);
          const firstPart = fullCaptionWithoutSeparator.substring(0, splitPoint).trim() + '\n\n' + escapedSplitIndicator;
          const remainingPart = fullCaptionWithoutSeparator.substring(splitPoint).trim();
          
          // Send as text messages instead
          const firstResult = await this.api.callTelegramAPI('sendMessage', {
            chat_id: chatId,
            text: firstPart,
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: true
          });
          
          const secondResult = await this.api.callTelegramAPI('sendMessage', {
            chat_id: chatId,
            text: remainingPart,
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: true
          });
          
          logSuccess(`📄 Sent content as text-only messages (embed media detected): ${firstPart.length} + ${remainingPart.length} chars`);
          
          return {
            result: firstResult.result,
            messageChain: [firstResult.result.message_id.toString(), secondResult.result.message_id.toString()],
            isSplit: true
          };
        }
        
        // Send media separately with only header, then send full text (only for clean media)
        logInfo(`📏 Using 'separate' strategy: sending ${media.length} clean media items with header, then full text`);
        return await this.sendMediaSeparately(chatId, media, fullCaptionWithoutSeparator);
      }
      
      // Default to smart splitting (using caption without separator)
      const splitPoint = this.textSplitter.findOptimalSplitPoint(fullCaptionWithoutSeparator, captionLengthLimit - splitIndicator.length - 10);
      
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
        
        mediaResult = await this.api.callTelegramAPI(method, {
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

        mediaResult = await this.api.callTelegramAPI('sendMediaGroup', {
          chat_id: chatId,
          media: JSON.stringify(mediaWithCaption)
        });
      }
      
      if (!mediaResult || !mediaResult.ok) {
        throw new Error(`Media send error: ${mediaResult ? mediaResult.description : 'Unknown error'}`);
      }
      
      // Send remaining text as separate message
      const textResult = await this.api.callTelegramAPI('sendMessage', {
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
      const envConfig = require('../../config/config');
      const isDebugMode = envConfig.debugMode;
      const textLengthLimit = 4000; // Safe limit for text messages
      const splitIndicator = envConfig.telegram?.splitIndicator || '...(continued)';
      
      if (isDebugMode) {
        logInfo(`📏 SMART TEXT SPLIT: Processing long text message (${fullText.length} chars)`);
      }
      
      const messages = [];
      let remainingText = fullText;
      let partIndex = 1;
      
      while (remainingText.length > 0) {
        let currentPart;
        
        if (remainingText.length <= textLengthLimit) {
          // Last part - send as is
          currentPart = remainingText;
          remainingText = '';
        } else {
          // Find optimal split point using smart splitting
          const availableLength = textLengthLimit - splitIndicator.length - 10;
          const splitPoint = this.textSplitter.findOptimalSplitPoint(remainingText, availableLength);
          
          const escapedSplitIndicator = FormatConverter.escapeMarkdownV2ForText(splitIndicator);
          currentPart = remainingText.substring(0, splitPoint).trim() + '\n\n' + escapedSplitIndicator;
          remainingText = remainingText.substring(splitPoint).trim();
        }
        
        if (isDebugMode) {
          logInfo(`📏 SMART TEXT SPLIT: Part ${partIndex} (${currentPart.length} chars): "${currentPart.substring(0, 100)}..."`);
        }
        
        // Send this part
        const result = await this.api.callTelegramAPI('sendMessage', {
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
      const envConfig = require('../../config/config');
      const isDebugMode = envConfig.debugMode;
      
      if (isDebugMode) {
        logInfo(`📏 SEPARATE STRATEGY: Attempting to send ${media.length} media items`);
        media.forEach((item, index) => {
          logInfo(`📏 SEPARATE DEBUG: Media ${index + 1}: type=${item.type}, url="${item.media}"`);
        });
      }
      
      // Check if we actually have valid media
      if (!media || media.length === 0) {
        if (isDebugMode) {
          logInfo(`📏 SEPARATE: No media found, falling back to regular text message`);
        }
        // No media - just send as regular text message
        return await this.sendLongTextMessage(chatId, fullContent);
      }
      
      // Validate media URLs - filter out Discord proxy URLs and invalid URLs
      const validMedia = this.mediaHandler.filterValidMedia(media);
      
      if (validMedia.length === 0) {
        if (isDebugMode) {
          logInfo(`📏 SEPARATE: No valid media URLs found (all were Discord proxies), falling back to regular text message`);
        }
        // No valid media URLs - just send as regular text message
        return await this.sendLongTextMessage(chatId, fullContent);
      }
      
      if (validMedia.length !== media.length) {
        logInfo(`📏 SEPARATE: Filtered out ${media.length - validMedia.length} invalid/proxy media items, ${validMedia.length} valid items remaining`);
      }
      
      // Extract header and content from the full content
      const { header: headerForCaption, content: contentWithoutHeader } = this.textSplitter.extractHeader(fullContent);
      
      if (isDebugMode) {
        logInfo(`📏 SEPARATE: Header for caption (${headerForCaption.length} chars): "${headerForCaption}"`);
        logInfo(`📏 SEPARATE: Content without header (${contentWithoutHeader.length} chars)`);
      }
      
      // Send media with header as caption (or no caption if no header)
      let mediaResult;
      if (validMedia.length === 1) {
        mediaResult = await this.sendSingleMediaWithHeader(chatId, validMedia[0], headerForCaption, isDebugMode);
      } else {
        mediaResult = await this.sendMediaGroupWithHeader(chatId, validMedia, headerForCaption, isDebugMode);
      }
      
      if (!mediaResult || !mediaResult.ok) {
        throw new Error(`Media send error: ${mediaResult ? mediaResult.description : 'Unknown error'}`);
      }
      
      // Determine web page preview settings
      const disableWebPagePreview = this.shouldDisablePreviewForSeparate(envConfig);
      
      // Send full content as separate text message
      const textResult = await this.sendSeparateTextContent(chatId, headerForCaption, contentWithoutHeader, disableWebPagePreview, isDebugMode);
      
      // Combine results
      const primaryMessageId = Array.isArray(mediaResult.result) ? mediaResult.result[0].message_id : mediaResult.result.message_id;
      
      if (Array.isArray(textResult.messageChain)) {
        // Text was split into multiple messages
        const allMessageIds = [primaryMessageId.toString(), ...textResult.messageChain];
        logSuccess(`📎 Sent media separately + split text to Telegram chat ${chatId} (${allMessageIds.length} total messages)`);
        
        return {
          result: mediaResult.result,
          messageChain: allMessageIds,
          isSplit: true
        };
      } else {
        // Single text message
        const secondaryMessageId = textResult.result.message_id;
        logSuccess(`📎 Sent media separately + full text to Telegram chat ${chatId} (header: ${headerForCaption.length}, content: ${contentWithoutHeader.length} chars)`);
        
        return {
          result: mediaResult.result,
          messageChain: [primaryMessageId.toString(), secondaryMessageId.toString()],
          isSplit: true
        };
      }
      
    } catch (error) {
      logError('Error sending media separately:', error);
      throw error;
    }
  }

  /**
   * Send single media item with header as caption
   */
  async sendSingleMediaWithHeader(chatId, mediaItem, headerForCaption, isDebugMode) {
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
    
    // Add caption only if we have a header (but check for problematic URLs)
    if (headerForCaption.trim()) {
      // Check if header contains URLs that might cause WEBPAGE_CURL_FAILED
      const hasProblematicUrls = this.textSplitter.hasProblematicUrls(headerForCaption);
      
      if (hasProblematicUrls) {
        if (isDebugMode) {
          logInfo(`📏 SEPARATE: Header contains problematic URLs, sending without caption to avoid WEBPAGE_CURL_FAILED`);
        }
        // Don't add caption with problematic URLs
      } else {
        mediaPayload.caption = headerForCaption;
        mediaPayload.parse_mode = 'MarkdownV2';
      }
    }
    
    if (isDebugMode) {
      logInfo(`📏 SEPARATE: Sending ${method} with media`);
    }
    
    return await this.api.callTelegramAPI(method, mediaPayload);
  }

  /**
   * Send media group with header as caption on first item
   */
  async sendMediaGroupWithHeader(chatId, validMedia, headerForCaption, isDebugMode) {
    const hasProblematicUrls = headerForCaption.trim() ? this.textSplitter.hasProblematicUrls(headerForCaption) : false;
    
    const mediaItems = validMedia.map((item, index) => {
      const mediaItem = { ...item };
      
      // Add caption to first item only if we have a header and no problematic URLs
      if (index === 0 && headerForCaption.trim() && !hasProblematicUrls) {
        mediaItem.caption = headerForCaption;
        mediaItem.parse_mode = 'MarkdownV2';
      }
      
      return mediaItem;
    });

    if (isDebugMode) {
      if (hasProblematicUrls) {
        logInfo(`📏 SEPARATE: Media group header contains problematic URLs, sending without caption`);
      }
      logInfo(`📏 SEPARATE: Sending media group with ${validMedia.length} items`);
    }

    return await this.api.callTelegramAPI('sendMediaGroup', {
      chat_id: chatId,
      media: JSON.stringify(mediaItems)
    });
  }

  /**
   * Send separate text content, handling both short and long text
   */
  async sendSeparateTextContent(chatId, headerForCaption, contentWithoutHeader, disableWebPagePreview, isDebugMode) {
    // Check if we need to include the header in the text message
    let textToSend = contentWithoutHeader;
    const hasProblematicUrls = headerForCaption.trim() ? this.textSplitter.hasProblematicUrls(headerForCaption) : false;
    
    if (hasProblematicUrls && headerForCaption.trim()) {
      // Header was skipped from media caption due to problematic URLs, include it in text
      textToSend = headerForCaption + '\n\n' + contentWithoutHeader;
      if (isDebugMode) {
        logInfo(`📏 SEPARATE: Including header in text message due to problematic URLs in caption`);
      }
    }
    
    const textLengthLimit = 4000;
    
    if (textToSend.length <= textLengthLimit) {
      // Content fits in single message
      const textResult = await this.api.callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text: textToSend,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: disableWebPagePreview
      });
      
      if (!textResult || !textResult.ok) {
        throw new Error(`Text send error: ${textResult ? textResult.description : 'Unknown error'}`);
      }
      
      return textResult;
    } else {
      // Content is too long, split it using smart splitting
      logInfo(`📏 SEPARATE: Content too long (${textToSend.length} chars), using smart text splitting`);
      return await this.sendLongTextMessage(chatId, textToSend, disableWebPagePreview);
    }
  }

  /**
   * Determine web page preview settings for separate strategy
   */
  shouldDisablePreviewForSeparate(envConfig) {
    if (envConfig.telegram?.smartLinkPreviews === false) {
      // Always disable previews if smartLinkPreviews is disabled
      return true;
    } else if (envConfig.telegram?.smartLinkPreviews !== false) {
      // Smart behavior (default):
      // Since we're sending media separately, we have media, so allow previews
      // But since this is a separate text message, disable previews to avoid conflicts
      return true; // Disable for separate text messages to avoid duplicate previews
    }
    
    return false;
  }

  /**
   * Send media group to Telegram
   */
  async sendMediaGroup(chatId, media) {
    try {
      const result = await this.api.callTelegramAPI('sendMediaGroup', {
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
}

module.exports = TelegramMessageSender;