const { logInfo, logSuccess, logError } = require('./logger');

/**
 * AI Manager - Core AI integration and provider abstraction
 * Supports multiple AI providers with fallback and caching
 */
class AIManager {
  constructor() {
    this.config = null;
    this.providers = new Map();
    this.cache = new Map();
    this.rateLimits = new Map();
    this.initialized = false;
  }

  /**
   * Initialize AI Manager with configuration
   */
  async initialize() {
    try {
      this.config = require('../config/config');
      
      if (!this.config.ai?.enabled) {
        logInfo('AI features disabled in configuration');
        return false;
      }

      // Initialize available providers
      await this.initializeProviders();
      
      this.initialized = true;
      logSuccess('AI Manager initialized successfully');
      return true;
    } catch (error) {
      logError('Failed to initialize AI Manager:', error);
      return false;
    }
  }

  /**
   * Initialize AI providers based on configuration
   */
  async initializeProviders() {
    const { providers } = this.config.ai;

    // Initialize Gemini provider (main provider)
    if (providers.gemini?.apiKey) {
      try {
        const GeminiProvider = require('./ai/geminiProvider');
        this.providers.set('gemini', new GeminiProvider(providers.gemini));
        logInfo('Gemini 2.0 Flash provider initialized');
      } catch (error) {
        logError('Failed to initialize Gemini provider:', error);
      }
    }

    // Initialize Google Translate provider (fallback)
    if (providers.google?.apiKey && providers.google.apiKey !== 'your_google_translate_api_key_here') {
      try {
        const GoogleProvider = require('./ai/googleProvider');
        this.providers.set('google', new GoogleProvider(providers.google));
        logInfo('Google Translate provider initialized');
      } catch (error) {
        logError('Failed to initialize Google provider:', error);
      }
    } else {
      logInfo('Google Translate provider not configured (fallback unavailable)');
    }

    if (this.providers.size === 0) {
      throw new Error('No AI providers configured');
    }

    logSuccess(`Initialized ${this.providers.size} AI provider(s)`);
  }

  /**
   * Get available providers
   */
  getAvailableProviders() {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a specific provider is available
   */
  isProviderAvailable(providerName) {
    return this.providers.has(providerName);
  }

  /**
   * Translate text using specified provider with fallback
   */
  async translateText(text, targetLanguage, sourceLanguage = 'auto', providerName = null, configAI = null) {
    if (!this.initialized) {
      throw new Error('AI Manager not initialized');
    }

    // Generate cache key
    const cacheKey = `translate:${sourceLanguage}:${targetLanguage}:${this.hashText(text)}`;
    
    // Check cache first
    if (this.config.ai.translation.cacheTranslations) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        logInfo('Translation served from cache');
        return cached;
      }
    }

    // Use per-config provider if specified, otherwise use global default
    const selectedProvider = (configAI?.translation?.provider) || providerName || this.config.ai.translation.defaultProvider;
    
    // Determine provider to use
    const provider = this.selectProvider(selectedProvider, 'translation');
    if (!provider) {
      throw new Error(`No translation provider available: ${selectedProvider}`);
    }

