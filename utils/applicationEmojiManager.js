const { logInfo, logSuccess, logError } = require('./logger');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const axios = require('axios');
const { getBotSetting, setBotSetting } = require('./database');

// Application emoji cache to track bot's uploaded emojis
const appEmojiCache = new Map(); // Format: "emojiName_originalId" -> { emoji, uploadedAt, usageCount }
const uploadedEmojiNames = new Set(); // Simple set to track uploaded emoji names
const MAX_APP_EMOJIS = 1900; // Leave some buffer from Discord's 2000 limit
const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

class ApplicationEmojiManager {
  constructor(client) {
    this.client = client;
    this.rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    this.applicationId = null;
    this.isCleaningUp = false;
    
    // Debug info about setup
    logInfo(`Initializing Application Emoji Manager`);
    logInfo(`Bot token available: ${!!process.env.BOT_TOKEN}`);
    logInfo(`Bot token length: ${process.env.BOT_TOKEN ? process.env.BOT_TOKEN.length : 0}`);
    logInfo(`REST API version: 10`);
    
    // Initialize application ID
    this.initializeApplication();
    
    // Periodic cleanup of old emojis
    setInterval(() => {
      this.cleanupOldEmojis();
    }, CACHE_CLEANUP_INTERVAL);
    
    logInfo('Application emoji manager initialized with 2000 emoji limit');
  }

  // Initialize application ID for API calls
  async initializeApplication() {
    try {
      if (this.client.application) {
        this.applicationId = this.client.application.id;
        await this.loadExistingEmojis();
      } else {
        // Wait for client to be ready
        this.client.once('ready', async () => {
          this.applicationId = this.client.application.id;
          await this.loadExistingEmojis();
          logInfo(`Application emoji manager ready for app ID: ${this.applicationId}`);
        });
      }
    } catch (error) {
      logError('Error initializing application emoji manager:', error);
    }
  }

  // Load existing application emojis into cache
  async loadExistingEmojis() {
    try {
      // Load persistent list of uploaded emoji names
      const storedNames = await getBotSetting('uploaded_emoji_names');
      if (storedNames) {
        const namesList = JSON.parse(storedNames);
        namesList.forEach(name => uploadedEmojiNames.add(name));
        logInfo(`Loaded ${namesList.length} previously uploaded emoji names from database`);
      }

      const existingEmojis = await this.getApplicationEmojis();
      logInfo(`Found ${existingEmojis.length} existing application emojis via API`);
      
      // Add existing emojis to cache (assuming they were uploaded by us)
      for (const emoji of existingEmojis) {
        uploadedEmojiNames.add(emoji.name);
        const cacheKey = `${emoji.name}_unknown`; // We don't know original ID
        appEmojiCache.set(cacheKey, {
          emoji: emoji,
          uploadedAt: Date.now() - (24 * 60 * 60 * 1000), // Assume uploaded yesterday
          usageCount: 0,
          originalId: 'unknown'
        });
      }

      // Save updated list to database
      await this.saveUploadedNames();
    } catch (error) {
      logError('Error loading existing emojis:', error);
    }
  }

  // Save uploaded emoji names to database
  async saveUploadedNames() {
    try {
      const namesList = Array.from(uploadedEmojiNames);
      await setBotSetting('uploaded_emoji_names', JSON.stringify(namesList));
    } catch (error) {
      logError('Error saving uploaded emoji names:', error);
    }
  }

