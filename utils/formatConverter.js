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
      logInfo('Converting Discord to Telegram HTML: (empty text)');
      return '';
    }
    
    logInfo(`Converting Discord to Telegram HTML: "${text}"`);
    
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
    
    logInfo(`Conversion result: "${converted}"`);
    return converted.trim();
  }
  
  /**
   * Convert Discord markdown to Telegram MarkdownV2
   * Much simpler approach without complex placeholders
   */
  static discordToTelegramMarkdownV2(text) {
    if (!text) return '';
    
    logInfo('Converting Discord to Telegram MarkdownV2:', text);
    
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
      
      // Step 2: Convert Discord formatting to Telegram MarkdownV2
      
      // Complex combinations first
      converted = converted.replace(/__\*\*\*(.*?)\*\*\*__/g, '*_\\_$1\\_*');  // __***text***__
      converted = converted.replace(/__\*\*(.*?)\*\*__/g, '__*$1*__');        // __**text**__
      converted = converted.replace(/__\*(.*?)\*__/g, '___$1___');            // __*text*__
      converted = converted.replace(/\*\*\*(.*?)\*\*\*/g, '*_$1_*');          // ***text***
      
      // Simple formatting - be more surgical about the conversion
      converted = converted.replace(/\*\*(.*?)\*\*/g, '*$1*');                // **text** -> *text*
      
      // For italic conversion, we need to distinguish between:
      // 1. Bold text we just converted: *bold* (should be left alone)
      // 2. Original italic text: *italic* (should become _italic_)
      
      // Strategy: Mark the text, then check what was originally bold vs italic
      const originalText = text; // Keep reference to original
      
      // Find all original **bold** positions to avoid converting them when they become *bold*
      const originalBoldRanges = [];
      const boldRegex = /\*\*(.*?)\*\*/g;
      let boldMatch;
      while ((boldMatch = boldRegex.exec(originalText)) !== null) {
        // In the converted text, this will be *content* instead of **content**
        // So we need to find where "*content*" appears and protect it
        const content = boldMatch[1];
        const boldInConverted = `*${content}*`;
        const pos = converted.indexOf(boldInConverted);
        if (pos !== -1) {
          originalBoldRanges.push({
            start: pos,
            end: pos + boldInConverted.length,
            text: boldInConverted
          });
        }
      }
      
      // Now convert italic, but skip ranges that were originally bold
      let italicResult = '';
      let italicPos = 0;
      const italicRegex = /\*([^*\n]+?)\*/g;
      let italicMatch;
      
      while ((italicMatch = italicRegex.exec(converted)) !== null) {
        // Add text before this match
        italicResult += converted.substring(italicPos, italicMatch.index);
        
        // Check if this asterisk pair is in a protected bold range
        const isProtectedBold = originalBoldRanges.some(range =>
          italicMatch.index >= range.start && italicMatch.index + italicMatch[0].length <= range.end
        );
        
        if (isProtectedBold) {
          // This was originally bold, keep as *text*
          italicResult += italicMatch[0];
        } else {
          // This was originally italic, convert to _text_
          italicResult += `_${italicMatch[1]}_`;
        }
        
        italicPos = italicMatch.index + italicMatch[0].length;
      }
      
      // Add remaining text
      italicResult += converted.substring(italicPos);
      converted = italicResult;
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
        /\*[^*]*\*/g,          // *text* (bold)
        /_[^_]*_/g,            // _text_ (italic)
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
      
      logInfo('Conversion result:', converted);
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