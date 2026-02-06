const { logInfo, logSuccess, logError } = require('./logger');
const aiManager = require('./aiManager');

/**
 * Translation Manager - Orchestrates translation workflow
 * Handles multi-language translation with caching and optimization
 */
class TranslationManager {
  constructor() {
    this.config = null;
    this.initialized = false;
    this.supportedLanguages = new Map();
  }

  /**
   * Initialize Translation Manager
   */
  async initialize() {
    try {
      this.config = require('../config/config');
      
      if (!this.config.ai?.enabled || !this.config.ai?.translation?.enabled) {
        logInfo('Translation features disabled in configuration');
        return false;
      }

      // Initialize AI Manager if not already done
      if (!aiManager.initialized) {
        await aiManager.initialize();
      }

      // Load supported languages from providers
      await this.loadSupportedLanguages();

      this.initialized = true;
      logSuccess('Translation Manager initialized successfully');
      return true;
    } catch (error) {
      logError('Failed to initialize Translation Manager:', error);
      return false;
    }
  }

  /**
   * Load supported languages from all available providers
   */
  async loadSupportedLanguages() {
    const providers = aiManager.getAvailableProviders();
    
    for (const providerName of providers) {
      try {
        const provider = aiManager.providers.get(providerName);
        if (provider.getSupportedLanguages) {
          const languages = await provider.getSupportedLanguages();
          this.supportedLanguages.set(providerName, languages);
          logInfo(`Loaded ${languages.length} supported languages for ${providerName}`);
        }
      } catch (error) {
        logError(`Failed to load languages for ${providerName}:`, error);
      }
    }
  }

  /**
   * Translate message content for multiple languages
   */
  async translateMessage(message, config) {
    if (!this.initialized) {
      throw new Error('Translation Manager not initialized');
    }

    if (!config.ai?.translation?.enabled || !config.ai.translation.targetLanguages) {
      return null;
    }

    const { targetLanguages, provider, preserveFormatting = true } = config.ai.translation;
    
    try {
      // Extract translatable content from message
      const content = this.extractTranslatableContent(message);
      if (!content) {
        logInfo('No translatable content found in message');
        return null;
      }

      // Detect source language
      const sourceLanguage = await this.detectLanguage(content);
      logInfo(`Detected source language: ${sourceLanguage}`);

      // Translate to each target language using config-specific settings
      // Add delays between requests to respect API rate limits
      const translations = new Map();
      
      for (let i = 0; i < targetLanguages.length; i++) {
        const targetLang = targetLanguages[i];
        
        // Skip translation if source and target are the same
        if (sourceLanguage === targetLang) {
          logInfo(`Skipping translation to ${targetLang} (same as source language)`);
          continue;
        }

        try {
          // Add delay between API requests (except for the first one)
          if (i > 0) {
            logInfo(`Waiting 2 seconds before next translation request to respect API limits...`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
          }
          
          const translation = await this.translateContent(
            content,
            targetLang,
            sourceLanguage,
            provider,
            preserveFormatting,
            config.ai // Pass the entire AI config for per-config provider selection
          );
          
          if (translation && translation.translatedText !== content) {
            translations.set(targetLang, translation);
            logSuccess(`Translation to ${targetLang} completed using ${translation.provider}`);
          }
        } catch (error) {
          logError(`Translation to ${targetLang} failed:`, error);
          // Continue with other languages
        }
      }

      if (translations.size === 0) {
        logInfo('No translations were generated');
        return null;
      }

      return {
        originalContent: content,
        sourceLanguage,
        translations: Object.fromEntries(translations),
        messageId: message.id,
        timestamp: Date.now(),
        configId: config.id,
        usedProvider: provider // Track which provider this config used
      };

    } catch (error) {
      logError('Translation process failed:', error);
      return null;
    }
  }

  /**
   * Extract translatable content from Discord message
   */
  extractTranslatableContent(message) {
    let content = '';

    // Extract text content
    if (message.content && message.content.trim()) {
      content = message.content;
    }

    // Extract embed descriptions and titles
    if (message.embeds && message.embeds.length > 0) {
      for (const embed of message.embeds) {
        if (embed.title) {
          content += `\n**${embed.title}**`;
        }
        if (embed.description) {
          content += `\n${embed.description}`;
        }
        if (embed.fields && embed.fields.length > 0) {
          for (const field of embed.fields) {
            if (field.name) content += `\n**${field.name}**`;
            if (field.value) content += `\n${field.value}`;
          }
        }
      }
    }

    // Clean up content
    content = content.trim();
    
    // Check if content is substantial enough for translation
    if (content.length < 3) {
      return null;
    }

    // Skip if content is mostly URLs or mentions
    const urlRegex = /https?:\/\/[^\s]+/g;
    const mentionRegex = /@\w+/g;
    const contentWithoutUrls = content.replace(urlRegex, '').replace(mentionRegex, '');
    
    if (contentWithoutUrls.trim().length < 10) {
      return null;
    }

    return content;
  }


  /**
   * Detect language of content
   */
  async detectLanguage(content) {
    try {
      return await aiManager.detectLanguage(content);
    } catch (error) {
      logError('Language detection failed:', error);
      return 'auto';
    }
  }

  /**
   * Translate content using specified provider
   */
  async translateContent(content, targetLanguage, sourceLanguage = 'auto', preferredProvider = null, preserveFormatting = true, configAI = null) {
    try {
      if (preserveFormatting) {
        // Use enhanced translation that preserves Discord formatting
        return await this.translateWithFormatting(content, targetLanguage, sourceLanguage, preferredProvider, configAI);
      } else {
        // Use basic translation
        return await aiManager.translateText(content, targetLanguage, sourceLanguage, preferredProvider, configAI);
      }
    } catch (error) {
      logError(`Translation failed for ${targetLanguage}:`, error);
      throw error;
    }
  }

  /**
   * Translate content while preserving Discord formatting
   */
  async translateWithFormatting(content, targetLanguage, sourceLanguage, preferredProvider, configAI = null) {
    // Use per-config provider if specified
    const selectedProvider = (configAI?.translation?.provider) || preferredProvider;
    
    // Try provider-specific formatting preservation first
    const provider = aiManager.selectProvider(selectedProvider, 'translation');
    
    if (provider && provider.translateWithFormatting) {
      try {
        return await provider.translateWithFormatting(content, targetLanguage, sourceLanguage);
      } catch (error) {
        logError('Provider-specific formatting translation failed:', error);
        // Fall back to general translation
      }
    }

    // Fall back to general translation with config-specific provider
    return await aiManager.translateText(content, targetLanguage, sourceLanguage, selectedProvider, configAI);
  }

  /**
   * Get language name from code
   */
  getLanguageName(langCode) {
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
      'ar': 'Arabic',
      'nl': 'Dutch',
      'pl': 'Polish',
      'tr': 'Turkish',
      'cs': 'Czech',
      'bg': 'Bulgarian',
      'da': 'Danish',
      'el': 'Greek',
      'et': 'Estonian',
      'fi': 'Finnish',
      'hu': 'Hungarian',
      'id': 'Indonesian',
      'lt': 'Lithuanian',
      'lv': 'Latvian',
      'nb': 'Norwegian',
      'ro': 'Romanian',
      'sk': 'Slovak',
      'sl': 'Slovenian',
      'sv': 'Swedish',
      'uk': 'Ukrainian'
    };

    return languageNames[langCode] || langCode.toUpperCase();
  }

