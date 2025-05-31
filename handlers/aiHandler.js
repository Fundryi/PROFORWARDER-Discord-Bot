const { logInfo, logSuccess, logError } = require('../utils/logger');
const aiManager = require('../utils/aiManager');
const translationManager = require('../utils/translationManager');
const threadManager = require('../utils/threadManager');

/**
 * AI Handler - Orchestrates AI processing for forwarded messages
 * Handles translation threads and content optimization
 */
class AIHandler {
  constructor(client) {
    this.client = client;
    this.initialized = false;
    this.processingQueue = new Map(); // Prevent duplicate processing
  }

  /**
   * Initialize AI Handler
   */
  async initialize() {
    try {
      // Initialize all AI components
      const aiInitialized = await aiManager.initialize();
      const translationInitialized = await translationManager.initialize();
      
      // Initialize thread manager
      threadManager.initialize(this.client);

      if (!aiInitialized) {
        logInfo('AI features not available - AI Manager initialization failed');
        return false;
      }

      this.initialized = true;
      logSuccess('AI Handler initialized successfully');
      
      // Set up periodic cleanup
      this.setupPeriodicCleanup();
      
      return true;
    } catch (error) {
      logError('Failed to initialize AI Handler:', error);
      return false;
    }
  }

  /**
   * Process forwarded message with AI features
   */
  async processForwardedMessage(forwardedMessage, originalMessage, config) {
    if (!this.initialized) {
      logInfo('AI Handler not initialized, skipping AI processing');
      return;
    }

    if (!config.ai?.enabled) {
      logInfo('AI features disabled for this config');
      return;
    }

    // Prevent duplicate processing
    const processingKey = `${forwardedMessage.id}-${config.id}`;
    if (this.processingQueue.has(processingKey)) {
      logInfo('Message already being processed, skipping');
      return;
    }

    this.processingQueue.set(processingKey, Date.now());

    try {
      logInfo(`Starting AI processing for forwarded message ${forwardedMessage.id}`);

      // Process translations if enabled
      if (config.ai.translation?.enabled) {
        await this.processTranslations(forwardedMessage, originalMessage, config);
      }

      // Process content optimization if enabled (for future platforms like Telegram)
      if (config.ai.contentOptimization?.enabled) {
        await this.processContentOptimization(forwardedMessage, originalMessage, config);
      }

      logSuccess(`AI processing completed for message ${forwardedMessage.id}`);

    } catch (error) {
      logError('AI processing failed:', error);
    } finally {
      // Remove from processing queue
      this.processingQueue.delete(processingKey);
    }
  }

  /**
   * Process translations and create threads
   */
  async processTranslations(forwardedMessage, originalMessage, config) {
    try {
      logInfo('Processing translations for forwarded message');

      // Generate translations
      const translationData = await translationManager.translateMessage(originalMessage, config);
      
      if (!translationData) {
        logInfo('No translations generated');
        return;
      }

      // Create translation threads
      const threads = await threadManager.createTranslationThreads(
        forwardedMessage,
        translationData,
        config
      );

      if (threads) {
        const threadCount = Object.keys(threads).length;
        logSuccess(`Created ${threadCount} translation thread(s)`);
        
        // Optionally send notification about translations
        if (config.ai.translation.notifyTranslations) {
          await this.sendTranslationNotification(forwardedMessage, translationData, threads);
        }
      }

    } catch (error) {
      logError('Translation processing failed:', error);
    }
  }

  /**
   * Process content optimization
   */
  async processContentOptimization(forwardedMessage, originalMessage, config) {
    try {
      logInfo('Processing content optimization');

      const optimizationOptions = {
        level: config.ai.contentOptimization.level || 'enhanced',
        platformSpecific: config.ai.contentOptimization.platformSpecific || false,
        targetPlatform: config.targetType || 'discord',
        preserveFormatting: config.ai.contentOptimization.preserveFormatting !== false,
        maxLength: config.ai.contentOptimization.maxLength || null
      };

      // Extract content to optimize
      const content = this.extractOptimizableContent(originalMessage);
      if (!content) {
        logInfo('No content to optimize');
        return;
      }

      // Optimize content
      const optimization = await aiManager.optimizeContent(content, optimizationOptions);
      
      if (optimization && optimization.optimized !== content) {
        logInfo('Content optimization completed');
        
        // For now, just log the optimization (future: apply to Telegram forwards)
        if (config.ai.contentOptimization.logOptimizations) {
          logInfo(`Original: ${content}`);
          logInfo(`Optimized: ${optimization.optimized}`);
          logInfo(`Changes: ${optimization.changes.join(', ')}`);
        }
      }

    } catch (error) {
      logError('Content optimization failed:', error);
    }
  }

  /**
   * Extract content suitable for optimization
   */
  extractOptimizableContent(message) {
    let content = '';

    if (message.content && message.content.trim()) {
      content = message.content;
    }

    // For now, focus on text content
    // Future: handle embeds and other content types

    return content.trim() || null;
  }

