const axios = require('axios');
const { logInfo, logSuccess, logError } = require('../logger');

/**
 * Google Gemini AI Provider for translation and content optimization
 * Uses Gemini Pro for high-quality translations with context understanding
 */
class GeminiProvider {
  constructor(config) {
    this.name = 'gemini';
    this.config = config;
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-2.0-flash-exp'; // Gemini 2.0 Flash Preview (free)
    this.baseURL = 'https://generativelanguage.googleapis.com/v1beta';
    this.rateLimit = {
      requests: 60, // 60 requests per minute for free tier
      window: 60 * 1000 // 1 minute
    };
  }

  /**
   * Check if provider is properly configured
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Get supported languages
   */
  async getSupportedLanguages() {
    // Gemini supports all major languages - return comprehensive list
    return [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' },
      { code: 'it', name: 'Italian' },
      { code: 'pt', name: 'Portuguese' },
      { code: 'ru', name: 'Russian' },
      { code: 'zh', name: 'Chinese' },
      { code: 'ja', name: 'Japanese' },
      { code: 'ko', name: 'Korean' },
      { code: 'ar', name: 'Arabic' },
      { code: 'hi', name: 'Hindi' },
      { code: 'th', name: 'Thai' },
      { code: 'vi', name: 'Vietnamese' },
      { code: 'tr', name: 'Turkish' },
      { code: 'pl', name: 'Polish' },
      { code: 'nl', name: 'Dutch' },
      { code: 'sv', name: 'Swedish' },
      { code: 'da', name: 'Danish' },
      { code: 'no', name: 'Norwegian' },
      { code: 'fi', name: 'Finnish' },
      { code: 'cs', name: 'Czech' },
      { code: 'hu', name: 'Hungarian' },
      { code: 'ro', name: 'Romanian' },
      { code: 'bg', name: 'Bulgarian' },
      { code: 'hr', name: 'Croatian' },
      { code: 'sk', name: 'Slovak' },
      { code: 'sl', name: 'Slovenian' },
      { code: 'et', name: 'Estonian' },
      { code: 'lv', name: 'Latvian' },
      { code: 'lt', name: 'Lithuanian' },
      { code: 'uk', name: 'Ukrainian' },
      { code: 'el', name: 'Greek' },
      { code: 'he', name: 'Hebrew' },
      { code: 'fa', name: 'Persian' },
      { code: 'ur', name: 'Urdu' },
      { code: 'bn', name: 'Bengali' },
      { code: 'ta', name: 'Tamil' },
      { code: 'te', name: 'Telugu' },
      { code: 'ml', name: 'Malayalam' },
      { code: 'kn', name: 'Kannada' },
      { code: 'gu', name: 'Gujarati' },
      { code: 'mr', name: 'Marathi' },
      { code: 'pa', name: 'Punjabi' },
      { code: 'ne', name: 'Nepali' },
      { code: 'si', name: 'Sinhala' },
      { code: 'my', name: 'Myanmar' },
      { code: 'km', name: 'Khmer' },
      { code: 'lo', name: 'Lao' },
      { code: 'ka', name: 'Georgian' },
      { code: 'am', name: 'Amharic' },
      { code: 'sw', name: 'Swahili' },
      { code: 'zu', name: 'Zulu' },
      { code: 'af', name: 'Afrikaans' },
      { code: 'sq', name: 'Albanian' },
      { code: 'az', name: 'Azerbaijani' },
      { code: 'eu', name: 'Basque' },
      { code: 'be', name: 'Belarusian' },
      { code: 'bs', name: 'Bosnian' },
      { code: 'ca', name: 'Catalan' },
      { code: 'cy', name: 'Welsh' },
      { code: 'eo', name: 'Esperanto' },
      { code: 'fo', name: 'Faroese' },
      { code: 'gl', name: 'Galician' },
      { code: 'is', name: 'Icelandic' },
      { code: 'ga', name: 'Irish' },
      { code: 'mk', name: 'Macedonian' },
      { code: 'mt', name: 'Maltese' },
      { code: 'mn', name: 'Mongolian' },
      { code: 'sr', name: 'Serbian' },
      { code: 'tl', name: 'Filipino' },
      { code: 'yi', name: 'Yiddish' }
    ];
  }

