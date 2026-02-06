const { logInfo, logError } = require('../../utils/logger');

/**
 * Telegram Text Splitter - Smart text length handling and splitting
 * Handles optimal text splitting while preserving formatting and readability
 */
class TelegramTextSplitter {
  constructor() {
    // Text length limits
    this.TEXT_LIMIT = 4000; // Safe limit for text messages
    this.CAPTION_LIMIT = 900; // Safe limit for media captions
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
   * Remove separator line (━━━━━━━━━━━━━━━━━━━━━━━━━) when using splitting strategies
   */
  removeSeparatorLine(text) {
    // Look for the separator line pattern (multiple ━ characters)
    const separatorPattern = /\n━{10,}\n?/g;
    return text.replace(separatorPattern, '\n');
  }

  /**
   * Check if text contains URLs that might cause WEBPAGE_CURL_FAILED in media captions
   */
  hasProblematicUrls(text) {
    // Look for URLs that commonly cause WEBPAGE_CURL_FAILED in media captions
    const problematicPatterns = [
      /https?:\/\/t\.me\//i,          // Telegram links
      /https?:\/\/discord\.gg\//i,    // Discord invite links
      /https?:\/\/[^\s)]+/g           // Any HTTP/HTTPS links (be conservative)
    ];
    
    return problematicPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Split long text into multiple parts with smart boundaries
   */
  splitLongText(text, maxLength, splitIndicator = '...(continued)') {
    const parts = [];
    let remainingText = text;
    
    while (remainingText.length > 0) {
      if (remainingText.length <= maxLength) {
        // Last part - add as is
        parts.push(remainingText);
        break;
      }
      
      // Find optimal split point
      const availableLength = maxLength - splitIndicator.length - 10; // Reserve space for indicator
      const splitPoint = this.findOptimalSplitPoint(remainingText, availableLength);
      
      // Create current part with indicator
      const currentPart = remainingText.substring(0, splitPoint).trim() + '\n\n' + splitIndicator;
      parts.push(currentPart);
      
      // Update remaining text
      remainingText = remainingText.substring(splitPoint).trim();
    }
    
    return parts;
  }

  /**
   * Extract header from full content (used for separate strategy)
   */
  extractHeader(fullContent) {
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
    }
    
    return {
      header: headerForCaption,
      content: contentWithoutHeader
    };
  }

  /**
   * Calculate optimal split strategy based on content
   */
  determineSplitStrategy(text, mediaCount, hasEmbedMedia = false) {
    const envConfig = require('../../config/config');
    const configStrategy = envConfig.telegram?.captionSplitStrategy || 'smart';
    
    // Override strategy for embed media to avoid WEBPAGE_MEDIA_EMPTY
    if (hasEmbedMedia && configStrategy === 'separate') {
      return 'smart'; // Fall back to smart splitting for embed media
    }
    
    // For clean media without problematic URLs, allow separate strategy
    if (configStrategy === 'separate' && mediaCount > 0 && !hasEmbedMedia) {
      return 'separate';
    }
    
    // Default to smart splitting
    return 'smart';
  }

  /**
   * Get text and caption length limits from config
   */
  getLimits() {
    const envConfig = require('../../config/config');
    return {
      textLimit: this.TEXT_LIMIT,
      captionLimit: envConfig.telegram?.captionLengthLimit || this.CAPTION_LIMIT
    };
  }
}

module.exports = TelegramTextSplitter;