const fs = require('fs').promises;
const path = require('path');
const { logInfo, logSuccess, logError } = require('./logger');

// ─── File paths ───
const FORWARD_CONFIGS_PATH = path.join(__dirname, '..', 'config', 'forwardConfigs.json');
const AUTO_PUBLISH_PATH = path.join(__dirname, '..', 'config', 'autoPublish.json');
const CACHED_INVITES_PATH = path.join(__dirname, '..', 'config', 'cachedInvites.json');

// Cache for configs to avoid repeated file reads
let configCache = null;
let lastConfigLoad = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Simple write lock to prevent concurrent modifications
let isWriting = false;
const writeQueue = [];

async function acquireWriteLock() {
  if (!isWriting) {
    isWriting = true;
    return;
  }

  // Wait in queue
  return new Promise((resolve) => {
    writeQueue.push(resolve);
  });
}

function releaseWriteLock() {
  if (writeQueue.length > 0) {
    const next = writeQueue.shift();
    next();
  } else {
    isWriting = false;
  }
}

// Invalidate cache (call after writes)
function invalidateCache() {
  configCache = null;
  lastConfigLoad = 0;
}

// ─── JSON file helpers ───

async function readJsonFile(filePath, defaultValue) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist — return default and create it
      await writeJsonFile(filePath, defaultValue);
      return defaultValue;
    }
    logError(`Error reading ${path.basename(filePath)}:`, error.message);
    return defaultValue;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── Forward config validation ───

