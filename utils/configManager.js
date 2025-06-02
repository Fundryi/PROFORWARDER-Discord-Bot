const fs = require('fs').promises;
const path = require('path');
const { logInfo, logSuccess, logError } = require('./logger');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'env.js');

// Cache for configs to avoid repeated file reads and logging
let configCache = null;
let lastConfigLoad = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Load and validate forward configurations from env.js
async function loadForwardConfigs(forceReload = false) {
  try {
    const now = Date.now();
    
    // Use cache if it's still valid and not forced reload
    if (!forceReload && configCache && (now - lastConfigLoad) < CACHE_DURATION) {
      return configCache;
    }
    
    // Clear require cache to get fresh config
    const configPath = require.resolve('../config/env');
    delete require.cache[configPath];
    
    const config = require('../config/env');
    
    if (!config) {
      logError('Failed to load config/env.js');
      return [];
    }
    
    if (!config.forwardConfigs || !Array.isArray(config.forwardConfigs)) {
      if (!configCache) { // Only log if first time
        logInfo('No forwardConfigs array found in env.js, using empty array');
      }
      configCache = [];
      lastConfigLoad = now;
      return [];
    }

    // Validate each config
    const validConfigs = [];
    for (const [index, configItem] of config.forwardConfigs.entries()) {
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

// Validate a single forward configuration
function validateForwardConfig(config, index) {
  const basicRequired = ['id', 'sourceType', 'sourceChannelId', 'targetType'];
  
  // Check basic required fields
  for (const field of basicRequired) {
    if (!config[field]) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  // Check target-specific required fields
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

  // Validate types
  if (typeof config.id !== 'number') {
    return { valid: false, error: 'id must be a number' };
  }

  if (typeof config.enabled !== 'undefined' && typeof config.enabled !== 'boolean') {
    return { valid: false, error: 'enabled must be a boolean' };
  }

  // Check for duplicate IDs
  return { valid: true };
}

// Get active forward configurations for a specific source channel
async function getForwardConfigsForChannel(sourceChannelId) {
  const configs = await loadForwardConfigs();
  return configs.filter(config => 
    config.sourceChannelId === sourceChannelId && 
    (config.enabled !== false) // Default to enabled if not specified
  );
}

// Get all active forward configurations
async function getAllActiveForwardConfigs() {
  const configs = await loadForwardConfigs();
  return configs.filter(config => config.enabled !== false);
}

// Get a specific config by ID
async function getForwardConfigById(configId) {
  const configs = await loadForwardConfigs();
  return configs.find(config => config.id === configId);
}

// Add a new forward configuration to env.js
async function addForwardConfig(newConfig) {
  try {
    // Read current env.js content
    const envContent = await fs.readFile(CONFIG_PATH, 'utf8');
    
    // Load current configs to check for duplicate IDs (force reload)
    const currentConfigs = await loadForwardConfigs(true);
    
    // Generate new ID
    const maxId = currentConfigs.length > 0 ? Math.max(...currentConfigs.map(c => c.id)) : 0;
    newConfig.id = maxId + 1;
    newConfig.enabled = true;
    
    // Check for duplicate source->target combinations
    const duplicate = currentConfigs.find(config => {
      if (config.sourceChannelId !== newConfig.sourceChannelId) return false;
      
      if (config.targetType === 'telegram' && newConfig.targetType === 'telegram') {
        return config.targetChatId === newConfig.targetChatId;
      } else if (config.targetType === 'discord' && newConfig.targetType === 'discord') {
        return config.targetChannelId === newConfig.targetChannelId &&
               config.targetServerId === newConfig.targetServerId;
      }
      
      return false;
    });
    
    if (duplicate) {
      throw new Error('Forward configuration already exists for this source->target combination');
    }

    // Format the new config as a JavaScript object string
    const configString = formatConfigObject(newConfig);
    
    // Find the forwardConfigs array and add the new config
    let updatedContent;
    
    // Check if array is empty (only comments)
    if (envContent.includes('forwardConfigs: [') && envContent.includes('// }')) {
      // Empty array with examples, replace the entire array
      updatedContent = envContent.replace(
        /forwardConfigs: \[\s*\/\/[^]*?\s*\]/s,
        `forwardConfigs: [\n    ${configString}\n  ]`
      );
    } else if (envContent.includes('forwardConfigs: [') && !envContent.includes('forwardConfigs: []')) {
      // Array has existing configs, add to the end before closing bracket
      // Look specifically for the forwardConfigs array closing bracket
      const forwardConfigsMatch = envContent.match(/(forwardConfigs: \[[^]*?)(\n\s*\],)/s);
      if (forwardConfigsMatch) {
        const beforeClosing = forwardConfigsMatch[1];
        const closingBracket = forwardConfigsMatch[2];
        updatedContent = envContent.replace(
          forwardConfigsMatch[0],
          `${beforeClosing},\n    ${configString}${closingBracket}`
        );
      } else {
        // Fallback: try to find the closing bracket more carefully
        updatedContent = envContent.replace(
          /(forwardConfigs: \[[^]*?)(\n\s*\])/s,
          `$1,\n    ${configString}$2`
        );
      }
    } else {
      // Completely empty array or no array
      updatedContent = envContent.replace(
        /forwardConfigs: \[\s*\]/,
        `forwardConfigs: [\n    ${configString}\n  ]`
      );
    }

    // Write back to file
    await fs.writeFile(CONFIG_PATH, updatedContent, 'utf8');
    
    logSuccess(`Added forward config ${newConfig.id} to env.js`);
    return newConfig.id;
  } catch (error) {
    logError('Error adding forward config:', error);
    throw error;
  }
}

// Remove a forward configuration (by setting enabled: false)
async function disableForwardConfig(configId) {
  try {
    const envContent = await fs.readFile(CONFIG_PATH, 'utf8');
    
    // Find and update the specific config
    const configRegex = new RegExp(`(\\{[^}]*id:\\s*${configId}[^}]*)(enabled:\\s*true)([^}]*\\})`, 'g');
    let updatedContent = envContent.replace(configRegex, '$1enabled: false$3');
    
    // If enabled wasn't there, add it
    if (updatedContent === envContent) {
      const addEnabledRegex = new RegExp(`(\\{[^}]*id:\\s*${configId}[^}]*)(\\s*\\})`, 'g');
      updatedContent = envContent.replace(addEnabledRegex, '$1,\n      enabled: false$2');
    }

    await fs.writeFile(CONFIG_PATH, updatedContent, 'utf8');
    
    logSuccess(`Disabled forward config ${configId} in env.js`);
    return true;
  } catch (error) {
    logError('Error disabling forward config:', error);
    throw error;
  }
}

// Get default AI configuration for new forward configs
function getDefaultAIConfig() {
  return {
    enabled: false, // Disabled by default
    translation: {
      enabled: false,
      targetLanguages: ['ru', 'zh'], // Default to Russian and Chinese
      createThreads: true,
      provider: 'gemini', // Default to Google Gemini AI
      preserveFormatting: true,
      notifyTranslations: false
    },
    contentOptimization: {
      enabled: false, // Disabled by default (requires paid OpenAI)
      level: 'enhanced',
      platformSpecific: false
    }
  };
}

// Format a config object as a string for insertion into env.js
function formatConfigObject(config) {
  const lines = ['{'];
  
  lines.push(`      id: ${config.id},`);
  if (config.name) lines.push(`      name: "${config.name}",`);
  lines.push(`      sourceType: "${config.sourceType}",`);
  if (config.sourceServerId) lines.push(`      sourceServerId: "${config.sourceServerId}",`);
  lines.push(`      sourceChannelId: "${config.sourceChannelId}",`);
  lines.push(`      targetType: "${config.targetType}",`);
  
  // Add target-specific fields
  if (config.targetType === 'telegram') {
    lines.push(`      targetChatId: "${config.targetChatId}",`);
  } else if (config.targetType === 'discord') {
    if (config.targetServerId) lines.push(`      targetServerId: "${config.targetServerId}",`);
    lines.push(`      targetChannelId: "${config.targetChannelId}",`);
  }
  lines.push(`      enabled: true,`);
  if (config.allowEveryoneHereMentions !== undefined) {
    lines.push(`      allowEveryoneHereMentions: ${config.allowEveryoneHereMentions},`);
  }
  if (config.createdBy) lines.push(`      createdBy: "${config.createdBy}",`);
  
  // Add default AI configuration for new configs
  lines.push(`      `);
  lines.push(`      // AI Translation Configuration (customize as needed)`);
  lines.push(`      ai: {`);
  lines.push(`        enabled: false, // Set to true to enable AI features`);
  lines.push(`        translation: {`);
  lines.push(`          enabled: false, // Enable translation`);
  lines.push(`          targetLanguages: ['ru', 'zh'], // Languages to translate to (Russian, Chinese)`);
  lines.push(`          createThreads: true, // Create Discord threads for translations`);
  lines.push(`          provider: 'gemini', // 'gemini' (free AI), 'google' (free fallback)`);
  lines.push(`          preserveFormatting: true, // Keep Discord formatting`);
  lines.push(`          notifyTranslations: false // Notification when translations complete`);
  lines.push(`        },`);
  lines.push(`        contentOptimization: {`);
  lines.push(`          enabled: false, // Enable content optimization (requires OpenAI)`);
  lines.push(`          level: 'enhanced', // 'basic', 'enhanced', 'custom'`);
  lines.push(`          platformSpecific: false // Optimize for target platform`);
  lines.push(`        }`);
  lines.push(`      }`);
  
  lines.push('    }');
  
  return lines.join('\n    ');
}

// Get configuration statistics
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

// Auto-publish configuration management
async function getAutoPublishConfig() {
  try {
    // Clear require cache to get fresh config
    const configPath = require.resolve('../config/env');
    delete require.cache[configPath];
    
    const config = require('../config/env');
    return config.autoPublishChannels || {};
  } catch (error) {
    logError('Error loading auto-publish config:', error);
    return {};
  }
}

async function toggleAutoPublishChannel(serverId, channelId) {
  try {
    const envContent = await fs.readFile(CONFIG_PATH, 'utf8');
    const currentConfig = await getAutoPublishConfig();
    
    // Initialize server array if it doesn't exist
    if (!currentConfig[serverId]) {
      currentConfig[serverId] = [];
    }
    
    const channelIndex = currentConfig[serverId].indexOf(channelId);
    let isEnabled;
    
    if (channelIndex === -1) {
      // Add channel to auto-publish list
      currentConfig[serverId].push(channelId);
      isEnabled = true;
    } else {
      // Remove channel from auto-publish list
      currentConfig[serverId].splice(channelIndex, 1);
      
      // Remove server key if no channels left
      if (currentConfig[serverId].length === 0) {
        delete currentConfig[serverId];
      }
      isEnabled = false;
    }
    
    // Format the auto-publish config for the file
    const autoPublishConfigString = formatAutoPublishConfig(currentConfig);
    
    let updatedContent;
    
    // Check if autoPublishChannels already exists in the file
    if (envContent.includes('autoPublishChannels:')) {
      // Replace existing autoPublishChannels
      updatedContent = envContent.replace(
        /autoPublishChannels:\s*\{[^}]*\}/s,
        `autoPublishChannels: ${autoPublishConfigString}`
      );
    } else {
      // Add autoPublishChannels after forwardConfigs
      const insertPoint = envContent.indexOf('  // Telegram integration');
      if (insertPoint !== -1) {
        updatedContent = envContent.slice(0, insertPoint) +
          `  // Auto-publish channels configuration\n` +
          `  // Channels configured for automatic publishing of announcements\n` +
          `  autoPublishChannels: ${autoPublishConfigString},\n\n  ` +
          envContent.slice(insertPoint + 2);
      } else {
        // Fallback: add before the closing brace
        updatedContent = envContent.replace(
          /(\n\s*};?\s*)$/,
          `,\n\n  // Auto-publish channels configuration\n  autoPublishChannels: ${autoPublishConfigString}$1`
        );
      }
    }
    
    await fs.writeFile(CONFIG_PATH, updatedContent, 'utf8');
    
    logSuccess(`Auto-publish ${isEnabled ? 'enabled' : 'disabled'} for channel ${channelId} in server ${serverId}`);
    return { enabled: isEnabled, serverId, channelId };
    
  } catch (error) {
    logError('Error toggling auto-publish channel:', error);
    throw error;
  }
}

function formatAutoPublishConfig(config) {
  if (Object.keys(config).length === 0) {
    return '{}';
  }
  
  const lines = ['{'];
  
  for (const [serverId, channels] of Object.entries(config)) {
    if (channels.length > 0) {
      const channelList = channels.map(id => `"${id}"`).join(', ');
      lines.push(`    "${serverId}": [${channelList}],`);
    }
  }
  
  // Remove trailing comma from last line
  if (lines.length > 1) {
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
  }
  
  lines.push('  }');
  return lines.join('\n  ');
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

module.exports = {
  loadForwardConfigs,
  getForwardConfigsForChannel,
  getAllActiveForwardConfigs,
  getForwardConfigById,
  addForwardConfig,
  disableForwardConfig,
  getConfigStats,
  getAutoPublishConfig,
  toggleAutoPublishChannel,
  isChannelAutoPublishEnabled
};