  /**
   * Get emoji flag for language
   */
  getLanguageFlag(langCode) {
    const flags = {
      'en': '🇺🇸',
      'es': '🇪🇸',
      'fr': '🇫🇷',
      'de': '🇩🇪',
      'it': '🇮🇹',
      'pt': '🇵🇹',
      'ru': '🇷🇺',
      'ja': '🇯🇵',
      'ko': '🇰🇷',
      'zh': '🇨🇳',
      'ar': '🇸🇦',
      'nl': '🇳🇱',
      'pl': '🇵🇱',
      'tr': '🇹🇷',
      'cs': '🇨🇿',
      'bg': '🇧🇬',
      'da': '🇩🇰',
      'el': '🇬🇷',
      'et': '🇪🇪',
      'fi': '🇫🇮',
      'hu': '🇭🇺',
      'id': '🇮🇩',
      'lt': '🇱🇹',
      'lv': '🇱🇻',
      'nb': '🇳🇴',
      'ro': '🇷🇴',
      'sk': '🇸🇰',
      'sl': '🇸🇮',
      'sv': '🇸🇪',
      'uk': '🇺🇦'
    };

    return flags[langCode] || '🌐';
  }

  /**
   * Validate language codes
   */
  validateLanguageCodes(langCodes) {
    const validCodes = [];
    const invalidCodes = [];

    for (const code of langCodes) {
      if (this.isLanguageSupported(code)) {
        validCodes.push(code);
      } else {
        invalidCodes.push(code);
      }
    }

    return { validCodes, invalidCodes };
  }

  /**
   * Check if language is supported by any provider
   */
  isLanguageSupported(langCode) {
    for (const [providerName, languages] of this.supportedLanguages) {
      if (languages.some(lang => lang.code === langCode.toLowerCase())) {
        return true;
      }
    }

    // Fallback to common language codes
    const commonCodes = [
      'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar',
      'nl', 'pl', 'tr', 'cs', 'bg', 'da', 'el', 'et', 'fi', 'hu', 'id',
      'lt', 'lv', 'nb', 'ro', 'sk', 'sl', 'sv', 'uk'
    ];

    return commonCodes.includes(langCode.toLowerCase());
  }

  /**
   * Get supported languages for a specific provider
   */
  getSupportedLanguages(providerName = null) {
    if (providerName && this.supportedLanguages.has(providerName)) {
      return this.supportedLanguages.get(providerName);
    }

    // Return all unique languages from all providers
    const allLanguages = new Map();
    
    for (const languages of this.supportedLanguages.values()) {
      for (const lang of languages) {
        allLanguages.set(lang.code, lang);
      }
    }

    return Array.from(allLanguages.values());
  }

  /**
   * Get translation statistics
   */
  getStats() {
    return {
      initialized: this.initialized,
      supportedProviders: Array.from(this.supportedLanguages.keys()),
      totalSupportedLanguages: this.getSupportedLanguages().length,
      aiManagerStats: aiManager.getStats()
    };
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.supportedLanguages.clear();
    logInfo('Translation Manager cleanup completed');
  }
}

// Export singleton instance
module.exports = new TranslationManager();