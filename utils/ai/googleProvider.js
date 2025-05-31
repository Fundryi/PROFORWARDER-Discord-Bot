const { logInfo, logSuccess, logError } = require('../logger');

/**
 * Google Translate Provider for translation and language detection
 * Uses Google Cloud Translation API for accurate translations
 */
class GoogleProvider {
  constructor(config) {
    this.config = config;
    this.apiKey = config.apiKey;
    this.projectId = config.projectId;
    this.baseURL = 'https://translation.googleapis.com/language/translate/v2';
  }

  /**
   * Translate text using Google Translate API
   */
  async translateText(text, targetLanguage, sourceLanguage = 'auto') {
    if (!this.apiKey) {
      throw new Error('Google Translate API key not configured');
    }

    try {
      // Prepare the request data
      const requestData = {
        q: text,
        target: targetLanguage,
        format: 'text',
        key: this.apiKey
      };

      // Add source language if specified
      if (sourceLanguage && sourceLanguage !== 'auto') {
        requestData.source = sourceLanguage;
      }

      const response = await this.makeRequest('', requestData);

      if (!response.data || !response.data.translations || response.data.translations.length === 0) {
        throw new Error('Invalid translation response');
      }

      const translation = response.data.translations[0];
      
      return {
        translatedText: translation.translatedText,
        sourceLanguage: translation.detectedSourceLanguage || sourceLanguage,
        targetLanguage,
        provider: 'google',
        confidence: 0.9 // Google Translate is generally reliable
      };

    } catch (error) {
      logError('Google Translate error:', error);
      throw new Error(`Google Translate failed: ${error.message}`);
    }
  }

  /**
   * Detect language using Google Translate API
   */
  async detectLanguage(text) {
    if (!this.apiKey) {
      throw new Error('Google Translate API key not configured');
    }

    try {
      const requestData = {
        q: text,
        key: this.apiKey
      };

      const response = await this.makeRequest('/detect', requestData);

      if (!response.data || !response.data.detections || response.data.detections.length === 0) {
        throw new Error('Invalid language detection response');
      }

      const detection = response.data.detections[0][0];
      
      if (detection.confidence > 0.5) {
        return detection.language;
      }

      return 'auto';

    } catch (error) {
      logError('Google language detection error:', error);
      return 'auto';
    }
  }

  /**
   * Get supported languages
   */
  async getSupportedLanguages() {
    if (!this.apiKey) {
      throw new Error('Google Translate API key not configured');
    }

    try {
      const requestData = {
        key: this.apiKey,
        target: 'en' // Get language names in English
      };

      const response = await this.makeRequest('/languages', requestData);

      if (!response.data || !response.data.languages) {
        throw new Error('Invalid languages response');
      }

      return response.data.languages.map(lang => ({
        code: lang.language,
        name: lang.name
      }));

    } catch (error) {
      logError('Google supported languages error:', error);
      return [];
    }
  }

  /**
   * Batch translate multiple texts
   */
  async translateBatch(texts, targetLanguage, sourceLanguage = 'auto') {
    if (!this.apiKey) {
      throw new Error('Google Translate API key not configured');
    }

    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    try {
      const requestData = {
        q: texts,
        target: targetLanguage,
        format: 'text',
        key: this.apiKey
      };

      if (sourceLanguage && sourceLanguage !== 'auto') {
        requestData.source = sourceLanguage;
      }

      const response = await this.makeRequest('', requestData);

      if (!response.data || !response.data.translations) {
        throw new Error('Invalid batch translation response');
      }

      return response.data.translations.map((translation, index) => ({
        originalText: texts[index],
        translatedText: translation.translatedText,
        sourceLanguage: translation.detectedSourceLanguage || sourceLanguage,
        targetLanguage,
        provider: 'google'
      }));

    } catch (error) {
      logError('Google batch translation error:', error);
      throw new Error(`Google batch translation failed: ${error.message}`);
    }
  }