  /**
   * Detect language of content
   */
  async detectLanguage(content) {
    try {
      const prompt = `Detect the language of this text and respond with only the two-letter ISO language code (e.g., "en", "ru", "zh"):

Text: "${content}"

Language code:`;

      const response = await this.makeRequest(prompt);
      const detectedLang = response.trim().toLowerCase();
      
      // Validate the response is a proper language code
      if (detectedLang.length === 2 && /^[a-z]{2}$/.test(detectedLang)) {
        logInfo(`Gemini detected language: ${detectedLang}`);
        return detectedLang;
      }
      
      // Fallback to 'en' if detection fails
      logInfo('Gemini language detection failed, defaulting to English');
      return 'en';
    } catch (error) {
      logError('Gemini language detection error:', error);
      return 'en';
    }
  }

  /**
   * Translate text using Gemini
   */
  async translateText(content, targetLanguage, sourceLanguage = 'auto') {
    try {
      const targetLangName = this.getLanguageName(targetLanguage);
      const sourceLangName = sourceLanguage !== 'auto' ? this.getLanguageName(sourceLanguage) : 'detected language';

      const prompt = `Translate the following text from ${sourceLangName} to ${targetLangName}.

CRITICAL RULES - DO NOT TRANSLATE:
- ANY emoji codes like :smile:, :fire:, :heart: (keep them EXACTLY as they are)
- Custom Discord emojis like <:name:123456> (keep them EXACTLY as they are)
- Unicode emojis like 😀🎉🚀 (keep them EXACTLY as they are)
- @mentions like @username, @everyone, @here
- Links and URLs

PRESERVE all Discord formatting:
- **bold text**
- *italic text*
- ~~strikethrough~~
- \`inline code\`
- \`\`\`code blocks\`\`\`

NEVER translate emoji names or emoji codes. Leave ALL emojis unchanged.

Only respond with the translation, nothing else.

Text to translate: "${content}"

Translation:`;

      const translatedText = await this.makeRequest(prompt);
      
      // Calculate confidence based on text length and complexity
      const confidence = this.calculateConfidence(content, translatedText);

      return {
        translatedText: translatedText.trim(),
        confidence: confidence,
        provider: this.name,
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
        preservedFormatting: true
      };

    } catch (error) {
      logError(`Gemini translation error:`, error);
      throw new Error(`Gemini translation failed: ${error.message}`);
    }
  }

  /**
   * Translate with enhanced formatting preservation
   */
  async translateWithFormatting(content, targetLanguage, sourceLanguage = 'auto') {
    try {
      const targetLangName = this.getLanguageName(targetLanguage);
      
      const prompt = `You are a professional translator specializing in Discord message translation.

TASK: Translate from ${sourceLanguage !== 'auto' ? this.getLanguageName(sourceLanguage) : 'detected language'} to ${targetLangName}

🚫 CRITICAL RULES - NEVER TRANSLATE THESE:
1. Emoji shortcodes: :smile:, :fire:, :heart:, :thumbs_up: (keep EXACTLY as written)
2. Custom Discord emojis: <:name:123456>, <a:name:123456> (keep EXACTLY as written)
3. Unicode emojis: 😀🎉🚀❤️ (keep EXACTLY as written)
4. @mentions: @username, @everyone, @here (keep EXACTLY as written)
5. Links and URLs (keep EXACTLY as written)
6. Discord timestamps: <t:timestamp:format> (keep EXACTLY as written)

✅ PRESERVE all Discord formatting:
- **bold**, *italic*, ~~strikethrough~~, \`code\`, \`\`\`blocks\`\`\`
- Line breaks and spacing
- All punctuation and symbols

IMPORTANT: If you see ANY emoji code like :fire: or :smile:, do NOT translate it to another language. Keep it exactly as :fire: or :smile:.

TEXT TO TRANSLATE:
"${content}"

TRANSLATION (preserving ALL formatting and keeping ALL emojis unchanged):`;

      const translatedText = await this.makeRequest(prompt);
      
      return {
        translatedText: translatedText.trim(),
        confidence: 0.95, // High confidence for enhanced formatting
        provider: this.name,
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
        preservedFormatting: true,
        enhanced: true
      };

    } catch (error) {
      logError('Gemini enhanced translation error:', error);
      // Fallback to regular translation
      return await this.translateText(content, targetLanguage, sourceLanguage);
    }
  }

