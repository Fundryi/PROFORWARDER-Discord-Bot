const { logInfo, logSuccess, logError } = require('./logger');
const axios = require('axios');

// Emoji cache to track bot's uploaded emojis
const emojiCache = new Map(); // Format: "emojiName_originalId" -> { emoji, uploadedAt, usageCount }
const MAX_BOT_EMOJIS = 1900; // Leave some buffer from Discord's 2000 limit
const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

class EmojiManager {
  constructor(client) {
    this.client = client;
    this.isCleaningUp = false;
    
    // Periodic cleanup of old emojis
    setInterval(() => {
      this.cleanupOldEmojis();
    }, CACHE_CLEANUP_INTERVAL);
    
    logInfo('Emoji manager initialized with cross-server emoji support');
  }

  // Handle emoji in message content - replace custom emojis with bot-managed ones
  async processMessageEmojis(content, targetGuild) {
    if (!content || !targetGuild) return content;

    // Find all custom emoji mentions in the content
    const emojiRegex = /<(a?):(\w+):(\d+)>/g;
    let processedContent = content;
    const matches = [...content.matchAll(emojiRegex)];

    for (const match of matches) {
      const [fullMatch, animated, emojiName, emojiId] = match;
      const isAnimated = animated === 'a';

      try {
        // Check if emoji already exists in target guild
        const existingEmoji = targetGuild.emojis.cache.find(e => 
          e.name === emojiName || e.id === emojiId
        );

        if (existingEmoji) {
          // Use existing emoji from target guild
          const replacement = `<${isAnimated ? 'a' : ''}:${existingEmoji.name}:${existingEmoji.id}>`;
          processedContent = processedContent.replace(fullMatch, replacement);
          continue;
        }

        // Try to get or upload the emoji
        const botEmoji = await this.getOrUploadEmoji(emojiName, emojiId, isAnimated, targetGuild);
        if (botEmoji) {
          const replacement = `<${isAnimated ? 'a' : ''}:${botEmoji.name}:${botEmoji.id}>`;
          processedContent = processedContent.replace(fullMatch, replacement);
          
          // Update usage tracking
          const cacheKey = `${emojiName}_${emojiId}`;
          if (emojiCache.has(cacheKey)) {
            emojiCache.get(cacheKey).usageCount++;
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

  // Get existing emoji or upload new one
  async getOrUploadEmoji(emojiName, emojiId, isAnimated, targetGuild) {
    try {
      const cacheKey = `${emojiName}_${emojiId}`;
      
      // Check if we already uploaded this emoji
      if (emojiCache.has(cacheKey)) {
        const cached = emojiCache.get(cacheKey);
        // Verify emoji still exists in guild
        if (targetGuild.emojis.cache.has(cached.emoji.id)) {
          return cached.emoji;
        } else {
          // Remove from cache if emoji was deleted
          emojiCache.delete(cacheKey);
        }
      }

      // Check current emoji count in target guild
      const currentEmojiCount = targetGuild.emojis.cache.size;
      if (currentEmojiCount >= MAX_BOT_EMOJIS) {
        logInfo(`Guild ${targetGuild.name} approaching emoji limit, cleaning up old emojis`);
        await this.cleanupOldEmojis(targetGuild);
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

      // Upload emoji to target guild
      const uploadedEmoji = await targetGuild.emojis.create({
        attachment: Buffer.from(response.data),
        name: this.sanitizeEmojiName(emojiName),
        reason: 'ProForwarder cross-server emoji support'
      });

      // Cache the uploaded emoji
      emojiCache.set(cacheKey, {
        emoji: uploadedEmoji,
        uploadedAt: Date.now(),
        usageCount: 1,
        originalId: emojiId
      });

      logSuccess(`✅ Uploaded emoji :${emojiName}: to ${targetGuild.name}`);
      return uploadedEmoji;

    } catch (error) {
      logError(`Failed to upload emoji ${emojiName} (${emojiId}):`, error.message);
      return null;
    }
  }

  // Clean up old/unused emojis when approaching limit
  async cleanupOldEmojis(targetGuild = null) {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;

    try {
      const guildsToClean = targetGuild ? [targetGuild] : this.client.guilds.cache.values();

      for (const guild of guildsToClean) {
        const emojiCount = guild.emojis.cache.size;
        
        if (emojiCount < MAX_BOT_EMOJIS * 0.9) continue; // Only clean when 90% full

        logInfo(`Cleaning up emojis in ${guild.name} (${emojiCount}/${MAX_BOT_EMOJIS})`);

        // Get bot-managed emojis (created by ProForwarder)
        const botEmojis = guild.emojis.cache.filter(emoji => 
          emoji.user && emoji.user.id === this.client.user.id
        );

        // Sort by usage count and age (least used and oldest first)
        const sortedEmojis = Array.from(botEmojis.values()).map(emoji => {
          const cacheKey = Array.from(emojiCache.keys()).find(key => 
            emojiCache.get(key).emoji.id === emoji.id
          );
          const cacheData = cacheKey ? emojiCache.get(cacheKey) : null;
          
          return {
            emoji,
            cacheKey,
            usageCount: cacheData?.usageCount || 0,
            uploadedAt: cacheData?.uploadedAt || 0
          };
        }).sort((a, b) => {
          // Sort by usage count first, then by age
          if (a.usageCount !== b.usageCount) {
            return a.usageCount - b.usageCount;
          }
          return a.uploadedAt - b.uploadedAt;
        });

        // Delete oldest/least used emojis to make room
        const emojisToDelete = Math.min(
          sortedEmojis.length,
          Math.max(0, emojiCount - (MAX_BOT_EMOJIS * 0.8)) // Target 80% capacity
        );

        for (let i = 0; i < emojisToDelete; i++) {
          const { emoji, cacheKey } = sortedEmojis[i];
          try {
            await emoji.delete('ProForwarder: Making room for new emojis');
            if (cacheKey) {
              emojiCache.delete(cacheKey);
            }
            logInfo(`Deleted old emoji :${emoji.name}: from ${guild.name}`);
          } catch (error) {
            logError(`Failed to delete emoji ${emoji.name}:`, error);
          }
        }

        if (emojisToDelete > 0) {
          logSuccess(`✅ Cleaned up ${emojisToDelete} old emojis in ${guild.name}`);
        }
      }
    } catch (error) {
      logError('Error during emoji cleanup:', error);
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

  // Handle reaction emojis for forwarding
  async processReactionEmoji(reaction, targetGuild) {
    if (!reaction.emoji.id) {
      // Unicode emoji, can be used as-is
      return reaction.emoji.name;
    }

    try {
      // Custom emoji - try to get or upload it
      const botEmoji = await this.getOrUploadEmoji(
        reaction.emoji.name,
        reaction.emoji.id,
        reaction.emoji.animated,
        targetGuild
      );

      return botEmoji || reaction.emoji.name; // Fallback to name if upload fails
    } catch (error) {
      logError(`Failed to process reaction emoji ${reaction.emoji.name}:`, error);
      return reaction.emoji.name;
    }
  }

  // Get statistics about emoji usage
  getEmojiStats() {
    const totalCached = emojiCache.size;
    const totalUsage = Array.from(emojiCache.values()).reduce((sum, data) => sum + data.usageCount, 0);
    
    return {
      cachedEmojis: totalCached,
      totalUsage,
      guildsManaged: this.client.guilds.cache.size,
      cacheMemoryUsage: `${Math.round(emojiCache.size * 0.1)} KB` // Rough estimate
    };
  }
}

module.exports = EmojiManager;