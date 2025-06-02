const { logInfo, logError } = require('./logger');
const FormatConverter = require('./formatConverter');

/**
 * Slice-Based Format Converter - Breaks messages into individual formatting slices
 * Each slice represents a single formatting element that gets converted independently
 */
class SliceFormatConverter {

  /**
   * Main conversion method that uses slice-based approach
   * @param {string} text - Discord text to convert
   * @param {Object} message - Discord message object (optional, for mention resolution)
   * @returns {string} Converted Telegram MarkdownV2 text
   */
  static async discordToTelegramMarkdownV2WithSlices(text, message = null) {
    if (!text) return '';
    
    const envConfig = require('../config/env');
    if (envConfig.debugMode) {
      logInfo('🔪 Starting slice-based format conversion for:', text);
    }
    
    try {
      // Step 1: Parse the text into slices
      const slices = this.parseTextIntoSlices(text);
      
      if (envConfig.debugMode) {
        logInfo('🔪 Parsed into', slices.length, 'slices:');
        slices.forEach((slice, index) => {
          logInfo(`🔪 Slice ${index}: type="${slice.type}", content="${slice.content}"`);
        });
      }
      
      // Step 2: Convert each slice individually
      const convertedSlices = [];
      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        const convertedSlice = await this.convertSlice(slice, message);
        convertedSlices.push(convertedSlice);
        
        if (envConfig.debugMode) {
          logInfo(`🔪 Converted slice ${i}: "${slice.content}" -> "${convertedSlice}"`);
        }
      }
      
      // Step 3: Rebuild the message from converted slices
      const result = convertedSlices.join('');
      
      if (envConfig.debugMode) {
        logInfo('🔪 Final slice-based conversion result:', result);
      }
      
      return result;
      
    } catch (error) {
      logError('🔪 Slice-based conversion error:', error);
      // Fallback to regular conversion
      return FormatConverter.discordToTelegramMarkdownV2(text);
    }
  }
  
  /**
   * Parse text into individual formatting slices
   * Each slice represents a distinct formatting element or plain text
   * @param {string} text - Text to parse
   * @returns {Array} Array of slice objects
   */
  static parseTextIntoSlices(text) {
    const slices = [];
    let pos = 0;
    
    // Define formatting patterns in order of priority (longest/most complex first)
    const patterns = [
      // Code blocks (highest priority)
      { regex: /```(?:(\w+)\n)?([\s\S]*?)```/g, type: 'code_block' },
      { regex: /`([^`\n]+)`/g, type: 'inline_code' },
      
      // Complex formatting combinations
      { regex: /\*\*\*(.*?)\*\*\*/g, type: 'bold_italic' },
      { regex: /__\*\*\*(.*?)\*\*\*__/g, type: 'underline_bold_italic' },
      { regex: /__\*\*(.*?)\*\*__/g, type: 'underline_bold' },
      { regex: /__\*(.*?)\*__/g, type: 'underline_italic' },
      
      // Simple formatting
      { regex: /\*\*(.*?)\*\*/g, type: 'bold' },
      { regex: /\*(.*?)\*/g, type: 'italic' },
      { regex: /__(.*?)__/g, type: 'underline' },
      { regex: /~~(.*?)~~/g, type: 'strikethrough' },
      { regex: /\|\|(.*?)\|\|/g, type: 'spoiler' },
      
      // Headings
      { regex: /^### (.+)$/gm, type: 'heading3' },
      { regex: /^## (.+)$/gm, type: 'heading2' },
      { regex: /^# (.+)$/gm, type: 'heading1' },
      { regex: /^#### (.+)$/gm, type: 'heading4' },
      { regex: /^##### (.+)$/gm, type: 'heading5' },
      { regex: /^###### (.+)$/gm, type: 'heading6' },
      
      // Links
      { regex: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link' },
      
      // Mentions
      { regex: /<@!?(\d+)>/g, type: 'user_mention' },
      { regex: /<@&(\d+)>/g, type: 'role_mention' },
      { regex: /<#(\d+)>/g, type: 'channel_mention' },
      
      // Custom emojis
      { regex: /<a?:(\w+):\d+>/g, type: 'custom_emoji' },
      
      // Block quotes
      { regex: /^> (.+)$/gm, type: 'block_quote' },
      { regex: /^>>> ([\s\S]*?)$/gm, type: 'multi_quote' }
    ];
    
    // Find all matches with their positions
    const matches = [];
    patterns.forEach(pattern => {
      let match;
      pattern.regex.lastIndex = 0; // Reset regex
      while ((match = pattern.regex.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          content: match[0],
          type: pattern.type,
          groups: match.slice(1) // Capture groups
        });
      }
    });
    
    // Sort matches by start position
    matches.sort((a, b) => a.start - b.start);
    
    // Remove overlapping matches (keep the first one found)
    const cleanMatches = [];
    for (const match of matches) {
      const overlaps = cleanMatches.some(existing =>
        match.start < existing.end && match.end > existing.start
      );
      if (!overlaps) {
        cleanMatches.push(match);
      }
    }
    
    // Build slices from matches and plain text
    let currentPos = 0;
    for (const match of cleanMatches) {
      // Add plain text before this match
      if (match.start > currentPos) {
        const plainText = text.substring(currentPos, match.start);
        if (plainText) {
          slices.push({
            type: 'plain_text',
            content: plainText,
            start: currentPos,
            end: match.start
          });
        }
      }
      
      // Add the formatted match
      slices.push({
        type: match.type,
        content: match.content,
        start: match.start,
        end: match.end,
        groups: match.groups
      });
      
      currentPos = match.end;
    }
    
    // Add any remaining plain text
    if (currentPos < text.length) {
      const remainingText = text.substring(currentPos);
      if (remainingText) {
        slices.push({
          type: 'plain_text',
          content: remainingText,
          start: currentPos,
          end: text.length
        });
      }
    }
    
    return slices;
  }
  
  /**
   * Convert a single slice to Telegram MarkdownV2 format
   * @param {Object} slice - Slice object to convert
   * @param {Object} message - Discord message object (for mention resolution)
   * @returns {string} Converted slice content
   */
  static async convertSlice(slice, message = null) {
    const envConfig = require('../config/env');
    
    switch (slice.type) {
      case 'plain_text':
        return this.escapeMarkdownV2ForText(slice.content);
        
      case 'bold':
        // **text** -> *text*
        const boldContent = slice.groups[0];
        return `*${this.escapeSpecialCharsInFormatting(boldContent)}*`;
        
      case 'italic':
        // *text* -> _text_
        const italicContent = slice.groups[0];
        return `_${this.escapeSpecialCharsInFormatting(italicContent)}_`;
        
      case 'bold_italic':
        // ***text*** -> *_text_*
        const boldItalicContent = slice.groups[0];
        return `*_${this.escapeSpecialCharsInFormatting(boldItalicContent)}_*`;
        
      case 'underline':
        // __text__ -> __text__
        const underlineContent = slice.groups[0];
        return `__${this.escapeSpecialCharsInFormatting(underlineContent)}__`;
        
      case 'underline_bold':
        // __**text**__ -> __*text*__
        const underlineBoldContent = slice.groups[0];
        return `__*${this.escapeSpecialCharsInFormatting(underlineBoldContent)}*__`;
        
      case 'underline_italic':
        // __*text*__ -> ___text___
        const underlineItalicContent = slice.groups[0];
        return `___${this.escapeSpecialCharsInFormatting(underlineItalicContent)}___`;
        
      case 'underline_bold_italic':
        // __***text***__ -> *_\\_text\\_*
        const underlineBoldItalicContent = slice.groups[0];
        return `*_\\_${this.escapeSpecialCharsInFormatting(underlineBoldItalicContent)}\\_*`;
        
      case 'strikethrough':
        // ~~text~~ -> ~text~
        const strikeContent = slice.groups[0];
        return `~${this.escapeSpecialCharsInFormatting(strikeContent)}~`;
        
      case 'spoiler':
        // ||text|| -> ||text||
        const spoilerContent = slice.groups[0];
        return `||${this.escapeSpecialCharsInFormatting(spoilerContent)}||`;
        
      case 'code_block':
        // ```code``` -> ```code```
        const language = slice.groups[0] || '';
        const code = slice.groups[1] || slice.groups[0] || '';
        const escapedCode = code.replace(/([`\\])/g, '\\$1');
        if (language) {
          return `\`\`\`${language}\n${escapedCode}\`\`\``;
        } else {
          return `\`\`\`${escapedCode}\`\`\``;
        }
        
      case 'inline_code':
        // `code` -> `code`
        const inlineCode = slice.groups[0];
        const escapedInlineCode = inlineCode.replace(/([`\\])/g, '\\$1');
        return `\`${escapedInlineCode}\``;
        
      case 'heading1':
      case 'heading2':
      case 'heading3':
        // # ## ### text -> *text*
        const headingContent = slice.groups[0];
        return `*${this.escapeSpecialCharsInFormatting(headingContent)}*`;
        
      case 'heading4':
      case 'heading5':
      case 'heading6':
        // #### ##### ###### text -> \#\#\#\# text (escaped)
        const headingLevel = slice.content.indexOf(' ');
        const hashes = slice.content.substring(0, headingLevel);
        const headingText = slice.groups[0];
        const escapedHashes = hashes.replace(/#/g, '\\#');
        return `${escapedHashes} ${this.escapeMarkdownV2ForText(headingText)}`;
        
      case 'link':
        // [text](url) -> [text](url)
        const linkText = slice.groups[0];
        const linkUrl = slice.groups[1];
        const escapedUrl = linkUrl.replace(/([)\\])/g, '\\$1');
        return `[${linkText}](${escapedUrl})`;
        
      case 'user_mention':
        // <@123> -> resolve to username
        const userId = slice.groups[0];
        if (message && message.mentions && message.mentions.users) {
          const user = message.mentions.users.get(userId);
          const userName = user ? (user.globalName || user.username || user.displayName) : `User${userId}`;
          return this.escapeMarkdownV2ForText(userName);
        }
        return this.escapeMarkdownV2ForText(`@User${userId}`);
        
      case 'role_mention':
        // <@&123> -> resolve to role name
        const roleId = slice.groups[0];
        if (message && message.mentions && message.mentions.roles) {
          const role = message.mentions.roles.get(roleId);
          const roleName = role ? role.name : `Role${roleId}`;
          return this.escapeMarkdownV2ForText(roleName);
        }
        return this.escapeMarkdownV2ForText(`@Role${roleId}`);
        
      case 'channel_mention':
        // <#123> -> resolve to channel name
        const channelId = slice.groups[0];
        if (message) {
          let channel = message.mentions?.channels?.get(channelId);
          if (!channel && message.guild) {
            channel = message.guild.channels.cache.get(channelId);
          }
          const channelName = channel ? channel.name : `channel${channelId}`;
          return this.escapeMarkdownV2ForText(`#${channelName}`);
        }
        return this.escapeMarkdownV2ForText(`#channel${channelId}`);
        
      case 'custom_emoji':
        // <:name:123> -> convert to standard emoji or remove
        const emojiName = slice.groups[0].toLowerCase();
        const standardEmoji = this.convertCustomEmojiToStandard(emojiName);
        return standardEmoji ? standardEmoji : ''; // Remove if no standard equivalent
        
      case 'block_quote':
        // > text -> >text
        const quoteContent = slice.groups[0];
        return `>${this.escapeMarkdownV2ForText(quoteContent)}`;
        
      case 'multi_quote':
        // >>> text -> **>text
        const multiQuoteContent = slice.groups[0];
        return `**>${this.escapeMarkdownV2ForText(multiQuoteContent)}`;
        
      default:
        if (envConfig.debugMode) {
          logInfo(`🔪 Unknown slice type: ${slice.type}, treating as plain text`);
        }
        return this.escapeMarkdownV2ForText(slice.content);
    }
  }
  
  /**
   * Escape special characters inside formatting (but not the formatting markers)
   * @param {string} text - Text inside formatting
   * @returns {string} Escaped text
   */
  static escapeSpecialCharsInFormatting(text) {
    if (!text) return '';
    // Escape special characters except for the formatting markers themselves
    return text.replace(/([_*\[\]()~`>#+=\-|{}.!\\])/g, '\\$1');
  }
  
  /**
   * Escape text for use in Telegram MarkdownV2 (for plain text content)
   * @param {string} text - Plain text to escape
   * @returns {string} Escaped text
   */
  static escapeMarkdownV2ForText(text) {
    if (!text) return '';
    
    // Characters that need escaping in MarkdownV2 plain text:
    // _ * [ ] ( ) ~ ` > # + - = | { } . ! \
    return text.replace(/([_*\[\]()~`>#+=\-|{}.!\\])/g, '\\$1');
  }
  
  /**
   * Convert custom Discord emoji names to standard Unicode emojis
   * @param {string} emojiName - Custom emoji name
   * @returns {string|null} Standard emoji or null if no equivalent
   */
  static convertCustomEmojiToStandard(emojiName) {
    const emojiMap = {
      // Hearts
      'heart': '❤️',
      'love': '❤️',
      'heartred': '❤️',
      'heartorange': '🧡',
      'heartyellow': '💛',
      'heartgreen': '💚',
      'heartblue': '💙',
      'heartpurple': '💜',
      
      // Fire and energy
      'fire': '🔥',
      'flame': '🔥',
      'burn': '🔥',
      
      // Stars
      'star': '⭐',
      'stars': '⭐',
      'sparkle': '✨',
      'sparkles': '✨',
      
      // Check marks
      'check': '✅',
      'tick': '✅',
      'checkmark': '✅',
      'yes': '✅',
      'correct': '✅',
      
      // Cross marks
      'cross': '❌',
      'x': '❌',
      'no': '❌',
      'wrong': '❌',
      'error': '❌',
      
      // Emotions
      'laugh': '😂',
      'lol': '😂',
      'joy': '😂',
      'happy': '😊',
      'smile': '😊',
      'sad': '😢',
      'cry': '😢',
      'angry': '😠',
      'rage': '😡',
      'thinking': '🤔',
      
      // Common gaming/tech
      'warning': '⚠️',
      'info': 'ℹ️',
      'question': '❓',
      'exclamation': '❗',
      'point_right': '👉',
      'point_left': '👈',
      'thumbsup': '👍',
      'thumbsdown': '👎'
    };
    
    return emojiMap[emojiName] || null;
  }
  
  /**
   * Static helper method for external use
   * @param {string} text - Text to convert
   * @param {Object} message - Discord message object (optional)
   * @returns {string} Converted text
   */
  static async convertDiscordToTelegramMarkdownV2(text, message = null) {
    return await SliceFormatConverter.discordToTelegramMarkdownV2WithSlices(text, message);
  }
}

module.exports = SliceFormatConverter;