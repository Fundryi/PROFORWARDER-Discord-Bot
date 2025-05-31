const { logInfo, logSuccess, logError } = require('./logger');
const translationManager = require('./translationManager');
const { logTranslationThread, getTranslationThreads, deleteTranslationThreads } = require('./database');

/**
 * Thread Manager - Manages Discord thread creation and organization for translations
 * Creates and manages translation threads under forwarded messages
 */
class ThreadManager {
  constructor() {
    this.client = null;
    this.activeThreads = new Map(); // Track active translation threads
    this.threadCache = new Map(); // Cache thread information
    this.initialized = false;
  }

  /**
   * Initialize Thread Manager with Discord client
   */
  initialize(client) {
    this.client = client;
    this.initialized = true;
    logSuccess('Thread Manager initialized successfully');
  }

  /**
   * Create single translation thread with all translations inside
   * NOTE: Discord only allows 1 thread per message, so we create one "TRANSLATIONS" thread
   */
  async createTranslationThreads(forwardedMessage, translationData, config) {
    if (!this.initialized) {
      throw new Error('Thread Manager not initialized');
    }

    if (!config.ai?.translation?.createThreads) {
      logInfo('Translation thread disabled for this config');
      return null;
    }

    try {
      const { translations, sourceLanguage, originalContent } = translationData;
      
      if (Object.keys(translations).length === 0) {
        logInfo('No translations to create thread for');
        return null;
      }

      // Create single thread for all translations
      const thread = await this.createSingleTranslationThread(
        forwardedMessage,
        translations,
        sourceLanguage,
        config
      );

      if (thread) {
        // Track the thread
        await this.trackThread(forwardedMessage.id, 'all', thread);
        
        logSuccess(`Created translations thread with ${Object.keys(translations).length} languages`);
        return { thread };
      }

      return null;

    } catch (error) {
      logError('Failed to create translation thread:', error);
      return null;
    }
  }

  /**
   * Create a single translation thread with all translations
   */
  async createSingleTranslationThread(forwardedMessage, translations, sourceLang, config) {
    try {
      const channel = forwardedMessage.channel;
      
      // Check if channel supports threads
      if (!this.channelSupportsThreads(channel)) {
        logInfo(`Channel ${channel.name} does not support threads`);
        return null;
      }

      // Check permissions
      if (!this.hasThreadPermissions(channel)) {
        logError(`Missing thread permissions in channel ${channel.name}`);
        return null;
      }

      // Generate thread name for all translations
      const threadName = this.generateMultiLanguageThreadName(Object.keys(translations));
      
      // Create the thread
      const thread = await forwardedMessage.startThread({
        name: threadName,
        autoArchiveDuration: 1440, // 24 hours
        reason: `Translation thread for multiple languages`
      });

      // Send all translations in the thread using 1:1 forwarding style
      await this.sendAllTranslations(thread, translations, forwardedMessage, config);

      return thread;

    } catch (error) {
      logError(`Error creating translation thread:`, error);
      return null;
    }
  }


  /**
   * Generate thread name for multiple languages
   */
  generateMultiLanguageThreadName(targetLangs) {
    // Create a concise name with all language flags
    const flags = targetLangs.map(lang => translationManager.getLanguageFlag(lang)).join('');
    const names = targetLangs.map(lang => translationManager.getLanguageName(lang)).join('/');
    
    // Keep thread names concise (Discord has a 100 character limit)
    return `${flags} TRANSLATIONS (${names})`;
  }

