const { logInfo, logError } = require('./logger');
const FormatConverter = require('./formatConverter');

/**
 * AI-Powered Format Converter - Uses AI for complex Discord to Telegram formatting
 */
class AIFormatConverter {
  
  /**
   * AI-powered Discord to Telegram MarkdownV2 conversion
   * Uses AI for complex edge cases while falling back to regular conversion
   */
  static async discordToTelegramMarkdownV2WithAI(text) {
    if (!text) return '';
    
    try {
      // Check if we have AI manager available
      const aiManager = require('./aiManager');
      
      logInfo('🤖 AI Debug: Checking AI manager status...');
      logInfo(`🤖 AI Debug: aiManager exists: ${!!aiManager}`);
      logInfo(`🤖 AI Debug: aiManager.initialized: ${aiManager?.initialized}`);
      
      if (!aiManager || !aiManager.initialized) {
        logInfo('🤖 AI manager not initialized, falling back to regular conversion');
        return FormatConverter.discordToTelegramMarkdownV2(text);
      }
      
      logInfo('🤖 Using AI-powered format conversion for:', text);
      
      const aiPrompt = `Convert this Discord markdown text to Telegram MarkdownV2 format. Return ONLY the converted text, no explanations.

RULES:
1. **Bold text** → *bold text*
2. *Italic text* → _italic text_
3. ***Bold+Italic*** → *_bold+italic_*
4. ~~strikethrough~~ → ~strikethrough~
5. \`\`\`code blocks\`\`\` → \`\`\`code blocks\`\`\` (keep unchanged)
6. \`inline code\` → \`inline code\` (keep unchanged)
7. [links](url) → [links](url) (keep unchanged)
8. ||spoilers|| → ||spoilers|| (keep unchanged)
9. Discord headings (# ## ###) → Convert to *bold text* format, don't use # in output
10. CRITICAL: Escape these special characters with backslash in plain text: _ * [ ] ( ) ~ \` > # + - = | { } . ! \\

EXAMPLES:
- Discord: "# Heading" → Telegram: "*Heading*"
- Discord: "## Sub heading" → Telegram: "*Sub heading*"
- Discord: "Regular text with . and !" → Telegram: "Regular text with \\. and \\!"

Discord text to convert:
${text}

Converted text:`;

      // Get the Gemini provider and use its makeRequest method directly
      logInfo('🤖 AI Debug: Getting Gemini provider for format conversion...');
      const geminiProvider = aiManager.providers.get('gemini');
      
      if (!geminiProvider) {
        throw new Error('Gemini provider not available');
      }
      
      logInfo('🤖 AI Debug: Calling Gemini makeRequest directly...');
      const aiResult = await geminiProvider.makeRequest(aiPrompt);
      
      logInfo('🤖 AI Debug: AI result received:', typeof aiResult, aiResult?.length || 0, 'chars');
      logInfo('🤖 AI Debug: AI result content:', JSON.stringify(aiResult));
      
      // makeRequest returns a string directly
      if (aiResult && typeof aiResult === 'string' && aiResult.trim()) {
        logInfo('🤖 AI conversion result:', aiResult);
        
        // Validate AI result - check for basic formatting integrity
        if (this.validateAIResult(aiResult.trim(), text)) {
          return aiResult.trim();
        } else {
          logError('🤖 AI result failed validation, falling back to regular conversion');
          return FormatConverter.discordToTelegramMarkdownV2(text);
        }
      } else {
        logError('🤖 AI conversion returned empty or invalid result');
        logError('🤖 AI Debug: Original aiResult was:', JSON.stringify(aiResult));
        logInfo('🤖 AI conversion failed, falling back to regular conversion');
        return FormatConverter.discordToTelegramMarkdownV2(text);
      }
      
    } catch (error) {
      logError('🤖 AI format conversion error:', error);
      logInfo('Falling back to regular conversion');
      return FormatConverter.discordToTelegramMarkdownV2(text);
    }
  }

  /**
   * Validate AI conversion result for basic integrity
   */
  static validateAIResult(aiResult, originalText) {
    try {
      // Basic checks
      if (!aiResult || aiResult.length === 0) {
        logError('🤖 AI result is empty');
        return false;
      }
      
      // Check for reasonable length (AI result shouldn't be drastically different)
      if (aiResult.length > originalText.length * 5) {
        logError('🤖 AI result too long, possibly hallucinated');
        return false;
      }
      
      // Check if result contains our internal placeholders (means AI got pre-processed text)
      if (aiResult.includes('XPROTECTEDX')) {
        logError('🤖 AI result contains internal placeholders - AI got pre-processed text');
        return false;
      }
      
      // Check for balanced formatting characters (very basic validation)
      const asteriskCount = (aiResult.match(/\*/g) || []).length;
      const underscoreCount = (aiResult.match(/_/g) || []).length;
      
      // Only fail if we have an extreme number of formatting chars
      if (asteriskCount > originalText.length * 2 || underscoreCount > originalText.length * 2) {
        logError('🤖 AI result has suspicious formatting character count');
        return false;
      }
      
      // More lenient code block validation - check if we have at least some code blocks if original had them
      const originalCodeBlocks = (originalText.match(/```/g) || []).length;
      const resultCodeBlocks = (aiResult.match(/```/g) || []).length;
      
      // Only fail if original had code blocks but result has none, or result has way more
      if (originalCodeBlocks > 0 && resultCodeBlocks === 0) {
        logError('🤖 AI result completely lost all code blocks');
        return false;
      }
      if (resultCodeBlocks > originalCodeBlocks * 2) {
        logError('🤖 AI result has too many code blocks');
        return false;
      }
      
      logInfo('🤖 AI result passed validation');
      return true;
    } catch (error) {
      logError('🤖 AI result validation error:', error);
      return false;
    }
  }

  /**
   * Static helper method to conditionally use AI or regular conversion
   * Can be called from anywhere in the codebase
   */
  static async convertDiscordToTelegramMarkdownV2(text) {
    const envConfig = require('../config/env');
    
    // Check if AI format converter is enabled
    if (envConfig.useAIFormatConverter) {
      try {
        // Use AI-powered format conversion
        return await AIFormatConverter.discordToTelegramMarkdownV2WithAI(text);
      } catch (error) {
        logError('AI format conversion failed, falling back to regular conversion:', error);
        // Fallback to regular conversion if AI fails
        return FormatConverter.discordToTelegramMarkdownV2(text);
      }
    } else {
      // Use regular format conversion
      return FormatConverter.discordToTelegramMarkdownV2(text);
    }
  }
}

module.exports = AIFormatConverter;