    try {
      // Check rate limits
      await this.checkRateLimit(provider.name);

      // Perform translation
      logInfo(`Translating text using ${provider.name} provider (config-specific: ${!!configAI?.translation?.provider})`);
      const result = await provider.translateText(text, targetLanguage, sourceLanguage);

      // Cache the result
      if (this.config.ai.translation.cacheTranslations) {
        this.setCache(cacheKey, result);
      }

      // Update rate limit tracking
      this.updateRateLimit(provider.name);

      logSuccess(`Translation completed using ${provider.name}`);
      return result;

    } catch (error) {
      logError(`Translation failed with ${provider.name}:`, error);

      // Try fallback provider if available
      const fallbackProvider = this.getFallbackProvider(provider.name, 'translation');
      if (fallbackProvider) {
        logInfo(`Attempting translation with fallback provider: ${fallbackProvider.name}`);
        try {
          const result = await fallbackProvider.translateText(text, targetLanguage, sourceLanguage);
          
          if (this.config.ai.translation.cacheTranslations) {
            this.setCache(cacheKey, result);
          }
          
          this.updateRateLimit(fallbackProvider.name);
          logSuccess(`Translation completed using fallback provider ${fallbackProvider.name}`);
          return result;
        } catch (fallbackError) {
          logError(`Fallback translation also failed:`, fallbackError);
        }
      }

      throw new Error(`Translation failed: ${error.message}`);
    }
  }

  /**
   * Optimize content using AI
   */
  async optimizeContent(content, optimizationOptions = {}) {
    if (!this.initialized) {
      throw new Error('AI Manager not initialized');
    }

    const {
      level = 'enhanced',
      platformSpecific = false,
      targetPlatform = 'discord',
      preserveFormatting = true,
      maxLength = null
    } = optimizationOptions;

    // Generate cache key
    const cacheKey = `optimize:${level}:${targetPlatform}:${this.hashText(content)}`;
    
    // Check cache
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      logInfo('Content optimization served from cache');
      return cached;
    }

    // Select provider for content optimization (prefer OpenAI for this)
    const provider = this.selectProvider('openai', 'optimization') || 
                    this.selectProvider(null, 'optimization');
    
    if (!provider || !provider.optimizeContent) {
      logInfo('No content optimization provider available, returning original content');
      return { optimized: content, changes: [] };
    }

    try {
      await this.checkRateLimit(provider.name);

      logInfo(`Optimizing content using ${provider.name} provider`);
      const result = await provider.optimizeContent(content, {
        level,
        platformSpecific,
        targetPlatform,
        preserveFormatting,
        maxLength
      });

      // Cache the result
      this.setCache(cacheKey, result);
      this.updateRateLimit(provider.name);

      logSuccess(`Content optimization completed using ${provider.name}`);
      return result;

    } catch (error) {
      logError(`Content optimization failed:`, error);
      // Return original content if optimization fails
      return { optimized: content, changes: ['optimization_failed'] };
    }
  }

  /**
   * Detect language of text
   */
  async detectLanguage(text) {
    if (!this.initialized) {
      throw new Error('AI Manager not initialized');
    }

    // Try to use a provider that supports language detection
    const provider = this.selectProvider('gemini', 'detection') ||
                    this.selectProvider('google', 'detection') ||
                    this.selectProvider(null, 'detection');

    if (!provider || !provider.detectLanguage) {
      logInfo('No language detection provider available');
      return 'auto';
    }

    try {
      await this.checkRateLimit(provider.name);
      const language = await provider.detectLanguage(text);
      this.updateRateLimit(provider.name);
      
      logInfo(`Detected language: ${language}`);
      return language;
    } catch (error) {
      logError('Language detection failed:', error);
      return 'auto';
    }
  }

  /**
   * Select appropriate provider for operation
   */
  selectProvider(preferredProvider, operation) {
    // If specific provider requested and available, use it
    if (preferredProvider && this.providers.has(preferredProvider)) {
      return this.providers.get(preferredProvider);
    }

    // Otherwise, select based on operation type and availability
    const providerPreferences = {
      translation: ['gemini', 'google'], // Gemini first, Google Translate fallback
      optimization: ['gemini'], // Only Gemini for optimization
      detection: ['gemini', 'google'] // Gemini first, Google fallback for detection
    };

    const preferences = providerPreferences[operation] || Array.from(this.providers.keys());
    
    for (const providerName of preferences) {
      if (this.providers.has(providerName)) {
        const provider = this.providers.get(providerName);
        provider.name = providerName; // Ensure provider knows its name
        return provider;
      }
    }

    return null;
  }

  /**
   * Get fallback provider
   */
  getFallbackProvider(currentProvider, operation) {
    const fallbackProviderName = this.config.ai.translation.fallbackProvider;
    
    if (fallbackProviderName && 
        fallbackProviderName !== currentProvider && 
        this.providers.has(fallbackProviderName)) {
      const provider = this.providers.get(fallbackProviderName);
      provider.name = fallbackProviderName;
      return provider;
    }

    return null;
  }

  /**
   * Cache management
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.config.ai.translation.maxCacheAge) {
      return cached.data;
    }
    
    if (cached) {
      this.cache.delete(key); // Remove expired cache
    }
    
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });

    // Cleanup old cache entries periodically
    if (this.cache.size > 1000) {
      this.cleanupCache();
    }
  }

  cleanupCache() {
    const now = Date.now();
    const maxAge = this.config.ai.translation.maxCacheAge;
    
    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > maxAge) {
        this.cache.delete(key);
      }
    }
    
    logInfo(`Cache cleanup completed. Current size: ${this.cache.size}`);
  }

  /**
   * Rate limiting
   */
  async checkRateLimit(providerName) {
    const limit = this.rateLimits.get(providerName);
    if (!limit) return;

    const now = Date.now();
    if (now < limit.resetTime) {
      const waitTime = limit.resetTime - now;
      logInfo(`Rate limit hit for ${providerName}, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  updateRateLimit(providerName) {
    // Simple rate limiting - can be enhanced based on provider specifics
    const now = Date.now();
    this.rateLimits.set(providerName, {
      resetTime: now + 1000, // 1 second between requests
      requests: (this.rateLimits.get(providerName)?.requests || 0) + 1
    });
  }

  /**
   * Utility methods
   */
  hashText(text) {
    // Simple hash function for caching
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      initialized: this.initialized,
      providers: Array.from(this.providers.keys()),
      cacheSize: this.cache.size,
      rateLimits: Object.fromEntries(this.rateLimits)
    };
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.cache.clear();
    this.rateLimits.clear();
    logInfo('AI Manager cleanup completed');
  }
}

// Export singleton instance
module.exports = new AIManager();