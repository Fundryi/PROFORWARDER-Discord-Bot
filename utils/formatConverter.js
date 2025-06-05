const { logInfo, logError } = require('./logger');

/**
 * Format Converter - Handles conversion between Discord and Telegram formatting
 */
class FormatConverter {
  
  /**
   * Convert Discord markdown to Telegram HTML
   */
  static discordToTelegramHTML(text) {
    if (!text) {
      return '';
    }
    
    const envConfig = require('../config/env');
    if (envConfig.debugMode) {
      logInfo(`Converting Discord to Telegram HTML: "${text}"`);
    }
    
    let converted = text;
    
    // Step 1: Protect code blocks and inline code first
    const protectedElements = [];
    
    // Protect code blocks ```code```
    converted = converted.replace(/```([\s\S]*?)```/g, (match, code) => {
      const index = protectedElements.length;
      protectedElements.push(`<pre>${this.escapeHTML(code.trim())}</pre>`);
      return `__PROTECTED_${index}__`;
    });
    
    // Protect inline code `code`
    converted = converted.replace(/`([^`\n]+)`/g, (match, code) => {
      const index = protectedElements.length;
      protectedElements.push(`<code>${this.escapeHTML(code)}</code>`);
      return `__PROTECTED_${index}__`;
    });
    
    // Step 2: Convert Discord formatting to HTML tags
    // Process in order: bold first, then italic to avoid conflicts
    
    // Bold: **text** -> <b>text</b>
    converted = converted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    
    // Italic: *text* -> <i>text</i> (only single asterisks not part of **)
    converted = converted.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<i>$1</i>');
    
    // Strikethrough: ~~text~~ -> <s>text</s>
    converted = converted.replace(/~~(.*?)~~/g, '<s>$1</s>');
    
    // Spoiler: ||text|| -> <span class="tg-spoiler">text</span>
    converted = converted.replace(/\|\|(.*?)\|\|/g, '<span class="tg-spoiler">$1</span>');
    
    // Step 3: Escape HTML characters in plain text only
    converted = this.escapeHTML(converted);
    
    // Step 4: Fix our HTML tags after escaping (fix both opening and closing tags)
    converted = converted.replace(/&lt;(\/?(?:b|i|s|code|pre))&gt;/g, '<$1>');
    converted = converted.replace(/&lt;span class=&quot;tg-spoiler&quot;&gt;/g, '<span class="tg-spoiler">');
    converted = converted.replace(/&lt;\/span&gt;/g, '</span>');
    
    // Make sure we didn't miss any span tags
    converted = converted.replace(/&lt;span/g, '<span');
    converted = converted.replace(/span&gt;/g, 'span>');
    
    // Step 5: Restore protected elements
    protectedElements.forEach((element, index) => {
      converted = converted.replace(`__PROTECTED_${index}__`, element);
    });
    
    if (envConfig.debugMode) {
      logInfo(`Conversion result: "${converted}"`);
    }
    return converted.trim();
  }
  
  /**
   * Convert Discord markdown to Telegram MarkdownV2
   * Much simpler approach without complex placeholders
   */
  static discordToTelegramMarkdownV2(text) {
    if (!text) return '';
    
    const envConfig = require('../config/env');
    if (envConfig.debugMode) {
      logInfo('Converting Discord to Telegram MarkdownV2:', text);
    }
    
    try {
      let converted = text;
      
      // Step 1: Protect code blocks and inline code first
      const protectedElements = [];
      
      // Protect multiline code blocks ```language\ncode``` or ```code```
      converted = converted.replace(/```(?:(\w+)\n)?([\s\S]*?)```/g, (match, language, code) => {
        const index = protectedElements.length;
        if (language) {
          const escapedCode = code.replace(/([`\\])/g, '\\$1');
          protectedElements.push(`\`\`\`${language}\n${escapedCode}\`\`\``);
        } else {
          const escapedCode = code.replace(/([`\\])/g, '\\$1');
          protectedElements.push(`\`\`\`${escapedCode}\`\`\``);
        }
        return `XPROTECTEDX${index}XPROTECTEDX`;
      });
      
      // Protect inline code `code`
      converted = converted.replace(/`([^`\n]+)`/g, (match, code) => {
        const index = protectedElements.length;
        const escapedCode = code.replace(/([`\\])/g, '\\$1');
        protectedElements.push(`\`${escapedCode}\``);
        return `XPROTECTEDX${index}XPROTECTEDX`;
      });
      
      // Step 2A: Convert Discord headings to Discord bold syntax FIRST
      // This way our existing bold conversion will handle them normally
      converted = converted.replace(/^### (.+)$/gm, '**$1**');      // ### heading -> **heading**
      converted = converted.replace(/^## (.+)$/gm, '**$1**');       // ## heading -> **heading**
      converted = converted.replace(/^# (.+)$/gm, '**$1**');        // # heading -> **heading**
      
      if (envConfig.debugMode) {
        logInfo(`🔍 HEADING DEBUG: After heading conversion: "${converted}"`);
      }
      
      // Step 2B: Convert Discord mentions to plain text (since Telegram doesn't support them)
      
      // Convert ALL Discord mentions to use full-width @ to prevent Telegram mentions
      converted = converted.replace(/<@!?(\d+)>/g, '＠User');
      
      // Convert Discord role mentions <@&123> to full-width @ text
      converted = converted.replace(/<@&(\d+)>/g, '＠Role');
      
      // Convert Discord channel mentions <#123> to escaped # text (keep # prefix for channels)
      converted = converted.replace(/<#(\d+)>/g, '\\#Channel');
      
      // Convert @everyone and @here to full-width @ to prevent unwanted mentions
      converted = converted.replace(/@everyone/g, '＠everyone');
      converted = converted.replace(/@here/g, '＠here');
      
      // Convert Discord custom emojis <:name:123> to emoji name
      converted = converted.replace(/<:(\w+):\d+>/g, ':$1:');
      
      // Step 3: Convert Discord formatting to Telegram MarkdownV2
      
      // Complex combinations first
      converted = converted.replace(/__\*\*\*(.*?)\*\*\*__/g, '*_\\_$1\\_*');  // __***text***__
      converted = converted.replace(/__\*\*(.*?)\*\*__/g, '__*$1*__');        // __**text**__
      converted = converted.replace(/__\*(.*?)\*__/g, '___$1___');            // __*text*__
      converted = converted.replace(/\*\*\*(.*?)\*\*\*/g, '*_$1_*');          // ***text***
      
      // Simple formatting - be more surgical about the conversion
      converted = converted.replace(/\*\*(.*?)\*\*/g, '*$1*');                // **text** -> *text*
      
      if (envConfig.debugMode) {
        logInfo(`🔍 BOLD DEBUG: After bold conversion: "${converted}"`);
      }
      
      // Note: We skip italic conversion completely - Discord *italic* will just stay as *italic* (plain text)
      converted = converted.replace(/~~(.*?)~~/g, '~$1~');                    // ~~text~~ -> ~text~
      // __text__ stays __text__ (underline)
      // ||text|| stays ||text|| (spoiler)
      
      // Step 3: Handle links [text](url)
      converted = converted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
        const escapedUrl = url.replace(/([)\\])/g, '\\$1');
        return `[${text}](${escapedUrl})`;
      });
      
      // Step 4: Handle block quotes
      converted = converted.replace(/^> (.+)$/gm, '>$1');
      converted = converted.replace(/^>>> ([\s\S]*?)$/gm, '**>$1');
      
      // Step 5: Simple character escaping - identify formatting elements first
      
      // First, let's identify all formatting elements and their positions
      const formattingRanges = [];
      
      // Find all formatting patterns (order matters - longest first!)
      const patterns = [
        /\*_[^_]*_\*/g,        // *_text_* (bold italic)
        /__\*[^*]*\*__/g,      // __*text*__ (underline bold)
        /___[^_]*___/g,        // ___text___ (underline italic)
        /__[^_]*__/g,          // __text__ (underline)
        /\*[^*]*\*/g,          // *text* (bold) - this will be treated as formatting to preserve
        // Note: We removed _text_ pattern since we ignore italic completely
        /~[^~]*~/g,            // ~text~ (strikethrough)
        /\|\|[^|]*\|\|/g,      // ||text|| (spoiler)
        /\[[^\]]+\]\([^)]+\)/g, // [text](url) (link)
        />.*$/gm,              // >text (quote)
        /XPROTECTEDX\d+XPROTECTEDX/g   // XPROTECTEDXNXPROTECTEDX (code)
      ];
      
      patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(converted)) !== null) {
          formattingRanges.push({
            start: match.index,
            end: match.index + match[0].length,
            text: match[0]
          });
          // Reset regex lastIndex to avoid infinite loop
          pattern.lastIndex = match.index + 1;
        }
      });
      
      // Sort ranges by start position
      formattingRanges.sort((a, b) => a.start - b.start);
      
      // Remove overlapping ranges (keep the first one found)
      const cleanRanges = [];
      for (const range of formattingRanges) {
        const overlaps = cleanRanges.some(existing =>
          range.start < existing.end && range.end > existing.start
        );
        if (!overlaps) {
          cleanRanges.push(range);
        }
      }
      
      // Build result by alternating between plain text and formatting
      let result = '';
      let pos = 0;
      
      for (const range of cleanRanges) {
        // Add escaped plain text before this formatting
        if (range.start > pos) {
          const plainText = converted.substring(pos, range.start);
          result += plainText.replace(/([_*\[\]()~`>#+=\-|{}.!\\])/g, '\\$1');
        }
        
        // Add the formatting as-is
        result += range.text;
        pos = range.end;
      }
      
      // Add any remaining plain text
      if (pos < converted.length) {
        const remainingText = converted.substring(pos);
        result += remainingText.replace(/([_*\[\]()~`>#+=\-|{}.!\\])/g, '\\$1');
      }
      
      converted = result;
      
      // Step 6: Restore protected code elements
      protectedElements.forEach((element, index) => {
        converted = converted.replace(`XPROTECTEDX${index}XPROTECTEDX`, element);
      });
      
      // Step 7: Final validation - check for unmatched UNESCAPED entities
      const unescapedCounts = {
        '*': (converted.match(/(?<!\\)\*/g) || []).length,
        '_': (converted.match(/(?<!\\)_/g) || []).length,
        '~': (converted.match(/(?<!\\)~/g) || []).length,
        '|': (converted.match(/(?<!\\)\|/g) || []).length
      };
      
      // Fix unmatched entities by escaping the last unescaped occurrence
      Object.entries(unescapedCounts).forEach(([char, count]) => {
        if (count % 2 !== 0) {
          logError(`Unmatched ${char} entities detected (count: ${count}), fixing...`);
          // Find the last unescaped occurrence and escape it
          const regex = new RegExp(`(?<!\\\\)\\${char === '|' ? '\\|' : char}`, 'g');
          const matches = [...converted.matchAll(regex)];
          if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            const pos = lastMatch.index;
            converted = converted.substring(0, pos) + '\\' + char + converted.substring(pos + 1);
          }
        }
      });
      
      if (envConfig.debugMode) {
        logInfo('Conversion result:', converted);
      }
      return converted.trim();
      
    } catch (error) {
      logError('MarkdownV2 conversion error:', error);
      // Fallback: escape everything as plain text
      return this.escapeMarkdownV2ForText(text);
    }
  }
  
  /**
   * Escape HTML special characters
   */
  static escapeHTML(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  
  /**
   * Escape HTML characters but keep our formatting tags
   */
  static escapeHTMLButKeepTags(text) {
    if (!text) return '';
    
    // First, protect our HTML tags with a simpler approach
    const protectedTags = [];
    
    // Protect complete tag pairs and self-closing tags
    text = text.replace(/(<(?:b|i|s|code|pre)>.*?<\/(?:b|i|s|code|pre)>)|(<span class="tg-spoiler">.*?<\/span>)/g, (match) => {
      const index = protectedTags.length;
      protectedTags.push(match);
      return `__TAG_${index}__`;
    });
    
    // Escape remaining HTML characters in plain text
    text = this.escapeHTML(text);
    
    // Restore protected tags
    protectedTags.forEach((tag, index) => {
      text = text.replace(`__TAG_${index}__`, tag);
    });
    
    return text;
  }

  /**
   * Escape text for use in Telegram MarkdownV2 (for plain text content)
   */
  static escapeMarkdownV2ForText(text) {
    if (!text) return '';
    
    // Characters that need escaping in MarkdownV2 plain text:
    // _ * [ ] ( ) ~ ` > # + - = | { } . ! \
    return text.replace(/([_*\[\]()~`>#+=\-|{}.!\\])/g, '\\$1');
  }
}

module.exports = FormatConverter;