function validateForwardConfig(config, index) {
  const basicRequired = ['id', 'sourceType', 'sourceChannelId', 'targetType'];

  for (const field of basicRequired) {
    if (!config[field]) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  if (config.targetType === 'telegram') {
    if (!config.targetChatId) {
      return { valid: false, error: 'Missing required field for Telegram: targetChatId' };
    }
  } else if (config.targetType === 'discord') {
    if (!config.targetChannelId) {
      return { valid: false, error: 'Missing required field for Discord: targetChannelId' };
    }
  } else {
    return { valid: false, error: `Unsupported target type: ${config.targetType}` };
  }

  if (typeof config.id !== 'number') {
    return { valid: false, error: 'id must be a number' };
  }

  if (typeof config.enabled !== 'undefined' && typeof config.enabled !== 'boolean') {
    return { valid: false, error: 'enabled must be a boolean' };
  }

  return { valid: true };
}

// ─── Forward config CRUD ───

async function loadForwardConfigs(forceReload = false) {
  try {
    const now = Date.now();

    // Use cache if still valid and not forced
    if (!forceReload && configCache && (now - lastConfigLoad) < CACHE_DURATION) {
      return configCache;
    }

    const rawConfigs = await readJsonFile(FORWARD_CONFIGS_PATH, []);

    if (!Array.isArray(rawConfigs)) {
      logError('forwardConfigs.json does not contain an array, using empty array');
      configCache = [];
      lastConfigLoad = now;
      return [];
    }

    // Validate each config
    const validConfigs = [];
    for (const [index, configItem] of rawConfigs.entries()) {
      if (!configItem || typeof configItem !== 'object') {
        logError(`Invalid forward config at index ${index}: empty entry`);
        continue;
      }
      const validation = validateForwardConfig(configItem, index);
      if (validation.valid) {
        validConfigs.push(configItem);
      } else {
        logError(`Invalid forward config at index ${index}: ${validation.error}`);
      }
    }

    // Only log if configs changed or first load
    if (!configCache || configCache.length !== validConfigs.length) {
      logInfo(`Loaded ${validConfigs.length} valid forward configurations`);
    }

    configCache = validConfigs;
    lastConfigLoad = now;
    return validConfigs;
  } catch (error) {
    logError('Error loading forward configs:', error.message);
    return configCache || [];
  }
}

async function getForwardConfigsForChannel(sourceChannelId) {
  const configs = await loadForwardConfigs();
  return configs.filter(config =>
    config.sourceChannelId === sourceChannelId &&
    (config.enabled !== false)
  );
}

async function getAllActiveForwardConfigs() {
  const configs = await loadForwardConfigs();
  return configs.filter(config => config.enabled !== false);
}

async function getForwardConfigById(configId) {
  const configs = await loadForwardConfigs();
  return configs.find(config => config.id === configId);
}

async function addForwardConfig(newConfig) {
  await acquireWriteLock();
  try {
    const configs = await loadForwardConfigs(true);

    // Generate new ID
    const maxId = configs.length > 0 ? Math.max(...configs.map(c => c.id)) : 0;
    newConfig.id = maxId + 1;
    newConfig.enabled = true;

    // Check for exact duplicate
    const exactDuplicate = configs.find(config => {
      if (config.sourceChannelId !== newConfig.sourceChannelId) return false;
      if (config.sourceServerId !== newConfig.sourceServerId) return false;
      if (config.targetType !== newConfig.targetType) return false;

      if (config.targetType === 'telegram') {
        return config.targetChatId === newConfig.targetChatId;
      } else if (config.targetType === 'discord') {
        return config.targetChannelId === newConfig.targetChannelId &&
               config.targetServerId === newConfig.targetServerId;
      }

      return false;
    });

    if (exactDuplicate) {
      throw new Error('Exact duplicate configuration already exists (same source and same target)');
    }

    // Add default AI config if not present
    if (!newConfig.ai) {
      newConfig.ai = getDefaultAIConfig();
    }

    configs.push(newConfig);

    await writeJsonFile(FORWARD_CONFIGS_PATH, configs);
    invalidateCache();

    logSuccess(`Added forward config ${newConfig.id} to forwardConfigs.json`);
    return newConfig.id;
  } catch (error) {
    logError('Error adding forward config:', error);
    throw error;
  } finally {
    releaseWriteLock();
  }
}

async function setForwardConfigEnabled(configId, enabled) {
  await acquireWriteLock();
  try {
    const configs = await loadForwardConfigs(true);
    const config = configs.find(c => c.id === configId);

    if (!config) {
      throw new Error(`Configuration ${configId} not found`);
    }

    config.enabled = enabled;

    await writeJsonFile(FORWARD_CONFIGS_PATH, configs);
    invalidateCache();

    logSuccess(`${enabled ? 'Enabled' : 'Disabled'} forward config ${configId}`);
    return true;
  } catch (error) {
    logError(`Error ${enabled ? 'enabling' : 'disabling'} forward config:`, error);
    throw error;
  } finally {
    releaseWriteLock();
  }
}

async function disableForwardConfig(configId) {
  return setForwardConfigEnabled(configId, false);
}

async function enableForwardConfig(configId) {
  return setForwardConfigEnabled(configId, true);
}

async function removeForwardConfig(configId) {
  await acquireWriteLock();
  try {
    const configs = await loadForwardConfigs(true);
    const index = configs.findIndex(c => c.id === configId);

    if (index === -1) {
      throw new Error(`Configuration ${configId} not found`);
    }

    configs.splice(index, 1);

    await writeJsonFile(FORWARD_CONFIGS_PATH, configs);
    invalidateCache();

    logSuccess(`Removed forward config ${configId} from forwardConfigs.json`);
    return true;
  } catch (error) {
    logError('Error removing forward config:', error);
    throw error;
  } finally {
    releaseWriteLock();
  }
}

// ─── Default AI config for new forwards ───

function getDefaultAIConfig() {
  return {
    enabled: false,
    translation: {
      enabled: false,
      targetLanguages: ['ru', 'zh'],
      createThreads: true,
      provider: 'gemini',
      preserveFormatting: true,
      notifyTranslations: false
    },
    contentOptimization: {
      enabled: false,
      level: 'enhanced',
      platformSpecific: false
    }
  };
}

// ─── Config statistics ───

async function getConfigStats() {
  try {
    const configs = await loadForwardConfigs();
    const activeConfigs = configs.filter(c => c.enabled !== false);

    return {
      total: configs.length,
      active: activeConfigs.length,
      disabled: configs.length - activeConfigs.length,
      sameServer: activeConfigs.filter(c => c.sourceServerId === c.targetServerId).length,
      crossServer: activeConfigs.filter(c => c.sourceServerId !== c.targetServerId).length
    };
  } catch (error) {
    logError('Error getting config stats:', error);
    return { total: 0, active: 0, disabled: 0, sameServer: 0, crossServer: 0 };
  }
}

// ─── Auto-publish management ───

async function getAutoPublishConfig() {
  try {
    return await readJsonFile(AUTO_PUBLISH_PATH, {});
  } catch (error) {
    logError('Error loading auto-publish config:', error);
    return {};
  }
}

async function toggleAutoPublishChannel(serverId, channelId) {
  const currentConfig = await getAutoPublishConfig();
  const isCurrentlyEnabled = currentConfig[serverId]?.includes(channelId) || false;
  return setAutoPublishChannelEnabled(serverId, channelId, !isCurrentlyEnabled);
}

async function setAutoPublishChannelEnabled(serverId, channelId, enabled) {
  await acquireWriteLock();
  try {
    const currentConfig = await readJsonFile(AUTO_PUBLISH_PATH, {});

    if (!currentConfig[serverId]) {
      currentConfig[serverId] = [];
    }

    const channelIndex = currentConfig[serverId].indexOf(channelId);
    let isEnabled = enabled === true;

    if (enabled === true) {
      if (channelIndex === -1) {
        currentConfig[serverId].push(channelId);
      }
    } else {
      if (channelIndex !== -1) {
        currentConfig[serverId].splice(channelIndex, 1);
      }
      if (currentConfig[serverId].length === 0) {
        delete currentConfig[serverId];
      }
    }

    await writeJsonFile(AUTO_PUBLISH_PATH, currentConfig);
    invalidateCache();

    logSuccess(`Auto-publish ${isEnabled ? 'enabled' : 'disabled'} for channel ${channelId} in server ${serverId}`);
    return { enabled: isEnabled, serverId, channelId };
  } catch (error) {
    logError('Error toggling auto-publish channel:', error);
    throw error;
  } finally {
    releaseWriteLock();
  }
}

async function isChannelAutoPublishEnabled(serverId, channelId) {
  try {
    const config = await getAutoPublishConfig();
    return config[serverId]?.includes(channelId) || false;
  } catch (error) {
    logError('Error checking auto-publish status:', error);
    return false;
  }
}

// ─── Migration: extract dynamic data from config.js to JSON files ───

async function migrateToJsonConfigs() {
  try {
    // Check if already migrated (forwardConfigs.json exists and is non-empty or config.js has no forwardConfigs)
    let alreadyMigrated = false;
    try {
      await fs.access(FORWARD_CONFIGS_PATH);
      alreadyMigrated = true;
    } catch (_e) {
      // File doesn't exist — need to migrate
    }

    if (alreadyMigrated) {
      return; // Already migrated, nothing to do
    }

    logInfo('Migrating dynamic config data from config.js to JSON files...');

    // Load current config.js
    const configPath = require.resolve('../config/config');
    delete require.cache[configPath];
    const config = require('../config/config');

    // Migrate forwardConfigs
    const forwardConfigs = Array.isArray(config.forwardConfigs) ? config.forwardConfigs : [];
    await writeJsonFile(FORWARD_CONFIGS_PATH, forwardConfigs);
    logSuccess(`Migrated ${forwardConfigs.length} forward config(s) to forwardConfigs.json`);

    // Migrate autoPublishChannels
    const autoPublish = config.autoPublishChannels && typeof config.autoPublishChannels === 'object'
      ? config.autoPublishChannels
      : {};
    await writeJsonFile(AUTO_PUBLISH_PATH, autoPublish);
    logSuccess(`Migrated auto-publish config to autoPublish.json`);

    // Migrate cachedInvites
    const cachedInvites = config.discord?.cachedInvites && typeof config.discord.cachedInvites === 'object'
      ? config.discord.cachedInvites
      : {};
    await writeJsonFile(CACHED_INVITES_PATH, cachedInvites);
    logSuccess(`Migrated cached invites to cachedInvites.json`);

    logSuccess('Config migration complete. You can now remove forwardConfigs, autoPublishChannels, and discord.cachedInvites from config/config.js.');
  } catch (error) {
    logError('Config migration failed:', error.message);
    logError('The bot will still work — forwardConfigs.json will be created on first use.');
  }
}

module.exports = {
  loadForwardConfigs,
  getForwardConfigsForChannel,
  getAllActiveForwardConfigs,
  getForwardConfigById,
  addForwardConfig,
  enableForwardConfig,
  disableForwardConfig,
  removeForwardConfig,
  getConfigStats,
  getAutoPublishConfig,
  setAutoPublishChannelEnabled,
  toggleAutoPublishChannel,
  isChannelAutoPublishEnabled,
  migrateToJsonConfigs,
  // Expose paths for other modules (e.g., discordInviteManager)
  CACHED_INVITES_PATH
};
