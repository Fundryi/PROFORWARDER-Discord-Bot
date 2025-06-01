const { logInfo, logSuccess, logError } = require('../utils/logger');
const https = require('https');
const FormatConverter = require('../utils/formatConverter');

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
   * Send message to Telegram chat
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
        
        // Send media with text as caption
        const result = await this.sendMediaWithCaption(chatId, telegramMessage.media, telegramMessage.text);
        return result;
      } else {
        if (isDebugMode) {
          logInfo(`🔍 SEND DEBUG: Sending text-only message`);
          logInfo(`🔍 SEND DEBUG: Final text: "${telegramMessage.text}"`);
          logInfo(`🔍 SEND DEBUG: Text length: ${telegramMessage.text.length} characters`);
        }
        
        // Send message with MarkdownV2 parsing using the converted message (includes embeds!)
        const messagePayload = {
          chat_id: chatId,
          text: telegramMessage.text,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: false
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
   * Send media with caption (supports formatted text)
   */
  async sendMediaWithCaption(chatId, media, caption) {
    try {
      const envConfig = require('../config/env');
      const isDebugMode = envConfig.debugMode;
      
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

    // Convert message content directly without author prefix
    if (discordMessage.content) {
      if (isDebugMode) {
        logInfo(`🔍 EMBED DEBUG: Converting main content: "${discordMessage.content}"`);
      }
      const convertedContent = this.convertDiscordToTelegramMarkdown(discordMessage.content);
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
          
          const convertedDescription = this.convertDiscordToTelegramMarkdown(description);
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
            const convertedFieldValue = this.convertDiscordToTelegramMarkdown(fieldValue);
            
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

    return {
      text: text,
      media: media
      // Don't include replyMarkup unless we actually have one
    };
  }

  /**
   * Legacy compatibility methods - redirect to FormatConverter
   */
  convertToHTML(text) {
    return FormatConverter.discordToTelegramHTML(text);
  }

  simpleMarkdownV2Convert(text) {
    return FormatConverter.discordToTelegramHTML(text);
  }

  convertDiscordToTelegramMarkdown(text) {
    return FormatConverter.discordToTelegramMarkdownV2(text);
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