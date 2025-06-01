const { logInfo, logSuccess, logError } = require('../utils/logger');
const https = require('https');

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
      
      // If we have media, send it with the text as caption
      if (telegramMessage.media && telegramMessage.media.length > 0) {
        // Send media with text as caption
        const result = await this.sendMediaWithCaption(chatId, telegramMessage.media, telegramMessage.text);
        return result;
      } else {
        // Check if message has italic text for debugging
        const hasItalic = message.content && message.content.includes('*') && !message.content.includes('**');
        
        if (hasItalic) {
          // DEBUG: Send both versions for comparison
          logInfo('🔍 DEBUG: Found italic text, sending both Markdown and MarkdownV2 versions');
          
          // First try with regular Markdown
          try {
            const markdownPayload = {
              chat_id: chatId,
              text: this.convertToRegularMarkdown(message.content),
              parse_mode: 'Markdown',
              disable_web_page_preview: false
            };
            
            const markdownResult = await this.callTelegramAPI('sendMessage', markdownPayload);
            if (markdownResult && markdownResult.ok) {
              logInfo('✅ Markdown version sent successfully');
            }
          } catch (markdownError) {
            logError('❌ Markdown version failed:', markdownError.message);
          }
          
          // Then try with MarkdownV2
          try {
            const markdownV2Payload = {
              chat_id: chatId,
              text: telegramMessage.text,
              parse_mode: 'MarkdownV2',
              disable_web_page_preview: false
            };
            
            const markdownV2Result = await this.callTelegramAPI('sendMessage', markdownV2Payload);
            if (markdownV2Result && markdownV2Result.ok) {
              logInfo('✅ MarkdownV2 version sent successfully');
              return markdownV2Result.result;
            }
          } catch (markdownV2Error) {
            logError('❌ MarkdownV2 version failed:', markdownV2Error.message);
          }
        }
        
        // Send message with MarkdownV2 but minimal conversion
        const messagePayload = {
          chat_id: chatId,
          text: this.simpleMarkdownV2Convert(message.content || ''),
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: false
        };

        // Only add reply_markup if it's actually provided
        if (telegramMessage.replyMarkup) {
          messagePayload.reply_markup = telegramMessage.replyMarkup;
        }

        const result = await this.callTelegramAPI('sendMessage', messagePayload);

        if (result && result.ok) {
          logSuccess(`✅ Message sent to Telegram chat ${chatId} (using Markdown)`);
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
      if (media.length === 1) {
        // Single media item - use sendPhoto/sendVideo with caption
        const mediaItem = media[0];
        let method = 'sendDocument'; // Default fallback
        
        if (mediaItem.type === 'photo') {
          method = 'sendPhoto';
        } else if (mediaItem.type === 'video') {
          method = 'sendVideo';
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
        const mediaWithCaption = media.map((item, index) => ({
          ...item,
          caption: index === 0 ? caption : undefined,
          parse_mode: index === 0 ? 'MarkdownV2' : undefined
        }));

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
    let text = '';
    const media = [];

    // Convert message content directly without author prefix
    if (discordMessage.content) {
      const convertedContent = this.convertDiscordToTelegramMarkdown(discordMessage.content);
      text += convertedContent;
    }

    // Handle embeds with better formatting
    if (discordMessage.embeds && discordMessage.embeds.length > 0) {
      for (const embed of discordMessage.embeds) {
        // Add spacing if there's already content
        if (text.trim()) {
          text += '\n\n';
        }
        
        if (embed.title) {
          text += `*${this.escapeMarkdownV2ForText(embed.title)}*\n`;
        }
        
        if (embed.description) {
          text += `${this.convertDiscordToTelegramMarkdown(embed.description)}\n`;
        }
        
        if (embed.url) {
          text += `🔗 [Link](${embed.url})\n`;
        }
        
        // Add fields with better formatting
        if (embed.fields && embed.fields.length > 0) {
          for (const field of embed.fields) {
            text += `\n*${this.escapeMarkdownV2ForText(field.name)}:*\n${this.convertDiscordToTelegramMarkdown(field.value)}\n`;
          }
        }
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
            text += `\n📎 [${this.escapeMarkdownV2ForText(attachment.name)}](${attachment.url})`;
          } else {
            text += `📎 [${this.escapeMarkdownV2ForText(attachment.name)}](${attachment.url})`;
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
        text += `\n🎭 ${this.escapeMarkdownV2ForText(stickerNames)}`;
      } else {
        text += `🎭 ${this.escapeMarkdownV2ForText(stickerNames)}`;
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
   * Convert Discord markdown to Telegram MarkdownV2
   */
  /**
   * Simple MarkdownV2 conversion - only fix italic and escape what's absolutely necessary
   */
  simpleMarkdownV2Convert(text) {
    if (!text) return '';
    
    let converted = text;
    
    // Protect bold first
    const boldTexts = [];
    converted = converted.replace(/\*\*(.*?)\*\*/g, (match, content) => {
      const index = boldTexts.length;
      boldTexts.push(match);
      return `__BOLD_${index}__`;
    });
    
    // Convert ONLY italic: *text* -> _text_
    converted = converted.replace(/\*([^*]+?)\*/g, '_$1_');
    
    // Restore bold
    boldTexts.forEach((bold, index) => {
      converted = converted.replace(`__BOLD_${index}__`, bold);
    });
    
    // Escape ONLY the characters that actually break MarkdownV2
    // Based on error messages, start with just the period
    converted = converted.replace(/\./g, '\\.');
    
    // Clean up mentions
    converted = converted.replace(/<@!?(\d+)>/g, '');
    converted = converted.replace(/<@&(\d+)>/g, '');
    converted = converted.replace(/<#(\d+)>/g, '');
    
    // Convert custom emojis
    converted = converted.replace(/<a?:(\w+):\d+>/g, ':$1:');
    
    return converted.trim();
  }

  /**
   * Convert Discord to regular Telegram Markdown (for testing)
   */
  convertToRegularMarkdown(text) {
    if (!text) return '';
    
    let converted = text;
    
    // Regular Markdown is simpler - just convert italic
    // Bold: **text** stays **text**
    // Italic: *text* -> _text_
    converted = converted.replace(/\*([^*]+?)\*/g, '_$1_');
    
    // Clean up mentions
    converted = converted.replace(/<@!?(\d+)>/g, '');
    converted = converted.replace(/<@&(\d+)>/g, '');
    converted = converted.replace(/<#(\d+)>/g, '');
    
    // Convert custom emojis
    converted = converted.replace(/<a?:(\w+):\d+>/g, ':$1:');
    
    return converted.trim();
  }

  convertDiscordToTelegramMarkdown(text) {
    if (!text) return '';

    let converted = text;
    
    // Since you said everything else works 1:1, let's try minimal conversion
    // First protect bold formatting
    const boldTexts = [];
    converted = converted.replace(/\*\*(.*?)\*\*/g, (match, content) => {
      const index = boldTexts.length;
      boldTexts.push(match); // Keep original **text**
      return `__BOLD_${index}__`;
    });
    
    // Convert ONLY italic: *text* -> _text_
    converted = converted.replace(/\*([^*]+?)\*/g, '_$1_');
    
    // Restore bold formatting as-is
    boldTexts.forEach((bold, index) => {
      converted = converted.replace(`__BOLD_${index}__`, bold);
    });
    
    // Clean up mentions
    converted = converted.replace(/<@!?(\d+)>/g, '');
    converted = converted.replace(/<@&(\d+)>/g, '');
    converted = converted.replace(/<#(\d+)>/g, '');
    
    // Convert custom emojis
    converted = converted.replace(/<a?:(\w+):\d+>/g, ':$1:');

    return converted.trim();
  }

  /**
   * Escape special characters for Telegram MarkdownV2
   */
  escapeMarkdownV2(text) {
    if (!text) return '';
    
    // MarkdownV2 special characters that need escaping
    const specialChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
    
    let escaped = text;
    for (const char of specialChars) {
      escaped = escaped.replace(new RegExp('\\' + char, 'g'), '\\' + char);
    }
    
    return escaped;
  }

  /**
   * Escape special characters for Telegram MarkdownV2 but preserve Discord formatting
   */
  escapeSpecialCharsExceptFormatting(text) {
    if (!text) return '';
    
    // MarkdownV2 special characters that need escaping
    // BUT excluding Discord formatting chars: * (bold/italic), ~ (strikethrough), | (spoiler), > (quote)
    const specialChars = ['_', '[', ']', '(', ')', '#', '+', '-', '=', '{', '}', '.', '!'];
    
    let escaped = text;
    for (const char of specialChars) {
      // Properly escape regex special characters
      const escapedChar = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      escaped = escaped.replace(new RegExp(escapedChar, 'g'), '\\' + char);
    }
    
    return escaped;
  }

  /**
   * Escape special characters for Telegram MarkdownV2 but preserve code formatting
   */
  escapeMarkdownV2ForText(text) {
    if (!text) return '';
    
    // MarkdownV2 special characters that need escaping (excluding backticks for code)
    const specialChars = ['_', '*', '[', ']', '(', ')', '~', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
    
    let escaped = text;
    for (const char of specialChars) {
      // Properly escape regex special characters
      const escapedChar = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      escaped = escaped.replace(new RegExp(escapedChar, 'g'), '\\' + char);
    }
    
    return escaped;
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