  // Handle emoji in message content - replace custom emojis with app-level ones
  async processMessageEmojis(content, targetGuild) {
    if (!content || !this.applicationId) return content;

    // Find all custom emoji mentions in the content
    const emojiRegex = /<(a?):(\w+):(\d+)>/g;
    let processedContent = content;
    const matches = [...content.matchAll(emojiRegex)];

    for (const match of matches) {
      const [fullMatch, animated, emojiName, emojiId] = match;
      const isAnimated = animated === 'a';

      try {
        // Check if emoji already exists in target guild (preferred)
        const existingEmoji = targetGuild.emojis.cache.find(e => 
          e.name === emojiName || e.id === emojiId
        );

        if (existingEmoji) {
          // Use existing emoji from target guild (no change needed)
          continue;
        }

        // Try to get or upload the emoji to application level
        const appEmoji = await this.getOrUploadAppEmoji(emojiName, emojiId, isAnimated);
        if (appEmoji) {
          const replacement = `<${isAnimated ? 'a' : ''}:${appEmoji.name}:${appEmoji.id}>`;
          processedContent = processedContent.replace(fullMatch, replacement);
          
          // Update usage tracking
          const cacheKey = `${emojiName}_${emojiId}`;
          if (appEmojiCache.has(cacheKey)) {
            appEmojiCache.get(cacheKey).usageCount++;
          }
        } else {
          // Fallback to emoji name if upload fails
          processedContent = processedContent.replace(fullMatch, `:${emojiName}:`);
        }
      } catch (error) {
        logError(`Failed to process emoji ${emojiName}:`, error);
        // Fallback to emoji name
        processedContent = processedContent.replace(fullMatch, `:${emojiName}:`);
      }
    }

    return processedContent;
  }

