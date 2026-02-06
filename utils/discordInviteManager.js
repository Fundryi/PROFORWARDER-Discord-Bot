const fs = require('fs').promises;
const { logInfo, logError, logSuccess } = require('./logger');
const { CACHED_INVITES_PATH } = require('./configManager');

/**
 * Discord Invite Manager - Handles creation and caching of Discord server invites
 */
class DiscordInviteManager {
  constructor() {
    this.inviteCache = new Map(); // guildId -> { invite, expiresAt }
    this.client = null;
  }

  /**
   * Initialize with Discord client
   */
  initialize(client) {
    this.client = client;
    this.loadInvitesFromConfig();
  }

  /**
   * Load cached invites from cachedInvites.json
   */
  async loadInvitesFromConfig() {
    try {
      let data = {};
      try {
        const content = await fs.readFile(CACHED_INVITES_PATH, 'utf8');
        data = JSON.parse(content);
      } catch (readError) {
        if (readError.code !== 'ENOENT') {
          logError('Error reading cachedInvites.json:', readError.message);
        }
        return; // File doesn't exist yet or is invalid — start with empty cache
      }

      if (data && typeof data === 'object') {
        for (const [guildId, inviteData] of Object.entries(data)) {
          this.inviteCache.set(guildId, {
            invite: inviteData.invite,
            expiresAt: inviteData.expiresAt || null,
            isVanity: inviteData.isVanity || false
          });
        }
        if (this.inviteCache.size > 0) {
          logInfo(`Loaded ${this.inviteCache.size} cached Discord invites`);
        }
      }
    } catch (error) {
      logError('Error loading cached invites:', error);
    }
  }

  /**
   * Save invites to cachedInvites.json
   */
  async saveInvitesToConfig() {
    try {
      const data = {};
      for (const [guildId, inviteData] of this.inviteCache.entries()) {
        data[guildId] = {
          invite: inviteData.invite,
          expiresAt: inviteData.expiresAt || null,
          isVanity: inviteData.isVanity || false
        };
      }
      await fs.writeFile(CACHED_INVITES_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
    } catch (error) {
      logError('Error saving cached invites:', error);
    }
  }

  /**
   * Get or create invite link for a Discord guild
   */
  async getGuildInvite(guild) {
    if (!guild) return null;

    const guildId = guild.id;
    
    // Check if we have a cached valid invite
    const cachedInvite = this.inviteCache.get(guildId);
    if (cachedInvite) {
      // If it's a vanity URL or hasn't expired, use it
      if (cachedInvite.isVanity || !cachedInvite.expiresAt || cachedInvite.expiresAt > Date.now()) {
        return cachedInvite.invite;
      }
    }

    try {
      // First, try to get the vanity URL
      if (guild.vanityURLCode) {
        const vanityInvite = `https://discord.gg/${guild.vanityURLCode}`;
        this.inviteCache.set(guildId, {
          invite: vanityInvite,
          expiresAt: null, // Vanity URLs don't expire
          isVanity: true
        });
        await this.saveInvitesToConfig();
        logInfo(`Using vanity URL for ${guild.name}: ${vanityInvite}`);
        return vanityInvite;
      }

      // Try to create a new permanent invite
      const invite = await this.createGuildInvite(guild);
      if (invite) {
        this.inviteCache.set(guildId, {
          invite: invite.url,
          expiresAt: invite.expiresAt ? new Date(invite.expiresAt).getTime() : null,
          isVanity: false
        });
        await this.saveInvitesToConfig();
        logSuccess(`Created new invite for ${guild.name}: ${invite.url}`);
        return invite.url;
      }

      logError(`Failed to create invite for guild: ${guild.name}`);
      return null;
    } catch (error) {
      logError(`Error getting invite for guild ${guild.name}:`, error);
      return null;
    }
  }

  /**
   * Create a new invite for the guild
   */
  async createGuildInvite(guild) {
    try {
      // Find a suitable channel to create invite from
      let targetChannel = null;

      // Prefer general channels
      const generalChannels = guild.channels.cache.filter(channel => 
        channel.type === 0 && // Text channel
        (channel.name.includes('general') || channel.name.includes('welcome') || channel.name.includes('lobby'))
      );

      if (generalChannels.size > 0) {
        targetChannel = generalChannels.first();
      } else {
        // Fall back to first available text channel
        targetChannel = guild.channels.cache.find(channel => 
          channel.type === 0 && // Text channel
          channel.permissionsFor(guild.members.me)?.has('CreateInstantInvite')
        );
      }

      if (!targetChannel) {
        logError(`No suitable channel found to create invite in ${guild.name}`);
        return null;
      }

      // Create permanent invite (or as permanent as possible)
      const invite = await targetChannel.createInvite({
        maxAge: 0, // Permanent
        maxUses: 0, // Unlimited uses
        unique: false, // Don't create a new invite if one exists
        reason: 'ProForwarder: Discord to Telegram source link'
      });

      return invite;
    } catch (error) {
      logError(`Error creating invite for ${guild.name}:`, error);
      return null;
    }
  }

  /**
   * Validate and refresh expired invites
   */
  async validateInvites() {
    const now = Date.now();
    let refreshed = 0;

    for (const [guildId, inviteData] of this.inviteCache.entries()) {
      // Skip vanity URLs - they don't expire
      if (inviteData.isVanity) continue;

      // Check if invite has expired
      if (inviteData.expiresAt && inviteData.expiresAt <= now) {
        try {
          const guild = this.client.guilds.cache.get(guildId);
          if (guild) {
            logInfo(`Refreshing expired invite for ${guild.name}`);
            await this.getGuildInvite(guild); // This will create a new one
            refreshed++;
          } else {
            // Guild no longer accessible, remove from cache
            this.inviteCache.delete(guildId);
          }
        } catch (error) {
          logError(`Error refreshing invite for guild ${guildId}:`, error);
        }
      }
    }

    if (refreshed > 0) {
      await this.saveInvitesToConfig();
      logInfo(`Refreshed ${refreshed} expired Discord invites`);
    }
  }

  /**
   * Get cached invite count
   */
  getCacheSize() {
    return this.inviteCache.size;
  }

  /**
   * Clear all cached invites
   */
  clearCache() {
    this.inviteCache.clear();
    logInfo('Cleared Discord invite cache');
  }
}

module.exports = new DiscordInviteManager();