const { logInfo, logSuccess, logError } = require('../logger');

/**
 * OpenAI Provider for translation and content optimization
 * Supports GPT models for high-quality translation and content enhancement
 */
class OpenAIProvider {
  constructor(config) {
    this.config = config;
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4';
    this.maxTokens = config.maxTokens || 2000;
    this.temperature = config.temperature || 0.3;
    this.baseURL = 'https://api.openai.com/v1';
  }

  /**
   * Translate text using OpenAI GPT
   */
  async translateText(text, targetLanguage, sourceLanguage = 'auto') {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const prompt = this.buildTranslationPrompt(text, targetLanguage, sourceLanguage);
      
      const response = await this.makeRequest('/chat/completions', {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a professional translator. Translate the given text accurately while preserving formatting, mentions, emojis, and links. Return only the translated text without explanations.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature
      });

      const translatedText = response.choices[0]?.message?.content?.trim();
      
      if (!translatedText) {
        throw new Error('Empty translation response');
      }

      return {
        translatedText,
        sourceLanguage: sourceLanguage === 'auto' ? 'detected' : sourceLanguage,
        targetLanguage,
        provider: 'openai',
        confidence: 0.95 // OpenAI generally provides high-quality translations
      };

    } catch (error) {
      logError('OpenAI translation error:', error);
      throw new Error(`OpenAI translation failed: ${error.message}`);
    }
  }

  /**
   * Optimize content using OpenAI
   */
  async optimizeContent(content, options = {}) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const {
      level = 'enhanced',
      platformSpecific = false,
      targetPlatform = 'discord',
      preserveFormatting = true,
      maxLength = null
    } = options;

    try {
      const prompt = this.buildOptimizationPrompt(content, options);
      
      const response = await this.makeRequest('/chat/completions', {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: this.getOptimizationSystemPrompt(options)
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature
      });

      const optimizedContent = response.choices[0]?.message?.content?.trim();
      
      if (!optimizedContent) {
        throw new Error('Empty optimization response');
      }

      // Analyze changes made
      const changes = this.analyzeChanges(content, optimizedContent);

      return {
        optimized: optimizedContent,
        original: content,
        changes,
        provider: 'openai',
        optimizationLevel: level
      };

    } catch (error) {
      logError('OpenAI content optimization error:', error);
      throw new Error(`OpenAI content optimization failed: ${error.message}`);
    }
  }

  /**
   * Detect language (basic implementation using OpenAI)
   */
  async detectLanguage(text) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await this.makeRequest('/chat/completions', {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'Detect the language of the given text. Respond with only the ISO 639-1 language code (e.g., "en", "es", "fr", "de").'
          },
          {
            role: 'user',
            content: `Detect language: "${text}"`
          }
        ],
        max_tokens: 10,
        temperature: 0
      });

      const languageCode = response.choices[0]?.message?.content?.trim().toLowerCase();
      
      // Validate language code
      if (languageCode && /^[a-z]{2}$/.test(languageCode)) {
        return languageCode;
      }

      return 'auto';

    } catch (error) {
      logError('OpenAI language detection error:', error);
      return 'auto';
    }
  }

  /**
   * Build translation prompt
   */
  buildTranslationPrompt(text, targetLanguage, sourceLanguage) {
    const languageNames = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'ja': 'Japanese',
      'ko': 'Korean',
      'zh': 'Chinese',
      'ar': 'Arabic'
    };

    const targetLangName = languageNames[targetLanguage] || targetLanguage;
    const sourceLangName = sourceLanguage === 'auto' ? 'detected source language' : (languageNames[sourceLanguage] || sourceLanguage);

    return `Translate the following text from ${sourceLangName} to ${targetLangName}.

IMPORTANT RULES:
- Preserve all Discord formatting (**, __, ~~, \`\`\`, etc.)
- Keep all mentions (@username, @everyone, @here) exactly as they are
- Preserve all emojis and custom Discord emojis (:emoji_name:)
- Keep all links and URLs intact
- Maintain line breaks and paragraph structure
- If the text is already in ${targetLangName}, return it unchanged
- Return ONLY the translated text, no explanations

Text to translate:
${text}`;
  }

  /**
   * Build content optimization prompt
   */
  buildOptimizationPrompt(content, options) {
    const { level, targetPlatform, maxLength } = options;

    let prompt = `Optimize the following content for ${targetPlatform} platform.\n\n`;

    if (level === 'basic') {
      prompt += 'OPTIMIZATION LEVEL: Basic - Fix only grammar, spelling, and basic formatting.\n';
    } else if (level === 'enhanced') {
      prompt += 'OPTIMIZATION LEVEL: Enhanced - Improve clarity, readability, and engagement while preserving meaning.\n';
    }

    if (maxLength) {
      prompt += `- Keep content under ${maxLength} characters\n`;
    }

    prompt += `
RULES:
- Preserve the core message and meaning
- Keep all mentions, emojis, and links intact
- Maintain appropriate ${targetPlatform} formatting
- Improve readability and clarity
- Fix any grammar or spelling issues
- Make the content more engaging if possible

Content to optimize:
${content}`;

    return prompt;
  }

  /**
   * Get system prompt for content optimization
   */
  getOptimizationSystemPrompt(options) {
    const { targetPlatform, preserveFormatting } = options;

    let systemPrompt = `You are an expert content optimizer specializing in ${targetPlatform} content.`;

    if (preserveFormatting) {
      systemPrompt += ' Always preserve original formatting, mentions, emojis, and links.';
    }

    if (targetPlatform === 'discord') {
      systemPrompt += ' Understand Discord markdown: **bold**, *italic*, ~~strikethrough~~, `code`, ```code blocks```, mentions (@user), and custom emojis (:name:).';
    } else if (targetPlatform === 'telegram') {
      systemPrompt += ' Optimize for Telegram: use *bold*, _italic_, `code`, ```code blocks```, and convert Discord formatting appropriately.';
    }

    systemPrompt += ' Return only the optimized content without explanations or metadata.';

    return systemPrompt;
  }

  /**
   * Analyze changes between original and optimized content
   */
  analyzeChanges(original, optimized) {
    const changes = [];

    if (original.length !== optimized.length) {
      changes.push(optimized.length > original.length ? 'expanded' : 'condensed');
    }

    // Simple change detection
    if (original !== optimized) {
      changes.push('content_modified');
    }

    // Check for formatting changes
    const originalFormatting = this.extractFormatting(original);
    const optimizedFormatting = this.extractFormatting(optimized);
    
    if (JSON.stringify(originalFormatting) !== JSON.stringify(optimizedFormatting)) {
      changes.push('formatting_modified');
    }

    return changes;
  }

  /**
   * Extract formatting elements from text
   */
  extractFormatting(text) {
    return {
      bold: (text.match(/\*\*.*?\*\*/g) || []).length,
      italic: (text.match(/\*.*?\*/g) || []).length,
      code: (text.match(/`.*?`/g) || []).length,
      strikethrough: (text.match(/~~.*?~~/g) || []).length,
      mentions: (text.match(/@\w+/g) || []).length,
      emojis: (text.match(/:\w+:/g) || []).length
    };
  }

  /**
   * Make HTTP request to OpenAI API
   */
  async makeRequest(endpoint, data) {
    const axios = require('axios');
    
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };

    try {
      const response = await axios.post(url, data, { headers });
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`OpenAI API error: ${error.response.status} ${error.response.data?.error?.message || error.response.statusText}`);
      } else if (error.request) {
        throw new Error('OpenAI API request failed: No response received');
      } else {
        throw new Error(`OpenAI API request error: ${error.message}`);
      }
    }
  }

  /**
   * Test connection to OpenAI API
   */
  async testConnection() {
    try {
      await this.makeRequest('/models', { method: 'GET' });
      return true;
    } catch (error) {
      logError('OpenAI connection test failed:', error);
      return false;
    }
  }
}

module.exports = OpenAIProvider;