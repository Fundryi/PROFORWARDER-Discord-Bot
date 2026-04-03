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
    
    const envConfig = require('../config/config');
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
        const convertedSlice = await this.convertSlice(slice, message, envConfig);
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
      { regex: /^>>> ([\s\S]*?)$/gm, type: 'multi_quote' },
      
      // Special mentions
      { regex: /@everyone/g, type: 'everyone_mention' },
      { regex: /@here/g, type: 'here_mention' }
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
  static async convertSlice(slice, message = null, envConfig = null) {
    if (!envConfig) envConfig = require('../config/config');
    
    switch (slice.type) {
      case 'plain_text':
        return FormatConverter.escapeMarkdownV2ForText(slice.content);
        
      case 'bold':
        // **text** -> *text*
        const boldContent = slice.groups[0];
        return `*${this.escapeSpecialCharsInFormatting(boldContent, envConfig)}*`;
        
      case 'italic':
        // *text* -> _text_
        const italicContent = slice.groups[0];
        return `_${this.escapeSpecialCharsInFormatting(italicContent, envConfig)}_`;
        
      case 'bold_italic':
        // ***text*** -> *_text_*
        const boldItalicContent = slice.groups[0];
        return `*_${this.escapeSpecialCharsInFormatting(boldItalicContent, envConfig)}_*`;
        
      case 'underline':
        // __text__ -> __text__
        const underlineContent = slice.groups[0];
        return `__${this.escapeSpecialCharsInFormatting(underlineContent, envConfig)}__`;
        
      case 'underline_bold':
        // __**text**__ -> __*text*__
        const underlineBoldContent = slice.groups[0];
        return `__*${this.escapeSpecialCharsInFormatting(underlineBoldContent, envConfig)}*__`;
        
      case 'underline_italic':
        // __*text*__ -> ___text___
        const underlineItalicContent = slice.groups[0];
        return `___${this.escapeSpecialCharsInFormatting(underlineItalicContent, envConfig)}___`;
        
      case 'underline_bold_italic':
        // __***text***__ -> *_\\_text\\_*
        const underlineBoldItalicContent = slice.groups[0];
        return `*_\\_${this.escapeSpecialCharsInFormatting(underlineBoldItalicContent, envConfig)}\\_*`;
        
      case 'strikethrough':
        // ~~text~~ -> ~text~
        const strikeContent = slice.groups[0];
        return `~${this.escapeSpecialCharsInFormatting(strikeContent, envConfig)}~`;
        
      case 'spoiler':
        // ||text|| -> ||text||
        const spoilerContent = slice.groups[0];
        return `||${this.escapeSpecialCharsInFormatting(spoilerContent, envConfig)}||`;
        
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
        return `*${this.escapeSpecialCharsInFormatting(headingContent, envConfig)}*`;
        
      case 'heading4':
      case 'heading5':
      case 'heading6':
        // #### ##### ###### text -> \#\#\#\# text (escaped)
        const headingLevel = slice.content.indexOf(' ');
        const hashes = slice.content.substring(0, headingLevel);
        const headingText = slice.groups[0];
        const escapedHashes = hashes.replace(/#/g, '\\#');
        return `${escapedHashes} ${FormatConverter.escapeMarkdownV2ForText(headingText)}`;
        
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
          if (envConfig.debugMode) {
            logInfo(`🔪 🔍 Using resolved user mention: ${slice.content} -> ${userName}`);
          }
          return `＠${FormatConverter.escapeMarkdownV2ForText(userName)}`;
        }
        return `＠${FormatConverter.escapeMarkdownV2ForText(`User${userId}`)}`;
        
      case 'role_mention':
        // <@&123> -> resolve to role name
        const roleId = slice.groups[0];
        if (message && message.mentions && message.mentions.roles) {
          const role = message.mentions.roles.get(roleId);
          const roleName = role ? role.name : `Role${roleId}`;
          if (envConfig.debugMode) {
            logInfo(`🔪 🔍 Using resolved role mention: ${slice.content} -> ${roleName}`);
          }
          return `＠${FormatConverter.escapeMarkdownV2ForText(roleName)}`;
        }
        return `＠${FormatConverter.escapeMarkdownV2ForText(`Role${roleId}`)}`;
        
      case 'channel_mention':
        // <#123> -> resolve to channel name
        const channelId = slice.groups[0];
        if (message) {
          let channel = message.mentions?.channels?.get(channelId);
          if (!channel && message.guild) {
            channel = message.guild.channels.cache.get(channelId);
          }
          const channelName = channel ? channel.name : `channel${channelId}`;
          if (envConfig.debugMode) {
            logInfo(`🔪 🔍 Using resolved channel mention: ${slice.content} -> #${channelName}`);
          }
          return `\\#${FormatConverter.escapeMarkdownV2ForText(channelName)}`;
        }
        return `\\#${FormatConverter.escapeMarkdownV2ForText(`channel${channelId}`)}`;
        
      case 'custom_emoji':
        // <:name:123> -> convert to standard emoji or remove
        const emojiName = slice.groups[0].toLowerCase();
        const standardEmoji = this.convertCustomEmojiToStandard(emojiName, envConfig);
        return standardEmoji ? standardEmoji : ''; // Remove if no standard equivalent
        
      case 'block_quote':
        // > text -> >text
        const quoteContent = slice.groups[0];
        return `>${FormatConverter.escapeMarkdownV2ForText(quoteContent)}`;
        
      case 'multi_quote':
        // >>> text -> **>text
        const multiQuoteContent = slice.groups[0];
        return `**>${FormatConverter.escapeMarkdownV2ForText(multiQuoteContent)}`;
        
      case 'everyone_mention':
        // @everyone -> ＠everyone
        return '＠everyone';

      case 'here_mention':
        // @here -> ＠here
        return '＠here';
        
      default:
        if (envConfig.debugMode) {
          logInfo(`🔪 Unknown slice type: ${slice.type}, treating as plain text`);
        }
        return FormatConverter.escapeMarkdownV2ForText(slice.content);
    }
  }
  
  /**
   * Process emojis, mentions, and escape special characters inside formatting
   * @param {string} text - Text inside formatting
   * @returns {string} Processed and escaped text
   */
  static escapeSpecialCharsInFormatting(text, envConfig = null) {
    if (!text) return '';
    
    // First, process any Discord mentions within the text (use full-width @)
    let processedText = text;
    
    // Handle user mentions
    processedText = processedText.replace(/<@!?(\d+)>/g, '＠User$1');
    
    // Handle role mentions
    processedText = processedText.replace(/<@&(\d+)>/g, '＠Role$1');
    
    // Handle channel mentions (keep escaped # prefix for channels)
    processedText = processedText.replace(/<#(\d+)>/g, '\\#Channel$1');
    
    // Handle @everyone and @here
    processedText = processedText.replace(/@everyone/g, '＠everyone');
    processedText = processedText.replace(/@here/g, '＠here');
    
    // Then, process any custom emojis within the text
    if (!envConfig) envConfig = require('../config/config');
    processedText = processedText.replace(/<a?:(\w+):\d+>/g, (match, emojiName) => {
      const standardEmoji = this.convertCustomEmojiToStandard(emojiName, envConfig);
      if (standardEmoji) {
        if (envConfig.debugMode) {
          logInfo(`🔪 🔍 Converted custom emoji within formatting: ${match} -> ${standardEmoji}`);
        }
        return standardEmoji;
      } else {
        if (envConfig.debugMode) {
          logInfo(`🔪 🔍 Removed unsupported custom emoji within formatting: ${match}`);
        }
        return ''; // Remove unknown emojis
      }
    });
    
    // Then escape special characters except for the formatting markers themselves
    return processedText.replace(/([_*\[\]()~`>#+=\-|{}.!\\])/g, '\\$1');
  }
  
  /**
   * Convert custom Discord emoji names to standard Unicode emojis
   * @param {string} emojiName - Custom emoji name
   * @returns {string|null} Standard emoji or null if no equivalent
   */
  static convertCustomEmojiToStandard(emojiName, envConfig = null) {
    const name = emojiName.toLowerCase();
    
    // Enhanced emoji mapping with 200+ common Discord emojis
    const emojiMap = {
      // Hearts and love
      'heart': '❤️', 'love': '❤️', 'heartred': '❤️', 'heartorange': '🧡',
      'heartyellow': '💛', 'heartgreen': '💚', 'heartblue': '💙', 'heartpurple': '💜',
      'heartblack': '🖤', 'heartwhite': '🤍', 'heartbrown': '🤎', 'heartpink': '💗',
      'heartbroken': '💔', 'heartbeat': '💓', 'heartpulse': '💗', 'hearteyes': '😍',
      'kiss': '😘', 'kissing': '😗', 'blowkiss': '😘',
      
      // Fire and energy
      'fire': '🔥', 'flame': '🔥', 'burn': '🔥', 'hot': '🔥', 'lit': '🔥', 'burning': '🔥',
      'energy': '⚡', 'lightning': '⚡', 'electric': '⚡', 'bolt': '⚡', 'power': '⚡',
      'zap': '⚡', 'shock': '⚡',
      
      // Stars and sparkles
      'star': '⭐', 'stars': '⭐', 'sparkle': '✨', 'sparkles': '✨', 'glitter': '✨',
      'shine': '✨', 'bright': '✨', 'starry': '🌟', 'shooting_star': '🌠', 'dizzy': '💫',
      'glowing': '✨', 'shiny': '✨',
      
      // Check marks and success
      'check': '✅', 'tick': '✅', 'checkmark': '✅', 'yes': '✅', 'correct': '✅',
      'done': '✅', 'success': '✅', 'approve': '✅', 'accept': '✅', 'ok': '✅',
      'good': '✅', 'valid': '✅', 'confirmed': '✅',
      
      // Cross marks and errors
      'cross': '❌', 'x': '❌', 'no': '❌', 'wrong': '❌', 'error': '❌', 'fail': '❌',
      'reject': '❌', 'deny': '❌', 'bad': '❌', 'remove': '❌', 'delete': '❌',
      'invalid': '❌', 'forbidden': '❌', 'block': '❌',
      
      // Emotions and faces
      'laugh': '😂', 'lol': '😂', 'joy': '😂', 'funny': '😂', 'lmao': '😂', 'rofl': '🤣',
      'laughing': '😂', 'lmfao': '😂', 'haha': '😂', 'hahaha': '😂',
      'happy': '😊', 'smile': '😊', 'grin': '😁', 'pleased': '😊', 'content': '😊',
      'smiling': '😊', 'smiley': '😀', 'grinning': '😄', 'beaming': '😁',
      'sad': '😢', 'cry': '😢', 'tear': '😢', 'upset': '😢', 'disappointed': '😞',
      'crying': '😭', 'sobbing': '😭', 'weeping': '😢',
      'angry': '😠', 'rage': '😡', 'mad': '😡', 'furious': '😡', 'pissed': '😠',
      'enraged': '😡', 'livid': '😡', 'fuming': '😤',
      'thinking': '🤔', 'think': '🤔', 'hmm': '🤔', 'confused': '😕', 'worry': '😟',
      'worried': '😟', 'uncertain': '🤔', 'contemplating': '🤔',
      'surprised': '😲', 'shock': '😱', 'wow': '😮', 'amazed': '😲', 'astonished': '😲',
      'cool': '😎', 'sunglasses': '😎', 'awesome': '😎', 'slick': '😎',
      'wink': '😉', 'winky': '😉', 'tongue': '😛', 'silly': '😜', 'crazy': '🤪',
      'sleep': '😴', 'tired': '😴', 'sleepy': '😴', 'yawn': '🥱', 'exhausted': '😴',
      'excited': '🤩', 'starstruck': '🤩', 'thrilled': '🤩',
      
      // Common symbols and reactions
      'warning': '⚠️', 'warn': '⚠️', 'caution': '⚠️', 'alert': '⚠️', 'danger': '⚠️',
      'info': 'ℹ️', 'information': 'ℹ️', 'notice': 'ℹ️',
      'question': '❓', 'ask': '❓', 'help': '❓', 'confused_question': '❓',
      'exclamation': '❗', 'important': '❗', 'attention': '❗', 'urgent': '❗',
      'point_right': '👉', 'point_left': '👈', 'point_up': '👆', 'point_down': '👇',
      'pointing_right': '👉', 'pointing_left': '👈', 'pointing_up': '👆', 'pointing_down': '👇',
      'thumbsup': '👍', 'thumbup': '👍', 'like': '👍', 'approve_thumb': '👍',
      'thumbsdown': '👎', 'thumbdown': '👎', 'dislike': '👎', 'disapprove': '👎',
      'clap': '👏', 'applause': '👏', 'praise': '👏', 'clapping': '👏',
      'pray': '🙏', 'please': '🙏', 'thanks': '🙏', 'thankyou': '🙏', 'grateful': '🙏',
      'peace': '✌️', 'victory': '✌️', 'fingers_crossed': '🤞', 'crossed_fingers': '🤞',
      
      // Gaming and tech
      'game': '🎮', 'gaming': '🎮', 'controller': '🎮', 'gamer': '🎮', 'console': '🎮',
      'pc': '💻', 'computer': '💻', 'laptop': '💻', 'desktop': '💻',
      'mobile': '📱', 'phone': '📱', 'smartphone': '📱', 'iphone': '📱',
      'rocket': '🚀', 'launch': '🚀', 'fast': '🚀', 'speed': '🚀', 'boost': '🚀',
      'crown': '👑', 'king': '👑', 'queen': '👑', 'royal': '👑', 'ruler': '👑',
      'diamond': '💎', 'gem': '💎', 'precious': '💎', 'jewel': '💎',
      'money': '💰', 'coin': '🪙', 'cash': '💵', 'rich': '💰', 'wealth': '💰',
      'dollar': '💵', 'euro': '💶', 'pound': '💷', 'yen': '💴',
      
      // Nature and weather
      'sun': '☀️', 'sunny': '☀️', 'sunshine': '☀️', 'bright_sun': '☀️',
      'moon': '🌙', 'night': '🌙', 'crescent': '🌙', 'lunar': '🌙',
      'cloud': '☁️', 'cloudy': '☁️', 'overcast': '☁️',
      'rain': '🌧️', 'rainy': '🌧️', 'raining': '🌧️', 'storm': '⛈️',
      'snow': '❄️', 'snowflake': '❄️', 'snowy': '❄️', 'winter': '❄️',
      'tree': '🌳', 'forest': '🌲', 'plant': '🌱', 'flower': '🌸', 'blossom': '🌸',
      'rose': '🌹', 'tulip': '🌷', 'sunflower': '🌻',
      
      // Animals
      'cat': '🐱', 'kitty': '🐱', 'kitten': '🐱', 'feline': '🐱',
      'dog': '🐶', 'puppy': '🐶', 'doggo': '🐶', 'pupper': '🐶',
      'wolf': '🐺', 'lion': '🦁', 'tiger': '🐯', 'bear': '🐻', 'panda': '🐼',
      'fox': '🦊', 'rabbit': '🐰', 'bunny': '🐰', 'mouse': '🐭',
      'dragon': '🐉', 'unicorn': '🦄', 'horse': '🐴', 'cow': '🐄', 'pig': '🐷',
      
      // Food and drinks
      'pizza': '🍕', 'burger': '🍔', 'hamburger': '🍔', 'fries': '🍟',
      'cake': '🎂', 'birthday': '🎂', 'cookie': '🍪', 'donut': '🍩', 'doughnut': '🍩',
      'ice_cream': '🍦', 'icecream': '🍦', 'candy': '🍬', 'chocolate': '🍫',
      'coffee': '☕', 'tea': '🍵', 'beer': '🍺', 'wine': '🍷', 'cocktail': '🍸',
      'water': '💧', 'milk': '🥛', 'juice': '🧃', 'soda': '🥤',
      'apple': '🍎', 'banana': '🍌', 'orange': '🍊', 'strawberry': '🍓',
      
      // Activities and objects
      'music': '🎵', 'note': '🎶', 'musical_note': '🎵', 'song': '🎵',
      'guitar': '🎸', 'piano': '🎹', 'microphone': '🎤', 'mic': '🎤',
      'headphones': '🎧', 'speaker': '🔊', 'sound': '🔊',
      'book': '📚', 'reading': '📖', 'library': '📚', 'study': '📚',
      'pen': '✏️', 'pencil': '✏️', 'write': '✏️', 'writing': '✏️',
      'paint': '🎨', 'art': '🎨', 'artist': '🎨', 'creative': '🎨',
      'camera': '📷', 'photo': '📷', 'picture': '📷', 'video': '📹',
      'movie': '🎬', 'film': '🎬', 'cinema': '🎬', 'tv': '📺', 'television': '📺',
      'radio': '📻', 'news': '📰', 'newspaper': '📰',
      'key': '🔑', 'lock': '🔒', 'unlock': '🔓', 'security': '🔒',
      'shield': '🛡️', 'protection': '🛡️', 'safe': '🛡️',
      'sword': '⚔️', 'weapon': '⚔️', 'gun': '🔫', 'bomb': '💣',
      'tool': '🔧', 'hammer': '🔨', 'wrench': '🔧', 'screwdriver': '🪛',
      'gear': '⚙️', 'settings': '⚙️', 'config': '⚙️', 'cog': '⚙️',
      
      // Transportation
      'car': '🚗', 'vehicle': '🚗', 'auto': '🚗', 'bus': '🚌',
      'train': '🚆', 'airplane': '✈️', 'plane': '✈️', 'ship': '🚢', 'boat': '⛵',
      'bike': '🚴', 'bicycle': '🚴', 'motorcycle': '🏍️',
      
      // Sports and activities
      'football': '⚽', 'soccer': '⚽', 'basketball': '🏀', 'tennis': '🎾',
      'baseball': '⚾', 'golf': '⛳', 'swimming': '🏊', 'running': '🏃',
      'gym': '🏋️', 'workout': '💪', 'muscle': '💪', 'strong': '💪', 'strength': '💪',
      
      // Time and calendar
      'clock': '🕐', 'time': '🕐', 'calendar': '📅', 'date': '📅',
      'alarm': '⏰', 'timer': '⏲️', 'stopwatch': '⏱️',
      
      // Miscellaneous common ones
      'gift': '🎁', 'present': '🎁', 'party': '🎉', 'celebration': '🎉',
      'balloon': '🎈', 'confetti': '🎊', 'tada': '🎉',
      'flag': '🏳️', 'trophy': '🏆', 'medal': '🏅', 'winner': '🏆',
      'target': '🎯', 'bullseye': '🎯', 'goal': '🥅'
    };
    
    // Try exact match first
    if (!envConfig) envConfig = require('../config/config');
    if (emojiMap[name]) {
      if (envConfig.debugMode) {
        logInfo(`🔪 🔍 Converted custom emoji: <:${emojiName}:*> -> ${emojiMap[name]}`);
      }
      return emojiMap[name];
    }
    
    // Try partial matches for compound names - BUT ONLY FOR OBVIOUS MATCHES
    // Only match if the emoji name starts with or exactly contains our key
    for (const [key, emoji] of Object.entries(emojiMap)) {
      // Only match if:
      // 1. Emoji name starts with our key (e.g., "fire_emoji" starts with "fire")
      // 2. Our key is at least 4 characters (avoid false matches like "no" in "unknown")
      // 3. Exact word boundaries (e.g., "heart_red" contains "heart")
      if (key.length >= 4 && (name.startsWith(key) || name.includes('_' + key) || name.includes(key + '_'))) {
        if (envConfig.debugMode) {
          logInfo(`🔪 🔍 Converted custom emoji (partial match): <:${emojiName}:*> -> ${emoji} (matched "${key}")`);
        }
        return emoji;
      }
    }
    
    // If no match found, remove the emoji cleanly
    if (envConfig.debugMode) {
      logInfo(`🔪 🔍 Removed unsupported custom emoji: <:${emojiName}:*> (no match found)`);
    }
    return null;
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