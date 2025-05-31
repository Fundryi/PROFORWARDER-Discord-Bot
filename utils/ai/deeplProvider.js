const { logInfo, logSuccess, logError } = require('../logger');

/**
 * DeepL Provider for high-quality translation
 * Uses DeepL API for professional-grade translations
 */
class DeepLProvider {
  constructor(config) {
    this.config = config;
    this.apiKey = config.apiKey;
    this.freeApi = config.freeApi || false;
    this.baseURL = this.freeApi 
      ? 'https://api-free.deepl.com/v2'
      : 'https://api.deepl.com/v2';
  }

  /**
   * Translate text using DeepL API
   */
  async translateText(text, targetLanguage, sourceLanguage = 'auto') {
    if (!this.apiKey) {
      throw new Error('DeepL API key not configured');
    }

    try {
      // Map language codes to DeepL format
      const deeplTargetLang = this.mapToDeepLLanguage(targetLanguage);
      const deeplSourceLang = sourceLanguage === 'auto' ? null : this.mapToDeepLLanguage(sourceLanguage);

      if (!deeplTargetLang) {
        throw new Error(`Unsupported target language: ${targetLanguage}`);
      }

      const requestData = {
        text: [text],
        target_lang: deeplTargetLang,
        preserve_formatting: true,
        tag_handling: 'xml' // Better handling of formatting
      };

      if (deeplSourceLang) {
        requestData.source_lang = deeplSourceLang;
      }

      const response = await this.makeRequest('/translate', requestData);

      if (!response.translations || response.translations.length === 0) {
        throw new Error('Invalid translation response from DeepL');
      }

      const translation = response.translations[0];
      
      return {
        translatedText: translation.text,
        sourceLanguage: translation.detected_source_language?.toLowerCase() || sourceLanguage,
        targetLanguage,
        provider: 'deepl',
        confidence: 0.95 // DeepL provides high-quality translations
      };

    } catch (error) {
      logError('DeepL translation error:', error);
      throw new Error(`DeepL translation failed: ${error.message}`);
    }
  }

