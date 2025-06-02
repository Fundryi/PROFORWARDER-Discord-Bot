const { logInfo, logError } = require('./logger');
const FormatConverter = require('./formatConverter');

/**
 * AI-Powered Format Converter - Uses AI for complex Discord to Telegram formatting
 */
class AIFormatConverter {

  /**
   * Extract Discord mentions from text and get replacement mapping
   * @param {string} text - The text to extract mentions from
   * @param {Object} message - Discord message object with mentions data
   * @returns {Object} Object containing mentions and replacement instructions
   */
  static extractMentionsAndCreateMapping(text, message = null) {
    const mentions = {
      users: [],
      roles: [],
      channels: [],
      replacements: []
    };

    if (!message) {
      logError('No Discord message object provided for mention resolution');
      return mentions;
    }

    // Extract user mentions: <@123456> or <@!123456>
    const userMentionRegex = /<@!?(\d+)>/g;
    let match;
    while ((match = userMentionRegex.exec(text)) !== null) {
      const userId = match[1];
      const fullMention = match[0];
      
      // Get actual username from message.mentions.users
      const user = message.mentions.users.get(userId);
      const userName = user ? (user.globalName || user.username || user.displayName) : `User${userId}`;
      
      mentions.users.push({ id: userId, fullMention, name: userName });
      mentions.replacements.push(`Replace "${fullMention}" with "${userName}"`);
      
      const envConfig = require('../config/env');
      if (envConfig.debugMode) {
        logInfo(`🔍 Found user mention: ${fullMention} -> ${userName}`);
      }
    }

    // Extract role mentions: <@&123456>
    const roleMentionRegex = /<@&(\d+)>/g;
    while ((match = roleMentionRegex.exec(text)) !== null) {
      const roleId = match[1];
      const fullMention = match[0];
      
      // Get actual role name from message.mentions.roles
      const role = message.mentions.roles.get(roleId);
      const roleName = role ? role.name : `Role${roleId}`;
      
      mentions.roles.push({ id: roleId, fullMention, name: roleName });
      mentions.replacements.push(`Replace "${fullMention}" with "${roleName}"`);
      
      const envConfig = require('../config/env');
      if (envConfig.debugMode) {
        logInfo(`🔍 Found role mention: ${fullMention} -> ${roleName}`);
      }
    }

    // Extract channel mentions: <#123456>
    const channelMentionRegex = /<#(\d+)>/g;
    while ((match = channelMentionRegex.exec(text)) !== null) {
      const channelId = match[1];
      const fullMention = match[0];
      
      // Get actual channel name from message.mentions.channels or guild channels
      let channel = message.mentions.channels.get(channelId);
      if (!channel && message.guild) {
        channel = message.guild.channels.cache.get(channelId);
      }
      const channelName = channel ? channel.name : `channel${channelId}`;
      
      mentions.channels.push({ id: channelId, fullMention, name: channelName });
      mentions.replacements.push(`Replace "${fullMention}" with "${channelName}"`);
      
      const envConfig = require('../config/env');
      if (envConfig.debugMode) {
        logInfo(`🔍 Found channel mention: ${fullMention} -> ${channelName}`);
      }
    }

    const envConfig = require('../config/env');
    if (envConfig.debugMode) {
      logInfo(`🔍 Total mentions found: ${mentions.users.length} users, ${mentions.roles.length} roles, ${mentions.channels.length} channels`);
    }
    return mentions;
  }

