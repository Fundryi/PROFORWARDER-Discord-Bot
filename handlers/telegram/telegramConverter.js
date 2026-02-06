const { logInfo, logError } = require('../../utils/logger');
const FormatConverter = require('../../utils/formatConverter');
const AIFormatConverter = require('../../utils/aiFormatConverter');
const TelegramMediaHandler = require('./telegramMediaHandler');

/**
 * Telegram Converter - Discord to Telegram format conversion
 * Handles message content conversion, embed processing, and source headers
 */
class TelegramConverter {
  constructor() {
    this.mediaHandler = new TelegramMediaHandler();
  }

  /**
   * Convert Discord message to Telegram format
   */
  async convertDiscordMessage(discordMessage, config = {}) {
    const envConfig = require('../../config/config');
    const isDebugMode = envConfig.debugMode;
    
    let text = '';
    const media = [];

    if (isDebugMode) {
      logInfo('🔍 CONVERT DEBUG: Starting Discord message conversion');
      logInfo(`🔍 CONVERT DEBUG: Message content: "${discordMessage.content || 'NO CONTENT'}"`);
    }

    // Add source header for Discord server and channel
    const sourceHeader = await this.buildSourceHeader(discordMessage, config);
    if (sourceHeader) {
      text += sourceHeader + '\n\n';
    }

    // Convert message content directly without author prefix
    if (discordMessage.content) {
      if (isDebugMode) {
        logInfo(`🔍 CONVERT DEBUG: Converting main content: "${discordMessage.content}"`);
      }
      const convertedContent = await this.convertDiscordToTelegramMarkdown(discordMessage.content, discordMessage);
      if (isDebugMode) {
        logInfo(`🔍 CONVERT DEBUG: Converted main content: "${convertedContent}"`);
      }
      text += convertedContent;
    }

    // Handle embeds with better formatting
    if (discordMessage.embeds && discordMessage.embeds.length > 0) {
      if (isDebugMode) {
        logInfo(`🔍 CONVERT DEBUG: Processing ${discordMessage.embeds.length} embeds`);
      }
      
      const embedResult = await this.processEmbeds(discordMessage.embeds, discordMessage, isDebugMode);
      text += embedResult.text;
      media.push(...embedResult.media);
    }

    // Handle attachments with better integration
    if (discordMessage.attachments && discordMessage.attachments.size > 0) {
      const attachmentResult = this.processAttachments(discordMessage.attachments);
      media.push(...attachmentResult.media);
      text += attachmentResult.text;
    }

    // Handle stickers with better formatting
    if (discordMessage.stickers && discordMessage.stickers.size > 0) {
      const stickerText = this.processStickers(discordMessage.stickers);
      if (text.trim()) {
        text += '\n' + stickerText;
      } else {
        text += stickerText;
      }
    }

    // Ensure we have some content with a cleaner fallback
    if (!text.trim() && media.length === 0) {
      text = '💬 *Message*';
    }

    // Determine whether to disable web page previews
    const disableWebPagePreview = this.shouldDisableWebPagePreview(media.length, envConfig);

    return {
      text: text,
      media: media,
      disableWebPagePreview: disableWebPagePreview
      // Don't include replyMarkup unless we actually have one
    };
  }

  /**
   * Process Discord embeds into Telegram format
   */
  async processEmbeds(embeds, discordMessage, isDebugMode = false) {
    let text = '';
    const media = [];

    for (let i = 0; i < embeds.length; i++) {
      const embed = embeds[i];
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

    return { text, media };
  }

  /**
   * Process Discord attachments into Telegram format
   */
  processAttachments(attachments) {
    const media = [];
    let text = '';

    for (const attachment of attachments.values()) {
      if (this.mediaHandler.isImageFile(attachment.name)) {
        // Add to media group
        media.push({
          type: 'photo',
          media: attachment.url
        });
      } else if (this.mediaHandler.isVideoFile(attachment.name)) {
        // Add to media group
        media.push({
          type: 'video',
          media: attachment.url
        });
      } else {
        // Add as file link in text only if we don't have media
        // (if we have media, the text will be sent as caption)
        const fileLink = `📎 [${FormatConverter.escapeMarkdownV2ForText(attachment.name)}](${attachment.url})`;
        if (text.trim()) {
          text += `\n${fileLink}`;
        } else {
          text += fileLink;
        }
      }
    }

    return { media, text };
  }

  /**
   * Process Discord stickers into Telegram format
   */
  processStickers(stickers) {
    const stickerNames = Array.from(stickers.values())
      .map(sticker => sticker.name)
      .join(', ');
    
    return `🎭 ${FormatConverter.escapeMarkdownV2ForText(stickerNames)}`;
  }

  /**
   * Build source header showing Discord server and channel
   */
  async buildSourceHeader(discordMessage, config = {}) {
    try {
      const envConfig = require('../../config/config');
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
      const discordInviteManager = require('../../utils/discordInviteManager');
      
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
   * Convert Discord markdown to Telegram MarkdownV2
   */
  async convertDiscordToTelegramMarkdown(text, message = null) {
    return await AIFormatConverter.convertDiscordToTelegramMarkdownV2(text, message);
  }

  /**
   * Determine whether to disable web page previews
   */
  shouldDisableWebPagePreview(mediaCount, envConfig) {
    if (envConfig.telegram?.smartLinkPreviews === false) {
      // Always disable previews if smartLinkPreviews is disabled
      return true;
    } else if (envConfig.telegram?.smartLinkPreviews !== false) {
      // Smart behavior (default):
      // - If Discord has images/videos: Allow previews (Telegram will show images, not link previews)
      // - If Discord has only text/links: Disable previews (prevent big link previews)
      return mediaCount === 0;
    }
    
    return false;
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
   * Legacy compatibility methods - redirect to current implementation
   */
  async convertToHTML(text, message = null) {
    return await this.convertDiscordToTelegramMarkdown(text, message);
  }

  async simpleMarkdownV2Convert(text, message = null) {
    return await this.convertDiscordToTelegramMarkdown(text, message);
  }
}

module.exports = TelegramConverter;