  /**
   * Translate with advanced formatting preservation
   */
  async translateWithFormatting(text, targetLanguage, sourceLanguage = 'auto') {
    // Pre-process text to protect Discord-specific elements
    const { processedText, protectedElements } = this.protectDiscordElements(text);
    
    try {
      const result = await this.translateText(processedText, targetLanguage, sourceLanguage);
      
      // Restore protected elements
      result.translatedText = this.restoreDiscordElements(result.translatedText, protectedElements);
      
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Protect Discord-specific elements from translation
   */
  protectDiscordElements(text) {
    const protectedElements = new Map();
    let counter = 0;
    
    // Protect mentions with XML tags that DeepL will preserve
    text = text.replace(/@(everyone|here|&\d+|!\d+|\d+)/g, (match) => {
      const id = `mention_${counter++}`;
      const xmlTag = `<mention id="${id}">${match}</mention>`;
      protectedElements.set(id, match);
      return xmlTag;
    });

    // Protect custom emojis
    text = text.replace(/<a?:\w+:\d+>/g, (match) => {
      const id = `emoji_${counter++}`;
      const xmlTag = `<emoji id="${id}">${match}</emoji>`;
      protectedElements.set(id, match);
      return xmlTag;
    });

    // Protect Discord formatting
    text = text.replace(/\*\*([^*]+)\*\*/g, (match, content) => {
      const id = `bold_${counter++}`;
      const xmlTag = `<bold id="${id}">${content}</bold>`;
      protectedElements.set(id, match);
      return xmlTag;
    });

    text = text.replace(/~~([^~]+)~~/g, (match, content) => {
      const id = `strike_${counter++}`;
      const xmlTag = `<strike id="${id}">${content}</strike>`;
      protectedElements.set(id, match);
      return xmlTag;
    });

    text = text.replace(/`([^`]+)`/g, (match, content) => {
      const id = `code_${counter++}`;
      const xmlTag = `<code id="${id}">${content}</code>`;
      protectedElements.set(id, match);
      return xmlTag;
    });

    text = text.replace(/```([^`]+)```/g, (match, content) => {
      const id = `codeblock_${counter++}`;
      const xmlTag = `<codeblock id="${id}">${content}</codeblock>`;
      protectedElements.set(id, match);
      return xmlTag;
    });

    return { processedText: text, protectedElements };
  }

  /**
   * Restore Discord elements after translation
   */
  restoreDiscordElements(text, protectedElements) {
    // Restore mentions
    text = text.replace(/<mention id="(mention_\d+)">.*?<\/mention>/g, (match, id) => {
      return protectedElements.get(id) || match;
    });

    // Restore emojis
    text = text.replace(/<emoji id="(emoji_\d+)">.*?<\/emoji>/g, (match, id) => {
      return protectedElements.get(id) || match;
    });

    // Restore formatting
    text = text.replace(/<bold id="(bold_\d+)">.*?<\/bold>/g, (match, id) => {
      return protectedElements.get(id) || match;
    });

    text = text.replace(/<strike id="(strike_\d+)">.*?<\/strike>/g, (match, id) => {
      return protectedElements.get(id) || match;
    });

    text = text.replace(/<code id="(code_\d+)">.*?<\/code>/g, (match, id) => {
      return protectedElements.get(id) || match;
    });

    text = text.replace(/<codeblock id="(codeblock_\d+)">.*?<\/codeblock>/g, (match, id) => {
      return protectedElements.get(id) || match;
    });

    return text;
  }

  /**
   * Get supported languages
   */
  async getSupportedLanguages() {
    if (!this.apiKey) {
      throw new Error('DeepL API key not configured');
    }

    try {
      const response = await this.makeRequest('/languages', { type: 'target' });
      
      return response.map(lang => ({
        code: lang.language.toLowerCase(),
        name: lang.name
      }));
    } catch (error) {
      logError('DeepL supported languages error:', error);
      return this.getDefaultSupportedLanguages();
    }
  }

  /**
   * Get default supported languages (fallback)
   */
  getDefaultSupportedLanguages() {
    return [
      { code: 'bg', name: 'Bulgarian' },
      { code: 'cs', name: 'Czech' },
      { code: 'da', name: 'Danish' },
      { code: 'de', name: 'German' },
      { code: 'el', name: 'Greek' },
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'et', name: 'Estonian' },
      { code: 'fi', name: 'Finnish' },
      { code: 'fr', name: 'French' },
      { code: 'hu', name: 'Hungarian' },
      { code: 'id', name: 'Indonesian' },
      { code: 'it', name: 'Italian' },
      { code: 'ja', name: 'Japanese' },
      { code: 'ko', name: 'Korean' },
      { code: 'lt', name: 'Lithuanian' },
      { code: 'lv', name: 'Latvian' },
      { code: 'nb', name: 'Norwegian' },
      { code: 'nl', name: 'Dutch' },
      { code: 'pl', name: 'Polish' },
      { code: 'pt', name: 'Portuguese' },
      { code: 'ro', name: 'Romanian' },
      { code: 'ru', name: 'Russian' },
      { code: 'sk', name: 'Slovak' },
      { code: 'sl', name: 'Slovenian' },
      { code: 'sv', name: 'Swedish' },
      { code: 'tr', name: 'Turkish' },
      { code: 'uk', name: 'Ukrainian' },
      { code: 'zh', name: 'Chinese' }
    ];
  }

  /**
   * Map common language codes to DeepL format
   */
  mapToDeepLLanguage(langCode) {
    const mapping = {
      'en': 'EN',
      'de': 'DE',
      'fr': 'FR', 
      'es': 'ES',
      'it': 'IT',
      'pt': 'PT',
      'ru': 'RU',
      'ja': 'JA',
      'ko': 'KO',
      'zh': 'ZH',
      'nl': 'NL',
      'pl': 'PL',
      'tr': 'TR',
      'cs': 'CS',
      'bg': 'BG',
      'da': 'DA',
      'el': 'EL',
      'et': 'ET',
      'fi': 'FI',
      'hu': 'HU',
      'id': 'ID',
      'lt': 'LT',
      'lv': 'LV',
      'nb': 'NB',
      'ro': 'RO',
      'sk': 'SK',
      'sl': 'SL',
      'sv': 'SV',
      'uk': 'UK'
    };

    return mapping[langCode.toLowerCase()];
  }

  /**
   * Get usage statistics
   */
  async getUsage() {
    if (!this.apiKey) {
      throw new Error('DeepL API key not configured');
    }

    try {
      const response = await this.makeRequest('/usage');
      
      return {
        characterCount: response.character_count,
        characterLimit: response.character_limit,
        usagePercentage: (response.character_count / response.character_limit * 100).toFixed(2)
      };
    } catch (error) {
      logError('DeepL usage check error:', error);
      return null;
    }
  }

  /**
   * Check if language is supported by DeepL
   */
  isLanguageSupported(langCode) {
    const supportedLanguages = [
      'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hu', 'id',
      'it', 'ja', 'ko', 'lt', 'lv', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk',
      'sl', 'sv', 'tr', 'uk', 'zh'
    ];
    
    return supportedLanguages.includes(langCode.toLowerCase());
  }

  /**
   * Make HTTP request to DeepL API
   */
  async makeRequest(endpoint, data = null) {
    const axios = require('axios');
    
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
      'Content-Type': 'application/json'
    };

    try {
      let response;
      if (data) {
        response = await axios.post(url, data, { headers });
      } else {
        response = await axios.get(url, { headers });
      }
      
      return response.data;
    } catch (error) {
      if (error.response) {
        let errorMsg = error.response.statusText;
        if (error.response.data && error.response.data.message) {
          errorMsg = error.response.data.message;
        }
        throw new Error(`DeepL API error: ${error.response.status} ${errorMsg}`);
      } else if (error.request) {
        throw new Error('DeepL API request failed: No response received');
      } else {
        throw new Error(`DeepL API request error: ${error.message}`);
      }
    }
  }

  /**
   * Test connection to DeepL API
   */
  async testConnection() {
    try {
      await this.getUsage();
      return true;
    } catch (error) {
      logError('DeepL connection test failed:', error);
      return false;
    }
  }

  /**
   * Batch translate multiple texts
   */
  async translateBatch(texts, targetLanguage, sourceLanguage = 'auto') {
    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    // DeepL supports batch translation
    try {
      const deeplTargetLang = this.mapToDeepLLanguage(targetLanguage);
      const deeplSourceLang = sourceLanguage === 'auto' ? null : this.mapToDeepLLanguage(sourceLanguage);

      const requestData = {
        text: texts,
        target_lang: deeplTargetLang,
        preserve_formatting: true,
        tag_handling: 'xml'
      };

      if (deeplSourceLang) {
        requestData.source_lang = deeplSourceLang;
      }

      const response = await this.makeRequest('/translate', requestData);

      return response.translations.map((translation, index) => ({
        originalText: texts[index],
        translatedText: translation.text,
        sourceLanguage: translation.detected_source_language?.toLowerCase() || sourceLanguage,
        targetLanguage,
        provider: 'deepl'
      }));

    } catch (error) {
      logError('DeepL batch translation error:', error);
      throw new Error(`DeepL batch translation failed: ${error.message}`);
    }
  }
}

module.exports = DeepLProvider;