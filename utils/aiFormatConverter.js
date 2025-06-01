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

DISCORD MENTIONS - CONVERT TO CLEAN TEXT:
10. User mentions <@123456> or <@!123456> → Username (remove all <>, @, and IDs - just username)
11. Role mentions <@&123456> → RoleName (remove all <>, @, &, and IDs - just role name)
12. Channel mentions <#123456> → channelname (remove all <>, #, and IDs - just channel name)
13. Custom emojis <:name:123456> → :name: (keep emoji name, remove ID and <>)

ESCAPING - CRITICAL: These characters MUST be escaped with backslash in ALL text: _ * [ ] ( ) ~ \` # + - = | { } . ! \\

EXAMPLES:
- Discord: "<@151671554806251520>" → Telegram: "Username"
- Discord: "<@&456789>" → Telegram: "RoleName"
- Discord: "<#123456>" → Telegram: "channelname"
- Discord: "# Heading" → Telegram: "*Heading*"
- Discord: "Text with . and !" → Telegram: "Text with \\. and \\!"
- Discord: "Amazing!" → Telegram: "Amazing\\!"
- Discord: "Booster!" → Telegram: "Booster\\!"

Discord text to convert:
${text}

Converted text:`;

      // Get the Gemini provider and use its makeRequest method directly
      logInfo('🤖 AI Debug: Getting Gemini provider for format conversion...');
      const geminiProvider = aiManager.providers.get('gemini');
      
      if (!geminiProvider) {
        throw new Error('Gemini provider not available');
      }
      
      logInfo('🤖 AI Debug: Calling Gemini API directly with enhanced logging...');
      logInfo('🤖 AI Debug: Prompt being sent:', aiPrompt.substring(0, 200) + '...');
      logInfo('🤖 AI Debug: Input text length:', text.length);
      logInfo('🤖 AI Debug: Input text preview:', text.substring(0, 100));
      
      // Call Gemini API directly to get full response details
      const url = `${geminiProvider.baseURL}/models/${geminiProvider.model}:generateContent?key=${geminiProvider.apiKey}`;
      
      const requestBody = {
        contents: [{
          parts: [{
            text: aiPrompt
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          }
        ]
      };

      logInfo('🤖 AI Debug: Making direct Gemini API call...');
      
      const axios = require('axios');
      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      logInfo('🤖 AI Debug: Full Gemini response:', JSON.stringify(response.data, null, 2));
      
      let aiResult = '';
      if (response.data && response.data.candidates && response.data.candidates[0]) {
        const candidate = response.data.candidates[0];
        
        logInfo('🤖 AI Debug: Candidate data:', JSON.stringify(candidate, null, 2));
        logInfo('🤖 AI Debug: Finish reason:', candidate.finishReason);
        logInfo('🤖 AI Debug: Safety ratings:', JSON.stringify(candidate.safetyRatings, null, 2));
        
        if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
          aiResult = candidate.content.parts[0].text;
          logInfo('🤖 AI Debug: Extracted text:', aiResult);
        } else {
          logError('🤖 AI Debug: No content in candidate, likely blocked by safety filters');
          logError('🤖 AI Debug: Candidate structure:', JSON.stringify(candidate, null, 2));
        }
      } else {
        logError('🤖 AI Debug: No candidates in response');
        logError('🤖 AI Debug: Response structure:', JSON.stringify(response.data, null, 2));
      }
      
      logInfo('🤖 AI Debug: AI result received:', typeof aiResult, aiResult?.length || 0, 'chars');
      logInfo('🤖 AI Debug: AI result content:', JSON.stringify(aiResult));
      logInfo('🤖 AI Debug: AI result raw string:', aiResult);
      
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