  /**
   * Send all translations in the thread using rich embeds
   * NOTE: Threads don't support webhooks, but embeds look beautiful (shows ProForwarder as sender)
   */
  async sendAllTranslations(thread, translations, originalForwardedMessage, config) {
    try {
      // Initialize application emoji manager for cross-server emoji support
      const { initializeAppEmojiManager } = require('./webhookManager');
      const appEmojiManager = initializeAppEmojiManager(this.client);
      
      // Create a beautiful embed for each translation
      for (const [targetLang, translation] of Object.entries(translations)) {
        try {
          // Clean the translated text - remove quotes and extra formatting
          let cleanText = translation.translatedText;
          
          // Remove surrounding quotes if present
          if ((cleanText.startsWith('"') && cleanText.endsWith('"')) ||
              (cleanText.startsWith("'") && cleanText.endsWith("'"))) {
            cleanText = cleanText.slice(1, -1);
          }
          
          // Remove any translation prefixes
          cleanText = cleanText.replace(/^(Translation:|Translated text:|Translation to \w+:|Перевод:|翻译:)\s*/i, '');
          
          // Process emojis to handle cross-server custom emojis
          if (appEmojiManager && cleanText) {
            cleanText = await appEmojiManager.processMessageEmojis(cleanText, thread.guild);
          }
          
          // Get language info
          const flag = translationManager.getLanguageFlag(targetLang);
          const langName = translationManager.getLanguageName(targetLang);
          const color = this.getLanguageColor(targetLang);
          
          // Create rich embed that mimics the original user
          const embed = {
            color: color,
            description: cleanText.trim(),
            author: {
              name: `${flag} ${langName} Translation`,
              iconURL: originalForwardedMessage.author.displayAvatarURL({ dynamic: true, size: 256 })
            },
            footer: {
              text: `Original by ${originalForwardedMessage.author.displayName || originalForwardedMessage.author.username} • Translated by ${translation.provider?.toUpperCase() || 'AI'}`,
              iconURL: this.getProviderIcon(translation.provider)
            },
            timestamp: new Date().toISOString()
          };
          
          // Add image from original message if present
          if (originalForwardedMessage.attachments.size > 0) {
            const firstImage = Array.from(originalForwardedMessage.attachments.values())
              .find(attachment => attachment.contentType?.startsWith('image/'));
            
            if (firstImage) {
              embed.image = {
                url: firstImage.url
              };
            }
          }
          
          // Also check for embed images in the original message
          if (!embed.image && originalForwardedMessage.embeds.length > 0) {
            for (const originalEmbed of originalForwardedMessage.embeds) {
              if (originalEmbed.image?.url) {
                embed.image = {
                  url: originalEmbed.image.url
                };
                break;
              }
            }
          }
          
          // Send the beautiful embed
          await thread.send({
            embeds: [embed],
            allowedMentions: { parse: [] } // Disable mention parsing to avoid pinging users
          });
          
          logSuccess(`Posted ${langName} translation embed in thread with ${embed.image ? 'image' : 'no image'}`);
          
          // Small delay between translations
          if (Object.keys(translations).length > 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
        } catch (error) {
          logError(`Failed to post ${targetLang} translation:`, error);
        }
      }
      
    } catch (error) {
      logError('Error sending translations in thread:', error);
      throw error;
    }
  }

  /**
   * Get color for language (for embeds)
   */
  getLanguageColor(langCode) {
    const colors = {
      'en': 0x1f77b4, // Blue
      'es': 0xff7f0e, // Orange
      'fr': 0x2ca02c, // Green
      'de': 0xd62728, // Red
      'it': 0x9467bd, // Purple
      'pt': 0x8c564b, // Brown
      'ru': 0xe377c2, // Pink
      'ja': 0x7f7f7f, // Gray
      'ko': 0xbcbd22, // Olive
      'zh': 0x17becf, // Cyan
      'ar': 0xff9999, // Light Red
      'nl': 0x66b3ff, // Light Blue
      'pl': 0x99ff99, // Light Green
      'tr': 0xffcc99, // Light Orange
      'cs': 0xcc99ff, // Light Purple
      'bg': 0xff99cc, // Light Pink
      'da': 0x99ccff, // Light Cyan
      'el': 0xccff99, // Light Lime
      'et': 0xffff99, // Light Yellow
      'fi': 0x99ffcc, // Light Mint
      'hu': 0xccccff, // Light Lavender
      'id': 0xffffcc, // Light Cream
      'lt': 0xffccff, // Light Magenta
      'lv': 0xccffff, // Light Aqua
      'nb': 0xffcccc, // Light Rose
      'ro': 0xccffcc, // Light Spring
      'sk': 0xffffcc, // Light Ivory
      'sl': 0xcccccc, // Light Silver
      'sv': 0xffccaa, // Light Peach
      'uk': 0xaaccff  // Light Sky
    };

    return colors[langCode] || 0x99aab5; // Default Discord gray
  }

  /**
   * Get provider icon URL
   */
  getProviderIcon(provider) {
    const icons = {
      'gemini': 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/google-bard.png',
      'google': 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/google-translate.png'
    };

    return icons[provider] || null;
  }

  /**
   * Check if channel supports threads
   */
  channelSupportsThreads(channel) {
    // Text channels and announcement channels support threads
    return channel.type === 0 || channel.type === 5; // TEXT or ANNOUNCEMENT
  }

  /**
   * Check if bot has thread permissions
   */
  hasThreadPermissions(channel) {
    const permissions = channel.permissionsFor(this.client.user);
    return permissions && permissions.has([
      'CreatePublicThreads',
      'SendMessagesInThreads',
      'ViewChannel',
      'SendMessages',
      'EmbedLinks'
    ]);
  }

  /**
   * Track thread for management (both in memory and database)
   */
  async trackThread(messageId, language, thread) {
    const key = `${messageId}-${language}`;
    this.activeThreads.set(key, {
      threadId: thread.id,
      messageId,
      language,
      createdAt: Date.now(),
      archived: false
    });

    // Cache thread info
    this.threadCache.set(thread.id, {
      messageId,
      language,
      name: thread.name
    });

    // Store in database for persistence across bot restarts
    try {
      await logTranslationThread(messageId, thread.id, language);
      logInfo(`Tracked translation thread in database: ${thread.id} (${language})`);
    } catch (error) {
      logError('Failed to store thread in database:', error);
      // Continue - memory tracking still works
    }
  }

  /**
   * Get threads for a message (check both memory and database)
   */
  async getThreadsForMessage(messageId) {
    const threads = [];
    
    // First check memory (for currently active threads)
    for (const [key, threadData] of this.activeThreads.entries()) {
      if (threadData.messageId === messageId) {
        threads.push(threadData);
      }
    }

    // If no threads found in memory, check database (for bot restarts)
    if (threads.length === 0) {
      try {
        const dbThreads = await getTranslationThreads(messageId);
        for (const dbThread of dbThreads) {
          threads.push({
            threadId: dbThread.threadId,
            messageId: dbThread.forwardedMessageId,
            language: dbThread.language,
            createdAt: dbThread.createdAt,
            archived: false
          });
        }
        
        if (dbThreads.length > 0) {
          logInfo(`Found ${dbThreads.length} threads in database for message ${messageId}`);
        }
      } catch (error) {
        logError('Failed to get threads from database:', error);
      }
    }

    return threads;
  }

  /**
   * Archive old threads
   */
  async archiveOldThreads(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
    const now = Date.now();
    const toArchive = [];

    for (const [key, threadData] of this.activeThreads.entries()) {
      if (now - threadData.createdAt > maxAge && !threadData.archived) {
        toArchive.push({ key, threadData });
      }
    }

    if (toArchive.length === 0) {
      return;
    }

    logInfo(`Archiving ${toArchive.length} old translation threads`);

    for (const { key, threadData } of toArchive) {
      try {
        const thread = await this.client.channels.fetch(threadData.threadId);
        if (thread && !thread.archived) {
          await thread.setArchived(true, 'Auto-archive old translation thread');
          threadData.archived = true;
          logInfo(`Archived thread: ${thread.name}`);
        }
      } catch (error) {
        logError(`Failed to archive thread ${threadData.threadId}:`, error);
        // Remove from tracking if thread no longer exists
        this.activeThreads.delete(key);
        this.threadCache.delete(threadData.threadId);
      }
    }
  }

  /**
   * Clean up deleted threads from tracking
   */
  async cleanupDeletedThreads() {
    const toDelete = [];

    for (const [key, threadData] of this.activeThreads.entries()) {
      try {
        const thread = await this.client.channels.fetch(threadData.threadId);
        if (!thread) {
          toDelete.push(key);
        }
      } catch (error) {
        // Thread doesn't exist anymore
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      const threadData = this.activeThreads.get(key);
      this.activeThreads.delete(key);
      if (threadData) {
        this.threadCache.delete(threadData.threadId);
      }
    }

    if (toDelete.length > 0) {
      logInfo(`Cleaned up ${toDelete.length} deleted thread references`);
    }
  }

  /**
   * Get thread statistics
   */
  getStats() {
    const activeCount = Array.from(this.activeThreads.values())
      .filter(thread => !thread.archived).length;
    
    const archivedCount = Array.from(this.activeThreads.values())
      .filter(thread => thread.archived).length;

    const languageStats = {};
    for (const threadData of this.activeThreads.values()) {
      languageStats[threadData.language] = (languageStats[threadData.language] || 0) + 1;
    }

    return {
      initialized: this.initialized,
      activeThreads: activeCount,
      archivedThreads: archivedCount,
      totalThreads: this.activeThreads.size,
      languageBreakdown: languageStats,
      cacheSize: this.threadCache.size
    };
  }

  /**
   * Clean up threads for a specific message (both memory and database)
   */
  async cleanupMessageThreads(messageId) {
    const threadsToRemove = [];
    
    // Find all threads for this message in memory
    for (const [key, threadData] of this.activeThreads.entries()) {
      if (threadData.messageId === messageId) {
        threadsToRemove.push(key);
        // Also remove from cache
        this.threadCache.delete(threadData.threadId);
      }
    }
    
    // Remove from active tracking
    for (const key of threadsToRemove) {
      this.activeThreads.delete(key);
    }
    
    // Clean up database entries
    try {
      const deletedCount = await deleteTranslationThreads(messageId);
      logInfo(`Cleaned up ${threadsToRemove.length} memory references and ${deletedCount} database entries for message ${messageId}`);
    } catch (error) {
      logError('Failed to cleanup threads from database:', error);
      if (threadsToRemove.length > 0) {
        logInfo(`Cleaned up ${threadsToRemove.length} memory references for message ${messageId}`);
      }
    }
  }

  /**
   * Cleanup all resources
   */
  cleanup() {
    this.activeThreads.clear();
    this.threadCache.clear();
    logInfo('Thread Manager cleanup completed');
  }
}

// Export singleton instance
module.exports = new ThreadManager();