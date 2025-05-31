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
  const required = ['id', 'sourceType', 'sourceChannelId', 'targetType', 'targetChannelId'];
  
  for (const field of required) {
    if (!config[field]) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
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
    const duplicate = currentConfigs.find(config => 
      config.sourceChannelId === newConfig.sourceChannelId &&
      config.targetChannelId === newConfig.targetChannelId &&
      config.targetServerId === newConfig.targetServerId
    );
    
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
      updatedContent = envContent.replace(
        /(\s*)\]/,
        `,\n    \n    ${configString}\n  ]`
      );
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
  if (config.targetServerId) lines.push(`      targetServerId: "${config.targetServerId}",`);
  lines.push(`      targetChannelId: "${config.targetChannelId}",`);
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

module.exports = {
  loadForwardConfigs,
  getForwardConfigsForChannel,
  getAllActiveForwardConfigs,
  getForwardConfigById,
  addForwardConfig,
  disableForwardConfig,
  getConfigStats
};