  /**
   * Pre-process text to preserve Discord formatting
   */
  preprocessText(text) {
    // Create mapping for Discord-specific elements
    const preserveMap = new Map();
    let counter = 0;

    // Preserve mentions
    text = text.replace(/@(everyone|here|&\d+|!\d+|\d+)/g, (match) => {
      const placeholder = `__MENTION_${counter++}__`;
      preserveMap.set(placeholder, match);
      return placeholder;
    });

    // Preserve custom emojis
    text = text.replace(/<a?:\w+:\d+>/g, (match) => {
      const placeholder = `__EMOJI_${counter++}__`;
      preserveMap.set(placeholder, match);
      return placeholder;
    });

    // Preserve Discord formatting
    const formatPatterns = [
      /\*\*([^*]+)\*\*/g, // Bold
      /\*([^*]+)\*/g,     // Italic
      /~~([^~]+)~~/g,     // Strikethrough
      /`([^`]+)`/g,       // Inline code
      /```([^`]+)```/g    // Code blocks
    ];

    formatPatterns.forEach(pattern => {
      text = text.replace(pattern, (match) => {
        const placeholder = `__FORMAT_${counter++}__`;
        preserveMap.set(placeholder, match);
        return placeholder;
      });
    });

    return { text, preserveMap };
  }

  /**
   * Post-process text to restore Discord formatting
   */
  postprocessText(text, preserveMap) {
    // Restore all preserved elements
    for (const [placeholder, original] of preserveMap) {
      text = text.replace(new RegExp(placeholder, 'g'), original);
    }

    return text;
  }

  /**
   * Enhanced translate with Discord formatting preservation
   */
  async translateWithFormatting(text, targetLanguage, sourceLanguage = 'auto') {
    // Pre-process to preserve Discord elements
    const { text: processedText, preserveMap } = this.preprocessText(text);

    // Translate the processed text
    const result = await this.translateText(processedText, targetLanguage, sourceLanguage);

    // Post-process to restore Discord elements
    result.translatedText = this.postprocessText(result.translatedText, preserveMap);

    return result;
  }

  /**
   * Make HTTP request to Google Translate API
   */
  async makeRequest(endpoint, data) {
    const axios = require('axios');
    
    const url = `${this.baseURL}${endpoint}`;
    
    try {
      const response = await axios.post(url, data, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      return response.data;
    } catch (error) {
      if (error.response) {
        const errorMsg = error.response.data?.error?.message || error.response.statusText;
        throw new Error(`Google API error: ${error.response.status} ${errorMsg}`);
      } else if (error.request) {
        throw new Error('Google API request failed: No response received');
      } else {
        throw new Error(`Google API request error: ${error.message}`);
      }
    }
  }

  /**
   * Test connection to Google Translate API
   */
  async testConnection() {
    try {
      await this.getSupportedLanguages();
      return true;
    } catch (error) {
      logError('Google Translate connection test failed:', error);
      return false;
    }
  }

  /**
   * Get translation statistics
   */
  async getUsageStats() {
    // Google Translate doesn't provide usage stats via API
    // This would require Google Cloud Console integration
    return {
      provider: 'google',
      note: 'Usage stats available in Google Cloud Console'
    };
  }

  /**
   * Validate language code
   */
  isValidLanguageCode(code) {
    // Common language codes supported by Google Translate
    const commonCodes = [
      'af', 'sq', 'am', 'ar', 'hy', 'az', 'eu', 'be', 'bn', 'bs', 'bg', 'ca',
      'ceb', 'ny', 'zh', 'co', 'hr', 'cs', 'da', 'nl', 'en', 'eo', 'et', 'tl',
      'fi', 'fr', 'fy', 'gl', 'ka', 'de', 'el', 'gu', 'ht', 'ha', 'haw', 'iw',
      'hi', 'hmn', 'hu', 'is', 'ig', 'id', 'ga', 'it', 'ja', 'jw', 'kn', 'kk',
      'km', 'ko', 'ku', 'ky', 'lo', 'la', 'lv', 'lt', 'lb', 'mk', 'mg', 'ms',
      'ml', 'mt', 'mi', 'mr', 'mn', 'my', 'ne', 'no', 'ps', 'fa', 'pl', 'pt',
      'ro', 'ru', 'sm', 'gd', 'sr', 'st', 'sn', 'sd', 'si', 'sk', 'sl', 'so',
      'es', 'su', 'sw', 'sv', 'tg', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'uz',
      'vi', 'cy', 'xh', 'yi', 'yo', 'zu'
    ];

    return commonCodes.includes(code.toLowerCase());
  }
}

module.exports = GoogleProvider;