  /**
   * Optimize content for different platforms
   */
  async optimizeContent(content, options = {}) {
    try {
      const { level = 'enhanced', targetPlatform = 'discord', maxLength = null } = options;

      let prompt = `Optimize this content for ${targetPlatform} while preserving its meaning and Discord formatting.

Optimization level: ${level}
${maxLength ? `Maximum length: ${maxLength} characters` : ''}

Content: "${content}"

Optimized content:`;

      const optimizedText = await this.makeRequest(prompt);
      
      return {
        optimized: optimizedText.trim(),
        original: content,
        changes: ['AI optimization applied'],
        provider: this.name,
        optimizationLevel: level
      };

    } catch (error) {
      logError('Gemini content optimization error:', error);
      throw new Error(`Content optimization failed: ${error.message}`);
    }
  }

  /**
   * Make API request to Gemini
   */
  async makeRequest(prompt) {
    try {
      const url = `${this.baseURL}/models/${this.model}:generateContent?key=${this.apiKey}`;
      
      const requestBody = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.3, // Lower temperature for more consistent translations
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

      logInfo(`Making Gemini API request to ${this.model}`);
      
      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      if (response.data && response.data.candidates && response.data.candidates[0]) {
        const candidate = response.data.candidates[0];
        
        if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
          const text = candidate.content.parts[0].text;
          logSuccess('Gemini API request successful');
          return text;
        }
      }

      throw new Error('Invalid response format from Gemini API');

    } catch (error) {
      if (error.response) {
        logError(`Gemini API error ${error.response.status}:`, error.response.data);
        throw new Error(`Gemini API error: ${error.response.data.error?.message || error.response.statusText}`);
      } else if (error.request) {
        logError('Gemini API request failed:', error.message);
        throw new Error('Failed to connect to Gemini API');
      } else {
        logError('Gemini request setup error:', error.message);
        throw new Error(`Request setup error: ${error.message}`);
      }
    }
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
      'zh': 'Chinese',
      'ja': 'Japanese',
      'ko': 'Korean',
      'ar': 'Arabic',
      'hi': 'Hindi',
      'th': 'Thai',
      'vi': 'Vietnamese',
      'tr': 'Turkish',
      'pl': 'Polish',
      'nl': 'Dutch',
      'sv': 'Swedish',
      'da': 'Danish',
      'no': 'Norwegian',
      'fi': 'Finnish',
      'cs': 'Czech',
      'hu': 'Hungarian',
      'ro': 'Romanian',
      'bg': 'Bulgarian',
      'hr': 'Croatian',
      'sk': 'Slovak',
      'sl': 'Slovenian',
      'et': 'Estonian',
      'lv': 'Latvian',
      'lt': 'Lithuanian',
      'uk': 'Ukrainian',
      'el': 'Greek',
      'he': 'Hebrew',
      'fa': 'Persian',
      'ur': 'Urdu',
      'bn': 'Bengali'
    };

    return languageNames[langCode] || langCode.toUpperCase();
  }

  /**
   * Calculate translation confidence
   */
  calculateConfidence(original, translated) {
    // Simple confidence calculation based on length similarity and content
    const lengthRatio = Math.min(translated.length, original.length) / Math.max(translated.length, original.length);
    
    // Base confidence for Gemini (high quality AI)
    let confidence = 0.85;
    
    // Adjust based on length similarity
    confidence = confidence * (0.7 + 0.3 * lengthRatio);
    
    // Bonus for preserving formatting
    if (translated.includes('**') || translated.includes('*') || translated.includes('`')) {
      confidence += 0.05;
    }
    
    return Math.min(0.98, Math.max(0.7, confidence));
  }

  /**
   * Get rate limiting information
   */
  getRateLimit() {
    return this.rateLimit;
  }

  /**
   * Test the provider connection
   */
  async testConnection() {
    try {
      const testResult = await this.translateText('Hello world', 'es', 'en');
      return {
        success: true,
        message: 'Gemini provider connection successful',
        testTranslation: testResult.translatedText
      };
    } catch (error) {
      return {
        success: false,
        message: `Gemini provider test failed: ${error.message}`
      };
    }
  }
}

module.exports = GeminiProvider;