  /**
   * AI-powered Discord to Telegram MarkdownV2 conversion with mention resolution
   * Uses AI for complex edge cases while falling back to regular conversion
   * @param {string} text - Text to convert
   * @param {Object} message - Discord message object (optional, for mention resolution)
   */
  static async discordToTelegramMarkdownV2WithAI(text, message = null) {
    if (!text) return '';
    
    try {
      // Check if we have AI manager available
      const aiManager = require('./aiManager');
      const envConfig = require('../config/env');
      
      if (envConfig.debugMode) {
        logInfo('🤖 AI Debug: Checking AI manager status...');
        logInfo(`🤖 AI Debug: aiManager exists: ${!!aiManager}`);
        logInfo(`🤖 AI Debug: aiManager.initialized: ${aiManager?.initialized}`);
      }
      
      if (!aiManager || !aiManager.initialized) {
        if (envConfig.debugMode) {
          logInfo('🤖 AI manager not initialized, falling back to regular conversion');
        }
        return FormatConverter.discordToTelegramMarkdownV2(text);
      }
      
      if (envConfig.debugMode) {
        logInfo(`🤖 Using AI-powered format conversion for: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
      }
      
      // Extract mentions and create replacement mapping if message object is provided
      let mentionInstructions = '';
      if (message) {
        const mentionData = this.extractMentionsAndCreateMapping(text, message);
        if (mentionData.replacements.length > 0) {
          mentionInstructions = `\n\nSPECIFIC MENTION REPLACEMENTS:\n${mentionData.replacements.join('\n')}\n`;
          if (envConfig.debugMode) {
            logInfo(`🔍 Generated mention replacement instructions: ${mentionData.replacements.length} replacements`);
          }
        }
      }
      
      const aiPrompt = `Convert this Discord markdown text to Telegram MarkdownV2 format. Return ONLY the converted text, no explanations.

TELEGRAM MARKDOWNV2 IS EXTREMELY STRICT - FOLLOW THESE RULES EXACTLY:

FORMATTING CONVERSIONS:
1. **Bold text** → *bold text*
2. *Italic text* → _italic text_
3. ***Bold+Italic*** → *_bold+italic_*
4. ~~strikethrough~~ → ~strikethrough~
5. \`\`\`code blocks\`\`\` → \`\`\`code blocks\`\`\` (keep unchanged)
6. \`inline code\` → \`inline code\` (keep unchanged)
7. [links](url) → [links](url) (keep unchanged)
8. ||spoilers|| → ||spoilers|| (keep unchanged)
9. Discord headings:
   - # ## ### → Convert to *bold text* format
   - #### ##### ###### → Keep as plain text but escape # characters

CRITICAL ESCAPING RULES - TELEGRAM WILL REJECT THE MESSAGE IF THESE ARE WRONG:
- ALWAYS escape these characters in plain text: [ ] ( ) ~ \` > # + - = | { } . ! \\
- Inside *bold* or _italic_ formatting, escape special characters BUT NOT the formatting markers themselves
- FORMATTING MARKERS MUST NEVER BE ESCAPED:
  * The * character that starts bold: *
  * The * character that ends bold: *
  * The _ character that starts italic: _
  * The _ character that ends italic: _
  * The ~ character that starts strikethrough: ~
  * The ~ character that ends strikethrough: ~
  * The \` character that starts code: \`
  * The \` character that ends code: \`

CORRECT EXAMPLES:
- Discord: "**Welcome!**" → Telegram: "*Welcome\\!*" (! escaped, both * NOT escaped)
- Discord: "**UNI EMPIRE**" → Telegram: "*UNI EMPIRE*" (both * NOT escaped)
- Discord: "### 🌟 Welcome!" → Telegram: "*🌟 Welcome\\!*" (heading to bold, ! escaped, both * NOT escaped)
- Discord: "**Boost Rewards:**" → Telegram: "*Boost Rewards\\:*" (: escaped, both * NOT escaped)
- Discord: "**Genshin Impact | Update 26.05**" → Telegram: "*Genshin Impact \\| Update 26\\.05*" (| and . escaped, both * NOT escaped)

WRONG EXAMPLES (DO NOT DO THIS):
- Discord: "**Welcome!**" → Telegram: "*Welcome\\!\\*" ❌ (closing * should NOT be escaped)
- Discord: "**Update**" → Telegram: "*Update\\*" ❌ (closing * should NOT be escaped)

NEWLINE HANDLING:
- Keep ALL line breaks exactly as they appear
- Do NOT convert newlines to literal "n" characters
- Preserve bullet points and spacing

DISCORD MENTIONS - CONVERT TO CLEAN TEXT:
- User mentions <@123456> or <@!123456> → Replace with actual username (see specific replacements below)
- Role mentions <@&123456> → Replace with actual role name (see specific replacements below)
- Channel mentions <#123456> → Replace with actual channel name (see specific replacements below)

DISCORD EMOJIS - REMOVE OR REPLACE:
- Custom emojis <:name:123456> → Remove completely OR replace with standard emoji if applicable
- Animated emojis <a:name:123456> → Remove completely OR replace with standard emoji if applicable
- If emoji name contains "heart" → ❤️
- If emoji name contains "fire" → 🔥
- If emoji name contains "star" → ⭐
- If emoji name contains "check" or "tick" → ✅
- If emoji name contains "cross" or "x" → ❌
- If emoji name contains "laugh" or "joy" → 😂
- If emoji name contains "sad" or "cry" → 😢
- All other custom emojis → Remove completely (don't leave :name:)

EXAMPLE CONVERSION:
Discord input:
**Bold text**
# test
## test
### test
#### test
##### test
###### test

Should become:
*Bold text*
*test*
*test*
*test*
\\#\\#\\#\\# test
\\#\\#\\#\\#\\# test
\\#\\#\\#\\#\\#\\# test

CRITICAL:
- Convert Discord headings # ## ### to *bold text* format (remove the #)
- For #### ##### ###### keep as plain text but escape ALL # characters as \\#
- Remove all Discord custom emojis unless they match common patterns for replacement
- NEVER EVER escape the * characters that are used for bold formatting
- Bold formatting must be: *text* NOT *text\\*
- The closing * must NEVER have a backslash before it
- ALL # characters must be escaped as \\# if not converted to bold${mentionInstructions}

Discord text to convert:
${text}

Converted text (escape ALL special characters even inside formatting):`;

      // Get the Gemini provider and use its makeRequest method directly
      if (envConfig.debugMode) {
        logInfo('🤖 AI Debug: Getting Gemini provider for format conversion...');
      }
      const geminiProvider = aiManager.providers.get('gemini');
      
      if (!geminiProvider) {
        throw new Error('Gemini provider not available');
      }
      
      if (envConfig.debugMode) {
        logInfo('🤖 AI Debug: Calling Gemini API directly with enhanced logging...');
        logInfo('🤖 AI Debug: Prompt being sent:', aiPrompt.substring(0, 200) + '...');
        logInfo('🤖 AI Debug: Input text length:', text.length);
        logInfo('🤖 AI Debug: Input text preview:', text.substring(0, 100));
      }
      
      // Call Gemini API directly to get full response details
      const url = `${geminiProvider.baseURL}/models/${geminiProvider.model}:generateContent?key=${geminiProvider.apiKey}`;
      
      const requestBody = {
        contents: [{
          parts: [{
            text: aiPrompt
          }]
        }],
        generationConfig: {
          temperature: 0,    // Absolutely zero randomness
          topK: 1,           // Only the single most likely token
          topP: 0,           // Zero nucleus sampling
          maxOutputTokens: 2048,
          candidateCount: 1, // Only generate one candidate
          stopSequences: []  // No stop sequences
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

      if (envConfig.debugMode) {
        logInfo('🤖 AI Debug: Making direct Gemini API call...');
      }
      
      const axios = require('axios');
      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (envConfig.debugMode) {
        logInfo('🤖 AI Debug: Full Gemini response:', JSON.stringify(response.data, null, 2));
      }
      
      let aiResult = '';
      if (response.data && response.data.candidates && response.data.candidates[0]) {
        const candidate = response.data.candidates[0];
        
        if (envConfig.debugMode) {
          logInfo('🤖 AI Debug: Candidate data:', JSON.stringify(candidate, null, 2));
          logInfo('🤖 AI Debug: Finish reason:', candidate.finishReason);
          logInfo('🤖 AI Debug: Safety ratings:', JSON.stringify(candidate.safetyRatings, null, 2));
        }
        
        if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
          aiResult = candidate.content.parts[0].text;
          if (envConfig.debugMode) {
            logInfo('🤖 AI Debug: Extracted text:', aiResult);
          }
        } else {
          logError('🤖 AI Debug: No content in candidate, likely blocked by safety filters');
          if (envConfig.debugMode) {
            logError('🤖 AI Debug: Candidate structure:', JSON.stringify(candidate, null, 2));
          }
        }
      } else {
        logError('🤖 AI Debug: No candidates in response');
        if (envConfig.debugMode) {
          logError('🤖 AI Debug: Response structure:', JSON.stringify(response.data, null, 2));
        }
      }
      
      if (envConfig.debugMode) {
        logInfo('🤖 AI Debug: AI result received:', typeof aiResult, aiResult?.length || 0, 'chars');
        logInfo('🤖 AI Debug: AI result content:', JSON.stringify(aiResult));
        logInfo('🤖 AI Debug: AI result raw string:', aiResult);
      }
      
      // makeRequest returns a string directly
      if (aiResult && typeof aiResult === 'string' && aiResult.trim()) {
        if (envConfig.debugMode) {
          logInfo('🤖 AI conversion result:', aiResult);
        }
        
        // Fix any malformed bold formatting the AI might have produced
        let fixedResult = this.fixMalformedBoldFormatting(aiResult.trim());
        
        // Validate AI result - check for basic formatting integrity
        if (this.validateAIResult(fixedResult, text)) {
          logInfo('🤖 AI result passed validation');
          return fixedResult;
        } else {
          logError('🤖 AI result failed validation, falling back to regular conversion');
          return FormatConverter.discordToTelegramMarkdownV2(text);
        }
      } else {
        logError('🤖 AI conversion returned empty or invalid result');
        if (envConfig.debugMode) {
          logError('🤖 AI Debug: Original aiResult was:', JSON.stringify(aiResult));
        }
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
      
      // Check for malformed newlines (literal "n" instead of actual newlines)
      if (aiResult.includes('nn') && !aiResult.includes('\n\n')) {
        logError('🤖 AI result has malformed newlines (literal "n" characters)');
        return false;
      }
      
      // Check if AI converted newlines to literal "n"
      if (aiResult.match(/[a-zA-Z]n[A-Z•]/)) {
        logError('🤖 AI result appears to have corrupted newlines');
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
      
      // Check for completely missing formatting when original had it
      const originalHasBold = originalText.includes('**');
      const resultHasBold = aiResult.includes('*');
      
      // Only fail if original had bold but result has NO asterisks at all
      if (originalHasBold && !resultHasBold) {
        logError('🤖 AI result lost all bold formatting');
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
      
      if (require('../config/env').debugMode) {
        logInfo('🤖 AI result passed validation');
      }
      return true;
    } catch (error) {
      logError('🤖 AI result validation error:', error);
      return false;
    }
  }

  /**
   * Fix malformed bold formatting that AI might produce
   * @param {string} text - Text to fix
   * @returns {string} Fixed text
   */
  static fixMalformedBoldFormatting(text) {
    if (!text) return text;
    
    try {
      // Fix escaped closing asterisks: \* -> *
      // But only when they appear to be closing bold formatting
      let fixed = text;
      
      // Pattern: find \* that should be closing bold (after text that starts with unescaped *)
      // This regex finds: *some text\* and replaces with *some text*
      fixed = fixed.replace(/\*([^*]*?)\\\*/g, '*$1*');
      
      // Also fix cases where AI puts punctuation outside bold instead of inside
      // Pattern: *text.* should stay as is, but *text*.  should become *text.*
      // This is more complex, so we'll just log it for now
      
      logInfo('🔧 Fixed bold formatting issues in AI result');
      return fixed;
    } catch (error) {
      logError('Error fixing bold formatting:', error);
      return text;
    }
  }

  /**
   * Static helper method to conditionally use AI, slice-based, or regular conversion
   * Can be called from anywhere in the codebase
   * @param {string} text - Text to convert
   * @param {Object} message - Discord message object (optional, for mention resolution)
   */
  static async convertDiscordToTelegramMarkdownV2(text, message = null) {
    const envConfig = require('../config/env');
    
    // Priority order: Enhanced Slice > AI > Regular
    if (envConfig.useSliceFormatConverter) {
      try {
        if (envConfig.debugMode) {
          logInfo('🔪✨ Using enhanced slice-based format conversion (with smart mentions/emojis)');
        }
        // Use enhanced slice-based format conversion
        const SliceFormatConverter = require('./sliceFormatConverter');
        return await SliceFormatConverter.convertDiscordToTelegramMarkdownV2(text, message);
      } catch (error) {
        logError('🔪✨ Enhanced slice-based format conversion failed, falling back to AI conversion:', error);
        // Fallback to AI conversion if slice-based fails
        if (envConfig.useAIFormatConverter) {
          try {
            return await AIFormatConverter.discordToTelegramMarkdownV2WithAI(text, message);
          } catch (aiError) {
            logError('AI format conversion also failed, falling back to regular conversion:', aiError);
            return FormatConverter.discordToTelegramMarkdownV2(text);
          }
        } else {
          return FormatConverter.discordToTelegramMarkdownV2(text);
        }
      }
    } else if (envConfig.useAIFormatConverter) {
      try {
        if (envConfig.debugMode) {
          logInfo('🤖 Using AI-powered format conversion');
        }
        // Use AI-powered format conversion with message object for mention resolution
        return await AIFormatConverter.discordToTelegramMarkdownV2WithAI(text, message);
      } catch (error) {
        logError('AI format conversion failed, falling back to regular conversion:', error);
        // Fallback to regular conversion if AI fails
        return FormatConverter.discordToTelegramMarkdownV2(text);
      }
    } else {
      if (envConfig.debugMode) {
        logInfo('⚙️ Using regular format conversion (slice and AI disabled)');
      }
      // Use regular format conversion
      return FormatConverter.discordToTelegramMarkdownV2(text);
    }
  }
}

module.exports = AIFormatConverter;