  /**
   * Send notification about created translations
   */
  async sendTranslationNotification(forwardedMessage, translationData, threads) {
    try {
      const languages = Object.keys(translationData.translations);
      const languageList = languages.map(lang => {
        const flag = translationManager.getLanguageFlag(lang);
        const name = translationManager.getLanguageName(lang);
        return `${flag} ${name}`;
      }).join(', ');

      const embed = {
        color: 0x00ff00, // Green
        title: '🌐 Translations Available',
        description: `This message has been translated into: ${languageList}`,
        footer: {
          text: 'Check the threads below for translations',
          icon_url: this.client.user.displayAvatarURL()
        },
        timestamp: new Date().toISOString()
      };

      // Send as a reply to the forwarded message (will be deleted after timeout)
      const notification = await forwardedMessage.reply({ embeds: [embed] });

      // Auto-delete notification after 30 seconds
      setTimeout(async () => {
        try {
          await notification.delete();
        } catch (error) {
          // Ignore deletion errors
        }
      }, 30000);

    } catch (error) {
      logError('Failed to send translation notification:', error);
    }
  }

  /**
   * Handle message edits for AI-processed messages
   */
  async handleMessageEdit(oldMessage, newMessage, config) {
    if (!this.initialized || !config.ai?.enabled) {
      return;
    }

    try {
      // Find related threads for this message
      const threads = threadManager.getThreadsForMessage(newMessage.id);
      
      if (threads.length === 0) {
        return;
      }

      logInfo(`Message edit detected for AI-processed message with ${threads.length} thread(s)`);

      // Re-process translations if content changed significantly
      if (this.hasSignificantContentChange(oldMessage, newMessage)) {
        logInfo('Significant content change detected, re-processing translations');
        
        // Generate new translations
        const translationData = await translationManager.translateMessage(newMessage, config);
        
        if (translationData) {
          // Update existing threads with new translations
          await this.updateTranslationThreads(threads, translationData);
        }
      }

    } catch (error) {
      logError('Error handling message edit for AI processing:', error);
    }
  }

  /**
   * Check if message edit represents significant content change
   */
  hasSignificantContentChange(oldMessage, newMessage) {
    const oldContent = oldMessage.content || '';
    const newContent = newMessage.content || '';

    // Simple heuristic: significant if content changed by more than 20% or 50 characters
    const lengthDiff = Math.abs(oldContent.length - newContent.length);
    const lengthRatio = lengthDiff / Math.max(oldContent.length, 1);

    return lengthRatio > 0.2 || lengthDiff > 50;
  }

  /**
   * Update existing translation threads with new translations
   */
  async updateTranslationThreads(threads, translationData) {
    try {
      for (const threadData of threads) {
        const translation = translationData.translations[threadData.language];
        
        if (translation) {
          try {
            const thread = await this.client.channels.fetch(threadData.threadId);
            
            if (thread && !thread.archived) {
              // Send updated translation to thread
              await threadManager.sendTranslationMessage(
                thread,
                translation,
                threadData.language,
                translationData.sourceLanguage,
                {} // Config not needed for this call
              );
              
              logSuccess(`Updated translation thread for ${threadData.language}`);
            }
          } catch (error) {
            logError(`Failed to update thread for ${threadData.language}:`, error);
          }
        }
      }
    } catch (error) {
      logError('Error updating translation threads:', error);
    }
  }

  /**
   * Handle message deletion for AI-processed messages
   */
  async handleMessageDelete(message) {
    if (!this.initialized) {
      return;
    }

    try {
      // Find and archive related threads
      const threads = threadManager.getThreadsForMessage(message.id);
      
      if (threads.length > 0) {
        logInfo(`Message deleted, archiving ${threads.length} related translation thread(s)`);
        
        for (const threadData of threads) {
          try {
            const thread = await this.client.channels.fetch(threadData.threadId);
            
            if (thread && !thread.archived) {
              await thread.setArchived(true, 'Original message was deleted');
              threadData.archived = true;
            }
          } catch (error) {
            // Thread might already be deleted
            logInfo(`Could not archive thread ${threadData.threadId}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      logError('Error handling message deletion for AI processing:', error);
    }
  }

  /**
   * Set up periodic cleanup tasks
   */
  setupPeriodicCleanup() {
    // Clean up processing queue every 5 minutes
    setInterval(() => {
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 minutes
      
      for (const [key, timestamp] of this.processingQueue.entries()) {
        if (now - timestamp > maxAge) {
          this.processingQueue.delete(key);
        }
      }
    }, 5 * 60 * 1000);

    // Archive old threads every hour
    setInterval(async () => {
      try {
        await threadManager.archiveOldThreads();
        await threadManager.cleanupDeletedThreads();
      } catch (error) {
        logError('Error during periodic thread cleanup:', error);
      }
    }, 60 * 60 * 1000);
  }

  /**
   * Get AI processing statistics
   */
  getStats() {
    return {
      initialized: this.initialized,
      processingQueueSize: this.processingQueue.size,
      aiManagerStats: aiManager.getStats(),
      translationManagerStats: translationManager.getStats(),
      threadManagerStats: threadManager.getStats()
    };
  }

  /**
   * Test AI functionality
   */
  async testAIFunctionality() {
    const results = {
      aiManager: false,
      translation: false,
      threadManager: false
    };

    try {
      // Test AI Manager
      if (this.initialized) {
        results.aiManager = true;
        
        // Test translation
        try {
          const testTranslation = await translationManager.translateContent(
            'Hello world',
            'es',
            'en',
            null,
            false
          );
          results.translation = !!testTranslation;
        } catch (error) {
          logError('Translation test failed:', error);
        }

        // Test thread manager
        results.threadManager = threadManager.initialized;
      }
    } catch (error) {
      logError('AI functionality test failed:', error);
    }

    return results;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.processingQueue.clear();
    threadManager.cleanup();
    translationManager.cleanup();
    aiManager.cleanup();
    logInfo('AI Handler cleanup completed');
  }
}

module.exports = AIHandler;