  // Get existing application emoji or upload new one
  async getOrUploadAppEmoji(emojiName, emojiId, isAnimated) {
    try {
      const cacheKey = `${emojiName}_${emojiId}`;
      
      // Get current application emojis first
      const currentEmojis = await this.getApplicationEmojis();
      
      // Check if emoji already exists by name (Discord's requirement)
      const sanitizedName = this.sanitizeEmojiName(emojiName);
      
      // First check our persistent name list (faster than API call)
      if (uploadedEmojiNames.has(sanitizedName)) {
        logInfo(`Application emoji :${sanitizedName}: already uploaded (found in name list), skipping`);
        
        // Try to find in API results
        const existingByName = currentEmojis.find(e => e.name === sanitizedName);
        if (existingByName) {
          // Update cache with existing emoji
          appEmojiCache.set(cacheKey, {
            emoji: existingByName,
            uploadedAt: Date.now(),
            usageCount: (appEmojiCache.get(cacheKey)?.usageCount || 0) + 1,
            originalId: emojiId
          });
          return existingByName;
        } else {
          // Name exists in our list but not in API - emoji was probably deleted
          // Remove from our list and continue with upload
          uploadedEmojiNames.delete(sanitizedName);
          await this.saveUploadedNames();
          logInfo(`Emoji :${sanitizedName}: was in our list but not found via API, will re-upload`);
        }
      }
      
      // Also check API results for existing emoji
      const existingByName = currentEmojis.find(e => e.name === sanitizedName);
      if (existingByName) {
        logInfo(`Application emoji :${sanitizedName}: found via API, adding to name list`);
        uploadedEmojiNames.add(sanitizedName);
        await this.saveUploadedNames();
        
        // Update cache with existing emoji
        appEmojiCache.set(cacheKey, {
          emoji: existingByName,
          uploadedAt: Date.now(),
          usageCount: (appEmojiCache.get(cacheKey)?.usageCount || 0) + 1,
          originalId: emojiId
        });
        
        return existingByName;
      }

      // Check if we already uploaded this emoji by cache
      if (appEmojiCache.has(cacheKey)) {
        const cached = appEmojiCache.get(cacheKey);
        // Verify emoji still exists
        if (currentEmojis.find(e => e.id === cached.emoji.id)) {
          return cached.emoji;
        } else {
          // Remove from cache if emoji was deleted
          appEmojiCache.delete(cacheKey);
        }
      }

      // Check if we need to clean up old emojis
      if (currentEmojis.length >= MAX_APP_EMOJIS) {
        logInfo(`Application approaching emoji limit, cleaning up old emojis`);
        await this.cleanupOldEmojis();
      }

      // Download emoji image
      const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? 'gif' : 'png'}`;
      const response = await axios.get(emojiUrl, { 
        responseType: 'arraybuffer',
        timeout: 10000 
      });
      
      if (response.status !== 200) {
        throw new Error(`Failed to download emoji: ${response.status}`);
      }

      // Convert to base64 data URI
      const imageBuffer = Buffer.from(response.data);
      const mimeType = isAnimated ? 'image/gif' : 'image/png';
      const dataUri = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

      // Upload emoji to application
      const uploadedEmoji = await this.rest.post(
        Routes.applicationEmojis(this.applicationId),
        {
          body: {
            name: this.sanitizeEmojiName(emojiName),
            image: dataUri
          }
        }
      );

      // Cache the uploaded emoji
      appEmojiCache.set(cacheKey, {
        emoji: uploadedEmoji,
        uploadedAt: Date.now(),
        usageCount: 1,
        originalId: emojiId
      });

      // Add to persistent name list
      uploadedEmojiNames.add(uploadedEmoji.name);
      await this.saveUploadedNames();

      logSuccess(`✅ Uploaded application emoji :${emojiName}: (${uploadedEmoji.id})`);
      return uploadedEmoji;

    } catch (error) {
      // Check if error is due to emoji already existing
      if (error.message && error.message.includes('APPLICATION_EMOJI_NAME_ALREADY_TAKEN')) {
        logInfo(`Emoji :${this.sanitizeEmojiName(emojiName)}: already exists, adding to tracking list`);
        
        // Add to our tracking list to prevent future attempts
        const sanitizedName = this.sanitizeEmojiName(emojiName);
        uploadedEmojiNames.add(sanitizedName);
        await this.saveUploadedNames();
        
        // Return a mock emoji object so the message can still be processed
        return {
          id: 'existing_' + emojiId,
          name: sanitizedName,
          animated: isAnimated
        };
      }
      
      logError(`Failed to upload application emoji ${emojiName} (${emojiId}):`, error.message);
      return null;
    }
  }

  // Get all application emojis
  async getApplicationEmojis() {
    try {
      if (!this.applicationId) {
        throw new Error('Application ID not available');
      }

      // Debug info about the API call
      const endpoint = Routes.applicationEmojis(this.applicationId);
      logInfo(`=== APPLICATION EMOJI API DEBUG ===`);
      logInfo(`Application ID: ${this.applicationId}`);
      logInfo(`API Endpoint: ${endpoint}`);
      logInfo(`Full URL: https://discord.com/api/v10${endpoint}`);
      logInfo(`Token available: ${!!process.env.BOT_TOKEN}`);
      logInfo(`Token starts with: ${process.env.BOT_TOKEN ? process.env.BOT_TOKEN.substring(0, 10) + '...' : 'N/A'}`);
      
      // Check bot permissions and info
      if (this.client.user) {
        logInfo(`Bot user ID: ${this.client.user.id}`);
        logInfo(`Bot username: ${this.client.user.username}`);
        logInfo(`Bot application ID matches: ${this.client.user.id === this.applicationId}`);
      }

      logInfo(`Making API call to fetch application emojis...`);
      const startTime = Date.now();
      
      const emojis = await this.rest.get(endpoint);
      
      const duration = Date.now() - startTime;
      logInfo(`API call completed in ${duration}ms`);
      logInfo(`Response type: ${typeof emojis}`);
      logInfo(`Response is array: ${Array.isArray(emojis)}`);
      logInfo(`Response length: ${Array.isArray(emojis) ? emojis.length : 'N/A'}`);
      
      if (emojis && typeof emojis === 'object') {
        logInfo(`Response keys: ${Object.keys(emojis)}`);
        
        // Handle paginated response format
        if (emojis.items && Array.isArray(emojis.items)) {
          logInfo(`Found ${emojis.items.length} emojis in paginated response`);
          if (emojis.items.length > 0) {
            logInfo(`First emoji structure:`, emojis.items[0]);
          }
          logInfo(`Emoji names found: ${emojis.items.map(e => e.name).join(', ')}`);
          logInfo(`=== END API DEBUG ===`);
          return emojis.items;
        }
        
        // Handle direct array response (fallback)
        if (Array.isArray(emojis) && emojis.length > 0) {
          logInfo(`First emoji structure:`, emojis[0]);
        }
      }
      
      if (Array.isArray(emojis)) {
        logInfo(`Emoji names found: ${emojis.map(e => e.name).join(', ')}`);
        logInfo(`=== END API DEBUG ===`);
        return emojis;
      }
      
      logInfo(`Response format not recognized - returning empty array`);
      logInfo(`=== END API DEBUG ===`);
      return [];
    } catch (error) {
      logError('=== APPLICATION EMOJI API ERROR ===');
      logError('Error getting application emojis:', error.message);
      logError('Error code:', error.code);
      logError('Error status:', error.status);
      logError('Error headers:', error.headers);
      logError('Full error object:', error);
      logError('=== END API ERROR ===');
      return [];
    }
  }

  // Clean up old/unused emojis when approaching limit
  async cleanupOldEmojis() {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;

    try {
      const currentEmojis = await this.getApplicationEmojis();
      
      if (currentEmojis.length < MAX_APP_EMOJIS * 0.9) {
        this.isCleaningUp = false;
        return; // Only clean when 90% full
      }

      logInfo(`Cleaning up application emojis (${currentEmojis.length}/${MAX_APP_EMOJIS})`);

      // Sort cached emojis by usage count and age (least used and oldest first)
      const sortedCacheEntries = Array.from(appEmojiCache.entries()).map(([key, data]) => ({
        key,
        data,
        emoji: currentEmojis.find(e => e.id === data.emoji.id)
      })).filter(entry => entry.emoji) // Only include emojis that still exist
      .sort((a, b) => {
        // Sort by usage count first, then by age
        if (a.data.usageCount !== b.data.usageCount) {
          return a.data.usageCount - b.data.usageCount;
        }
        return a.data.uploadedAt - b.data.uploadedAt;
      });

      // Delete oldest/least used emojis to make room
      const emojisToDelete = Math.min(
        sortedCacheEntries.length,
        Math.max(0, currentEmojis.length - (MAX_APP_EMOJIS * 0.8)) // Target 80% capacity
      );

      for (let i = 0; i < emojisToDelete; i++) {
        const { key, data, emoji } = sortedCacheEntries[i];
        try {
          await this.rest.delete(Routes.applicationEmoji(this.applicationId, emoji.id));
          appEmojiCache.delete(key);
          logInfo(`Deleted old application emoji :${emoji.name}:`);
        } catch (error) {
          logError(`Failed to delete application emoji ${emoji.name}:`, error);
        }
      }

      if (emojisToDelete > 0) {
        logSuccess(`✅ Cleaned up ${emojisToDelete} old application emojis`);
      }
    } catch (error) {
      logError('Error during application emoji cleanup:', error);
    } finally {
      this.isCleaningUp = false;
    }
  }

  // Sanitize emoji name to meet Discord requirements
  sanitizeEmojiName(name) {
    // Discord emoji names must be 2-32 characters, alphanumeric + underscore
    return name
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .substring(0, 32)
      .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
      .toLowerCase() || 'unknown_emoji';
  }

  // Get statistics about emoji usage
  getEmojiStats() {
    const totalCached = appEmojiCache.size;
    const totalUsage = Array.from(appEmojiCache.values()).reduce((sum, data) => sum + data.usageCount, 0);
    
    return {
      cachedEmojis: totalCached,
      totalUsage,
      applicationId: this.applicationId,
      cacheMemoryUsage: `${Math.round(appEmojiCache.size * 0.1)} KB` // Rough estimate
    };
  }
}

module.exports = ApplicationEmojiManager;