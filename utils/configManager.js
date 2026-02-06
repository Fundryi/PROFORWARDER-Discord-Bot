const fs = require('fs').promises;
const path = require('path');
const { logInfo, logSuccess, logError } = require('./logger');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'env.js');

// Cache for configs to avoid repeated file reads and logging
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
  await acquireWriteLock();
  try {
    // Read current env.js content
    const envContent = await fs.readFile(CONFIG_PATH, 'utf8');
    
    // Load current configs to check for duplicate IDs (force reload)
    const currentConfigs = await loadForwardConfigs(true);
    
    // Generate new ID
    const maxId = currentConfigs.length > 0 ? Math.max(...currentConfigs.map(c => c.id)) : 0;
    newConfig.id = maxId + 1;
    newConfig.enabled = true;
    
    // Check for exact duplicate configurations only (same source AND same target)
    const exactDuplicate = currentConfigs.find(config => {
      // Must match source
      if (config.sourceChannelId !== newConfig.sourceChannelId) return false;
      if (config.sourceServerId !== newConfig.sourceServerId) return false;
      
      // Must match target exactly
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

    // Format the new config as a JavaScript object string
    const configString = formatConfigObject(newConfig);
    
    // Find the forwardConfigs array and add the new config
    let updatedContent;
    const arrayRange = findForwardConfigsArrayRange(envContent);
    if (!arrayRange) {
      throw new Error('forwardConfigs array not found in env.js');
    }

    const arrayText = envContent.slice(arrayRange.start, arrayRange.end + 1);
    const updatedArrayText = appendConfigToArrayText(arrayText, configString);
    updatedContent =
      envContent.slice(0, arrayRange.start) +
      updatedArrayText +
      envContent.slice(arrayRange.end + 1);

    // Write back to file
    await fs.writeFile(CONFIG_PATH, updatedContent, 'utf8');

    // Invalidate cache so new config is immediately available
    invalidateCache();

    logSuccess(`Added forward config ${newConfig.id} to env.js`);
    return newConfig.id;
  } catch (error) {
    logError('Error adding forward config:', error);
    throw error;
  } finally {
    releaseWriteLock();
  }
}

function setTopLevelBooleanProperty(objectText, propertyName, value) {
  let inString = false;
  let stringChar = '';
  let escape = false;
  let depth = 0;

  const keyPattern = new RegExp(`\\b${propertyName}\\b`);

  for (let i = 0; i < objectText.length; i++) {
    const ch = objectText[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '{') {
      depth++;
      continue;
    }

    if (ch === '}') {
      depth--;
      continue;
    }

    if (depth !== 1) continue;

    const rest = objectText.slice(i);
    if (!keyPattern.test(rest.slice(0, propertyName.length + 1))) continue;
    if (!rest.startsWith(propertyName)) continue;

    const prevChar = i > 0 ? objectText[i - 1] : '';
    if (prevChar && /[a-zA-Z0-9_$]/.test(prevChar)) continue;

    let cursor = i + propertyName.length;
    while (cursor < objectText.length && /\s/.test(objectText[cursor])) cursor++;
    if (objectText[cursor] !== ':') continue;
    cursor++;
    while (cursor < objectText.length && /\s/.test(objectText[cursor])) cursor++;
    const valueStart = cursor;

    let valueInString = false;
    let valueStringChar = '';
    let valueEscape = false;
    let localDepth = 1;
    let valueEnd = valueStart;

    for (let j = valueStart; j < objectText.length; j++) {
      const valueChar = objectText[j];

      if (valueInString) {
        if (valueEscape) {
          valueEscape = false;
        } else if (valueChar === '\\') {
          valueEscape = true;
        } else if (valueChar === valueStringChar) {
          valueInString = false;
          valueStringChar = '';
        }
        continue;
      }

      if (valueChar === '"' || valueChar === "'" || valueChar === '`') {
        valueInString = true;
        valueStringChar = valueChar;
        continue;
      }

      if (valueChar === '{' || valueChar === '[' || valueChar === '(') {
        localDepth++;
        continue;
      }

      if (valueChar === '}' || valueChar === ']' || valueChar === ')') {
        localDepth--;
        if (localDepth === 0 && valueChar === '}') {
          valueEnd = j;
          break;
        }
        continue;
      }

      if (valueChar === ',' && localDepth === 1) {
        valueEnd = j;
        break;
      }
    }

    if (valueEnd === valueStart) {
      valueEnd = objectText.length - 1;
    }

    return objectText.slice(0, valueStart) + String(value) + objectText.slice(valueEnd);
  }

  const closingBraceIndex = objectText.lastIndexOf('}');
  if (closingBraceIndex === -1) {
    return objectText;
  }

  const beforeBrace = objectText.slice(0, closingBraceIndex);
  const trimmedBeforeBrace = beforeBrace.trimEnd();
  const needsComma = !trimmedBeforeBrace.endsWith('{') && !trimmedBeforeBrace.endsWith(',');
  const insertion = `${needsComma ? ',' : ''}\n      ${propertyName}: ${value}\n    `;
  return objectText.slice(0, closingBraceIndex) + insertion + objectText.slice(closingBraceIndex);
}

async function setForwardConfigEnabled(configId, enabled) {
  await acquireWriteLock();
  try {
    const envContent = await fs.readFile(CONFIG_PATH, 'utf8');
    const arrayRange = findForwardConfigsArrayRange(envContent);
    if (!arrayRange) {
      throw new Error('forwardConfigs array not found in env.js');
    }

    const arrayText = envContent.slice(arrayRange.start, arrayRange.end + 1);
    const objectRange = findConfigObjectRange(arrayText, configId);
    if (!objectRange) {
      throw new Error(`Configuration ${configId} not found`);
    }

    const objectText = arrayText.slice(objectRange.start, objectRange.end);
    const updatedObjectText = setTopLevelBooleanProperty(objectText, 'enabled', enabled ? 'true' : 'false');
    const updatedArrayText =
      arrayText.slice(0, objectRange.start) +
      updatedObjectText +
      arrayText.slice(objectRange.end);
    const updatedContent =
      envContent.slice(0, arrayRange.start) +
      updatedArrayText +
      envContent.slice(arrayRange.end + 1);

    await fs.writeFile(CONFIG_PATH, updatedContent, 'utf8');

    // Invalidate cache so change is immediately visible
    invalidateCache();

    logSuccess(`${enabled ? 'Enabled' : 'Disabled'} forward config ${configId} in env.js`);
    return true;
  } catch (error) {
    logError(`Error ${enabled ? 'enabling' : 'disabling'} forward config:`, error);
    throw error;
  } finally {
    releaseWriteLock();
  }
}

// Remove a forward configuration (by setting enabled: false)
async function disableForwardConfig(configId) {
  return setForwardConfigEnabled(configId, false);
}

// Enable a forward configuration (set enabled: true)
async function enableForwardConfig(configId) {
  return setForwardConfigEnabled(configId, true);
}

// Remove a forward configuration from env.js entirely
async function removeForwardConfig(configId) {
  await acquireWriteLock();
  try {
    const envContent = await fs.readFile(CONFIG_PATH, 'utf8');

    const arrayRange = findForwardConfigsArrayRange(envContent);
    if (!arrayRange) {
      throw new Error('forwardConfigs array not found in env.js');
    }

    const arrayText = envContent.slice(arrayRange.start, arrayRange.end + 1);
    const objectRange = findConfigObjectRange(arrayText, configId);
    if (!objectRange) {
      throw new Error(`Configuration ${configId} not found`);
    }

    const updatedArrayText = removeObjectFromArrayText(arrayText, objectRange.start, objectRange.end);
    const updatedContent =
      envContent.slice(0, arrayRange.start) +
      updatedArrayText +
      envContent.slice(arrayRange.end + 1);

    await fs.writeFile(CONFIG_PATH, updatedContent, 'utf8');

    // Invalidate cache so change is immediately visible
    invalidateCache();

    logSuccess(`Removed forward config ${configId} from env.js`);
    return true;
  } catch (error) {
    logError('Error removing forward config:', error);
    throw error;
  } finally {
    releaseWriteLock();
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
  await acquireWriteLock();
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

    // Invalidate cache so change is immediately visible
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

function findForwardConfigsArrayRange(content) {
  const keyIndex = content.indexOf('forwardConfigs');
  if (keyIndex === -1) return null;

  const arrayStart = content.indexOf('[', keyIndex);
  if (arrayStart === -1) return null;

  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escape = false;

  for (let i = arrayStart; i < content.length; i++) {
    const ch = content[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return { start: arrayStart, end: i };
      }
    }
  }

  return null;
}

function findConfigObjectRange(arrayText, configId) {
  let inString = false;
  let stringChar = '';
  let escape = false;
  let braceDepth = 0;
  let objectStart = null;

  for (let i = 0; i < arrayText.length; i++) {
    const ch = arrayText[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '{') {
      if (braceDepth === 0) {
        objectStart = i;
      }
      braceDepth++;
      continue;
    }

    if (ch === '}') {
      braceDepth--;
      if (braceDepth === 0 && objectStart !== null) {
        const objectText = arrayText.slice(objectStart, i + 1);
        const idPattern = new RegExp(`\\bid\\s*:\\s*${configId}\\b`);
        if (idPattern.test(objectText)) {
          return { start: objectStart, end: i + 1 };
        }
        objectStart = null;
      }
    }
  }

  return null;
}

function removeObjectFromArrayText(arrayText, objectStart, objectEnd) {
  let start = objectStart;
  let end = objectEnd;

  let j = end;
  while (j < arrayText.length && /\s/.test(arrayText[j])) {
    j++;
  }
  if (arrayText[j] === ',') {
    end = j + 1;
    while (end < arrayText.length && /\s/.test(arrayText[end])) {
      end++;
    }
  } else {
    let i = start - 1;
    while (i >= 0 && /\s/.test(arrayText[i])) {
      i--;
    }
    if (arrayText[i] === ',') {
      start = i;
    }
  }

  return arrayText.slice(0, start) + arrayText.slice(end);
}

function appendConfigToArrayText(arrayText, configString) {
  const inner = arrayText.slice(1, -1);
  const innerTrimmed = inner.trim();

  if (!innerTrimmed) {
    return `[\n    ${configString}\n  ]`;
  }

  const trailingWhitespaceMatch = inner.match(/\s*$/);
  const trailingWhitespace = trailingWhitespaceMatch ? trailingWhitespaceMatch[0] : '';
  const innerWithoutTrailing = inner.slice(0, inner.length - trailingWhitespace.length);
  const innerTrimRight = innerWithoutTrailing.replace(/\s*$/, '');
  const needsComma = !innerTrimRight.endsWith(',');
  const separator = needsComma ? ',' : '';

  return `[` +
    innerWithoutTrailing +
    separator +
    `\n    ${configString}` +
    trailingWhitespace +
    `]`;
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
  toggleAutoPublishChannel,
  isChannelAutoPublishEnabled
};
