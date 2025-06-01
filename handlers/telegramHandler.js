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
      
      // Send the main message
      const result = await this.callTelegramAPI('sendMessage', {
        chat_id: chatId,
        text: telegramMessage.text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: false,
        reply_markup: telegramMessage.replyMarkup
      });

      if (result && result.ok) {
        logSuccess(`✅ Message sent to Telegram chat ${chatId}`);
        
        // Send any media attachments separately
        if (telegramMessage.media && telegramMessage.media.length > 0) {
          await this.sendMediaGroup(chatId, telegramMessage.media);
        }
        
        return result.result;
      } else {
        throw new Error(`Telegram API error: ${result ? result.description : 'Unknown error'}`);
      }
    } catch (error) {
      logError('Error sending Telegram message:', error);
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

    // Add author information for cross-platform forwarding
    const authorInfo = `**${this.escapeMarkdownV2(discordMessage.author.displayName)}**`;
    const serverInfo = discordMessage.guild ? ` from **${this.escapeMarkdownV2(discordMessage.guild.name)}**` : '';
    text += `${authorInfo}${serverInfo}:\n\n`;

    // Convert message content
    if (discordMessage.content) {
      const convertedContent = this.convertDiscordToTelegramMarkdown(discordMessage.content);
      text += convertedContent;
    }

    // Handle embeds
    if (discordMessage.embeds && discordMessage.embeds.length > 0) {
      for (const embed of discordMessage.embeds) {
        text += '\n\n📋 **Embed:**\n';
        
        if (embed.title) {
          text += `**${this.escapeMarkdownV2(embed.title)}**\n`;
        }
        
        if (embed.description) {
          text += `${this.escapeMarkdownV2(embed.description)}\n`;
        }
        
        if (embed.url) {
          text += `🔗 [Link](${embed.url})\n`;
        }
        
        // Add fields
        if (embed.fields && embed.fields.length > 0) {
          for (const field of embed.fields) {
            text += `\n**${this.escapeMarkdownV2(field.name)}:**\n${this.escapeMarkdownV2(field.value)}\n`;
          }
        }
      }
    }

    // Handle attachments
    if (discordMessage.attachments && discordMessage.attachments.size > 0) {
      for (const attachment of discordMessage.attachments.values()) {
        if (this.isImageFile(attachment.name)) {
          // Add to media group
          media.push({
            type: 'photo',
            media: attachment.url,
            caption: attachment.description || attachment.name
          });
        } else if (this.isVideoFile(attachment.name)) {
          // Add to media group
          media.push({
            type: 'video',
            media: attachment.url,
            caption: attachment.description || attachment.name
          });
        } else {
          // Add as file link in text
          text += `\n📎 [${this.escapeMarkdownV2(attachment.name)}](${attachment.url})`;
        }
      }
    }

    // Handle stickers
    if (discordMessage.stickers && discordMessage.stickers.size > 0) {
      const stickerNames = Array.from(discordMessage.stickers.values())
        .map(sticker => sticker.name)
        .join(', ');
      text += `\n🎭 Stickers: ${this.escapeMarkdownV2(stickerNames)}`;
    }

    // Ensure we have some content
    if (!text.trim() && media.length === 0) {
      text = '*\\[Message with unsupported content\\]*';
    }

    return {
      text: text,
      media: media,
      replyMarkup: null
    };
  }

  /**
   * Convert Discord markdown to Telegram MarkdownV2
   */
  convertDiscordToTelegramMarkdown(text) {
    if (!text) return '';

    // Escape special characters first
    let converted = this.escapeMarkdownV2(text);

    // Convert Discord formatting to Telegram MarkdownV2
    // Bold: **text** -> *text*
    converted = converted.replace(/\\\*\\\*(.*?)\\\*\\\*/g, '*$1*');
    
    // Italic: *text* -> _text_
    converted = converted.replace(/(?<!\*)\\\*([^*]+?)\\\*(?!\*)/g, '_$1_');
    
    // Strikethrough: ~~text~~ -> ~text~
    converted = converted.replace(/~~(.*?)~~/g, '~$1~');
    
    // Code: `text` -> `text` (already correct)
    converted = converted.replace(/\\`(.*?)\\`/g, '`$1`');
    
    // Code blocks: ```text``` -> ```text```
    converted = converted.replace(/\\`\\`\\`([\s\S]*?)\\`\\`\\`/g, '```$1```');
    
    // Convert mentions to regular text (Telegram doesn't support Discord mentions)
    converted = converted.replace(/<@!?(\d+)>/g, '@user');
    converted = converted.replace(/<@&(\d+)>/g, '@role');
    converted = converted.replace(/<#(\d+)>/g, '#channel');
    
    // Convert custom emojis to their names
    converted = converted.replace(/<a?:(\w+):\d+>/g, ':$1:');

    return converted;
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