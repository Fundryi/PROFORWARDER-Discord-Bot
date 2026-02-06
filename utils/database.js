const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { logInfo, logSuccess, logError, formatUser } = require('./logger');

// Create data directory if it doesn't exist (sync to ensure it exists before DB opens)
const dataDir = path.join(__dirname, '..', 'data');
try {
  fs.mkdirSync(dataDir, { recursive: true });
} catch (err) {
  logError(`Error creating data directory: ${err.message}`);
  process.exit(1);
}

// Create database connection
const db = new sqlite3.Database(path.join(dataDir, 'proforwarder.db'), (err) => {
  if (err) {
    logError(`Error connecting to database: ${err.message}`);
    return;
  }
  logSuccess('SQLite database connection established');
  initializeDatabase();
});

// Promisify database operations
const run = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const get = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const exec = (sql) => {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

let messageLogsChainColumnsReady = false;
let messageLogsChainColumnsCheckPromise = null;

const close = () => {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

function getStartupLogMaintenanceOptions(overrides = {}) {
  const envConfig = require('../config/config');
  const config = envConfig.startupLogMaintenance || {};

  return {
    enabled: config.enabled !== false,
    batchSize: config.batchSize || 200,
    maxRuntimeMs: config.maxRuntimeMs || 2 * 60 * 1000,
    delayBetweenBatchesMs: config.delayBetweenBatchesMs || 250,
    retentionDays: config.retentionDays ?? 180,
    retentionAction: config.retentionAction || 'skip',
    debugMode: envConfig.debugMode,
    ...overrides
  };
}

function isDiscordMissingResourceError(error) {
  if (!error) return false;

  const code = Number(error.code);
  if (code === 10008 || code === 10003 || code === 10004) {
    return true;
  }

  const message = String(error.message || '').toLowerCase();
  return message.includes('unknown message')
    || message.includes('unknown channel')
    || message.includes('unknown guild');
}

async function getMessageLogsPage({ limit, beforeForwardedAt = null, beforeId = null, cutoffForwardedAt = null }) {
  const conditions = [];
  const params = [];

  if (cutoffForwardedAt !== null) {
    conditions.push('forwardedAt >= ?');
    params.push(cutoffForwardedAt);
  }

  if (beforeForwardedAt !== null && beforeId !== null) {
    conditions.push('(forwardedAt < ? OR (forwardedAt = ? AND id < ?))');
    params.push(beforeForwardedAt, beforeForwardedAt, beforeId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return await all(
    `SELECT * FROM message_logs ${whereClause} ORDER BY forwardedAt DESC, id DESC LIMIT ?`,
    [...params, limit]
  );
}

async function deleteOldMessageLogs(cutoffForwardedAt) {
  const result = await run(
    'DELETE FROM message_logs WHERE forwardedAt < ?',
    [cutoffForwardedAt]
  );
  return result.changes || 0;
}

async function ensureMessageLogsChainColumns() {
  if (messageLogsChainColumnsReady) return;
  if (messageLogsChainColumnsCheckPromise) {
    await messageLogsChainColumnsCheckPromise;
    return;
  }

  messageLogsChainColumnsCheckPromise = (async () => {
    const tableInfo = await all('PRAGMA table_info(message_logs)');
    const existingColumns = new Set((tableInfo || []).map(column => column.name));

    const requiredColumns = [
      { name: 'messageChain', ddl: 'TEXT' },
      { name: 'chainPosition', ddl: 'INTEGER DEFAULT 0' },
      { name: 'chainParentId', ddl: 'INTEGER' }
    ];

    for (const column of requiredColumns) {
      if (existingColumns.has(column.name)) continue;
      await run(`ALTER TABLE message_logs ADD COLUMN ${column.name} ${column.ddl}`);
      logInfo(`Added ${column.name} column to message_logs table`);
    }

    messageLogsChainColumnsReady = true;
  })();

  try {
    await messageLogsChainColumnsCheckPromise;
  } finally {
    messageLogsChainColumnsCheckPromise = null;
  }
}

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create bot settings table for global configuration
    await run(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);

    // Create message logs for tracking forwarded messages (enhanced for message chains)
    await run(`
      CREATE TABLE IF NOT EXISTS message_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        originalMessageId TEXT NOT NULL,
        originalChannelId TEXT NOT NULL,
        originalServerId TEXT,
        forwardedMessageId TEXT,
        forwardedChannelId TEXT,
        forwardedServerId TEXT,
        configId INTEGER NOT NULL, -- References config ID from config.js
        forwardedAt INTEGER NOT NULL,
        status TEXT DEFAULT 'success', -- 'success', 'failed', 'retry'
        errorMessage TEXT,
        messageChain TEXT, -- JSON array of message IDs for split messages
        chainPosition INTEGER DEFAULT 0, -- 0=primary, 1=secondary, etc.
        chainParentId INTEGER -- Reference to primary message log ID
      )
    `);

    // Create translation threads table for persistent thread tracking
    await run(`
      CREATE TABLE IF NOT EXISTS translation_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        forwardedMessageId TEXT NOT NULL,
        threadId TEXT NOT NULL,
        language TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        archived INTEGER DEFAULT 0
      )
    `);

    // Create indexes for common queries
    await run('CREATE INDEX IF NOT EXISTS idx_bot_settings_key ON bot_settings(key)');
    await run('CREATE INDEX IF NOT EXISTS idx_message_logs_original ON message_logs(originalMessageId, originalChannelId)');
    await run('CREATE INDEX IF NOT EXISTS idx_message_logs_config ON message_logs(configId, forwardedAt)');
    await run('CREATE INDEX IF NOT EXISTS idx_translation_threads_message ON translation_threads(forwardedMessageId)');
    await run('CREATE INDEX IF NOT EXISTS idx_translation_threads_thread ON translation_threads(threadId)');

    await ensureMessageLogsChainColumns();

    logSuccess('Database tables ready (forward configs now in config.js)');
  } catch (error) {
    logError('Error initializing database', error);
  }
}

// Bot settings operations
async function getBotSetting(key) {
  try {
    const setting = await get('SELECT value FROM bot_settings WHERE key = ?', [key]);
    return setting ? setting.value : null;
  } catch (error) {
    logError('Error getting bot setting:', error);
    throw error;
  }
}

async function setBotSetting(key, value) {
  try {
    await run(
      'INSERT OR REPLACE INTO bot_settings (key, value, updatedAt) VALUES (?, ?, ?)',
      [key, value, Date.now()]
    );
    return true;
  } catch (error) {
    logError('Error setting bot setting:', error);
    throw error;
  }
}

async function getAllBotSettings() {
  try {
    return await all('SELECT * FROM bot_settings ORDER BY key');
  } catch (error) {
    logError('Error getting all bot settings:', error);
    throw error;
  }
}


// Message logging operations
async function logForwardedMessage(originalMessageId, originalChannelId, originalServerId, forwardedMessageId, forwardedChannelId, forwardedServerId, configId, status = 'success', errorMessage = null) {
  try {
    await run(
      `INSERT INTO message_logs (originalMessageId, originalChannelId, originalServerId, forwardedMessageId, forwardedChannelId, forwardedServerId, configId, forwardedAt, status, errorMessage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [originalMessageId, originalChannelId, originalServerId, forwardedMessageId, forwardedChannelId, forwardedServerId, configId, Date.now(), status, errorMessage]
    );
  } catch (error) {
    logError('Error logging forwarded message:', error);
    throw error;
  }
}

// Enhanced message chain logging for split messages (Telegram caption splitting)
async function logMessageChain(originalMessageId, originalChannelId, originalServerId, messageChain, forwardedChannelId, forwardedServerId, configId, status = 'success', errorMessage = null) {
  try {
    if (!Array.isArray(messageChain) || messageChain.length === 0) {
      throw new Error('messageChain must be a non-empty array');
    }

    await ensureMessageLogsChainColumns();
    const timestamp = Date.now();
    const messageChainJson = JSON.stringify(messageChain);
    
    // Log primary message (first in chain)
    const primaryResult = await run(
      `INSERT INTO message_logs (originalMessageId, originalChannelId, originalServerId, forwardedMessageId, forwardedChannelId, forwardedServerId, configId, forwardedAt, status, errorMessage, messageChain, chainPosition, chainParentId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [originalMessageId, originalChannelId, originalServerId, messageChain[0], forwardedChannelId, forwardedServerId, configId, timestamp, status, errorMessage, messageChainJson, 0, null]
    );
    
    const primaryLogId = primaryResult.lastID;
    
    // Log secondary messages (rest of chain)
    for (let i = 1; i < messageChain.length; i++) {
      await run(
        `INSERT INTO message_logs (originalMessageId, originalChannelId, originalServerId, forwardedMessageId, forwardedChannelId, forwardedServerId, configId, forwardedAt, status, errorMessage, messageChain, chainPosition, chainParentId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [originalMessageId, originalChannelId, originalServerId, messageChain[i], forwardedChannelId, forwardedServerId, configId, timestamp, status, errorMessage, messageChainJson, i, primaryLogId]
      );
    }
    
    logInfo(`📎 Logged message chain: ${messageChain.length} messages for original ${originalMessageId}`);
    return primaryLogId;
  } catch (error) {
    const errorMessageText = String(error && error.message ? error.message : '');
    const missingChainColumn = /no column named (messageChain|chainPosition|chainParentId)/i.test(errorMessageText);

    if (missingChainColumn) {
      logError(`Message chain columns missing during chain log, using single-log fallback: ${errorMessageText}`);

      for (const forwardedMessageId of messageChain) {
        await logForwardedMessage(
          originalMessageId,
          originalChannelId,
          originalServerId,
          String(forwardedMessageId),
          forwardedChannelId,
          forwardedServerId,
          configId,
          status,
          errorMessage
        );
      }

      return null;
    }

    logError('Error logging message chain:', error);
    throw error;
  }
}

// Get complete message chain for an original message, optionally scoped to a specific config
async function getMessageChain(originalMessageId, configId) {
  try {
    const messageIdStr = String(originalMessageId);

    if (configId !== undefined && configId !== null) {
      const results = await all(`
        SELECT * FROM message_logs
        WHERE originalMessageId = ? AND configId = ? AND status = 'success'
        ORDER BY chainPosition ASC
      `, [messageIdStr, configId]);
      return results;
    }

    const results = await all(`
      SELECT * FROM message_logs
      WHERE originalMessageId = ? AND status = 'success'
      ORDER BY chainPosition ASC
    `, [messageIdStr]);

    return results;
  } catch (error) {
    logError('Error getting message chain:', error);
    throw error;
  }
}

// Check if a message was forwarded as a chain (split message)
async function isMessageChain(originalMessageId) {
  try {
    const messageIdStr = String(originalMessageId);
    
    const result = await get(`
      SELECT COUNT(*) as count FROM message_logs
      WHERE originalMessageId = ? AND status = 'success' AND messageChain IS NOT NULL
    `, [messageIdStr]);
    
    return result.count > 1;
  } catch (error) {
    logError('Error checking if message is chain:', error);
    return false;
  }
}

// Delete entire message chain from database, optionally scoped to a specific config
async function deleteMessageChain(originalMessageId, configId) {
  try {
    const messageIdStr = String(originalMessageId);

    let result;
    if (configId !== undefined && configId !== null) {
      result = await run(`
        DELETE FROM message_logs
        WHERE originalMessageId = ? AND configId = ? AND status = 'success'
      `, [messageIdStr, configId]);
    } else {
      result = await run(`
        DELETE FROM message_logs
        WHERE originalMessageId = ? AND status = 'success'
      `, [messageIdStr]);
    }

    logInfo(`🗑️ Deleted message chain: ${result.changes || 0} entries for original ${originalMessageId}${configId != null ? ` (config ${configId})` : ''}`);
    return result.changes || 0;
  } catch (error) {
    logError('Error deleting message chain:', error);
    throw error;
  }
}

async function getMessageLogsFiltered({ configId = null, status = null, limit = 50, beforeId = null, messageId = null } = {}) {
  const conditions = [];
  const params = [];

  if (configId !== null) {
    conditions.push('configId = ?');
    params.push(configId);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (beforeId !== null) {
    conditions.push('id < ?');
    params.push(beforeId);
  }
  if (messageId !== null) {
    conditions.push('(originalMessageId = ? OR forwardedMessageId = ?)');
    params.push(String(messageId), String(messageId));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(1, limit), 200);

  return await all(
    `SELECT * FROM message_logs ${where} ORDER BY forwardedAt DESC, id DESC LIMIT ?`,
    [...params, safeLimit]
  );
}

async function deleteMessageLogsFiltered({ configId = null, status = null } = {}) {
  const conditions = [];
  const params = [];

  if (configId !== null) {
    conditions.push('configId = ?');
    params.push(configId);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (conditions.length === 0) {
    throw new Error('Refusing to delete logs without filters');
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const result = await run(`DELETE FROM message_logs ${where}`, params);
  return result.changes || 0;
}

async function getMessageLogs(configId = null, limit = 100) {
  try {
    if (configId) {
      return await all('SELECT * FROM message_logs WHERE configId = ? ORDER BY forwardedAt DESC LIMIT ?', [configId, limit]);
    }
    return await all('SELECT * FROM message_logs ORDER BY forwardedAt DESC LIMIT ?', [limit]);
  } catch (error) {
    logError('Error getting message logs:', error);
    throw error;
  }
}

async function getFailedMessages(limit = 50) {
  try {
    return await all('SELECT * FROM message_logs WHERE status = "failed" ORDER BY forwardedAt DESC LIMIT ?', [limit]);
  } catch (error) {
    logError('Error getting failed messages:', error);
    throw error;
  }
}

// Update message log with new forwarded message ID (for edits)
async function updateMessageLog(logId, newForwardedMessageId) {
  try {
    await run(`
      UPDATE message_logs
      SET forwardedMessageId = ?
      WHERE id = ?
    `, [newForwardedMessageId, logId]);
    return true;
  } catch (error) {
    logError('Error updating message log:', error);
    throw error;
  }
}

// Get message logs by original message ID (for edit/delete handling)
async function getMessageLogsByOriginalMessage(originalMessageId) {
  try {
    // Ensure we're working with string IDs
    const messageIdStr = String(originalMessageId);
    
    const results = await all(`
      SELECT * FROM message_logs
      WHERE originalMessageId = ? AND status = 'success'
      ORDER BY forwardedAt DESC
    `, [messageIdStr]);
    
    return results;
  } catch (error) {
    logError('Error getting message logs by original message:', error);
    throw error;
  }
}

// Validate recent message logs on startup
async function validateRecentMessageLogs(client, optionsOrLimit = 20) {
  try {
    const options = typeof optionsOrLimit === 'number'
      ? { limit: optionsOrLimit }
      : (optionsOrLimit || {});
    const maintenance = getStartupLogMaintenanceOptions(options);

    const retentionCutoff = maintenance.retentionDays !== null && maintenance.retentionDays !== undefined
      ? Date.now() - (maintenance.retentionDays * 24 * 60 * 60 * 1000)
      : null;

    if (maintenance.debugMode) {
      const limitLabel = options.limit ? `last ${options.limit}` : 'paged';
      logInfo(`🔍 Validating ${limitLabel} message logs on startup...`);
    }

    let validCount = 0;
    let invalidCount = 0;
    let processedCount = 0;
    let beforeForwardedAt = null;
    let beforeId = null;
    const startTime = Date.now();

    while (true) {
      if (Date.now() - startTime > maintenance.maxRuntimeMs) {
        logInfo(`Stopping validation due to max runtime (${maintenance.maxRuntimeMs}ms)`);
        break;
      }

      const remaining = options.limit ? options.limit - processedCount : null;
      if (remaining !== null && remaining <= 0) break;

      const pageSize = remaining !== null ? Math.min(maintenance.batchSize, remaining) : maintenance.batchSize;
      const recentLogs = await getMessageLogsPage({
        limit: pageSize,
        beforeForwardedAt,
        beforeId,
        cutoffForwardedAt: retentionCutoff
      });

      if (recentLogs.length === 0) break;

      if (processedCount === 0) {
        logInfo(`Found ${recentLogs.length} recent message logs to validate`);
      }

      for (const log of recentLogs) {
        processedCount++;
      try {
        if (maintenance.debugMode) {
          logInfo(`Checking log ${log.id}: ${log.originalMessageId} -> ${log.forwardedMessageId} (status: ${log.status})`);
        }
        
        // Skip failed logs
        if (log.status !== 'success') {
          logInfo(`  Skipping log ${log.id} - status is ${log.status}`);
          continue;
        }
        
        // Try to find the original message
        let originalExists = false;
        try {
          let sourceChannel;
          
          if (log.originalServerId) {
            const sourceGuild = client.guilds.cache.get(log.originalServerId);
            if (sourceGuild) {
              sourceChannel = sourceGuild.channels.cache.get(log.originalChannelId);
            }
          } else {
            // Find guild that has this channel
            const sourceGuild = client.guilds.cache.find(guild =>
              guild.channels.cache.has(log.originalChannelId)
            );
            if (sourceGuild) {
              sourceChannel = sourceGuild.channels.cache.get(log.originalChannelId);
            }
          }
          
          if (sourceChannel) {
            const originalMessage = await sourceChannel.messages.fetch(log.originalMessageId);
            if (originalMessage) {
              originalExists = true;
              if (maintenance.debugMode) {
                logInfo(`  ✅ Original message ${log.originalMessageId} exists`);
              }
            }
          }
        } catch (error) {
          if (maintenance.debugMode) {
            logInfo(`  ❌ Original message ${log.originalMessageId} not found: ${error.message}`);
          }
        }
        
        // Try to find the forwarded message
        let forwardedExists = false;
        try {
          let targetChannel;
          
          if (log.forwardedServerId) {
            const targetGuild = client.guilds.cache.get(log.forwardedServerId);
            if (targetGuild) {
              targetChannel = targetGuild.channels.cache.get(log.forwardedChannelId);
            }
          } else {
            // Find guild that has this channel
            const targetGuild = client.guilds.cache.find(guild =>
              guild.channels.cache.has(log.forwardedChannelId)
            );
            if (targetGuild) {
              targetChannel = targetGuild.channels.cache.get(log.forwardedChannelId);
            }
          }
          
          if (targetChannel) {
            const forwardedMessage = await targetChannel.messages.fetch(log.forwardedMessageId);
            if (forwardedMessage) {
              forwardedExists = true;
              if (maintenance.debugMode) {
                logInfo(`  ✅ Forwarded message ${log.forwardedMessageId} exists`);
              }
            }
          }
        } catch (error) {
          if (maintenance.debugMode) {
            logInfo(`  ❌ Forwarded message ${log.forwardedMessageId} not found: ${error.message}`);
          }
        }
        
        if (originalExists && forwardedExists) {
          validCount++;
          if (maintenance.debugMode) {
            logInfo(`  ✅ Log ${log.id} is valid - both messages exist`);
          }
        } else {
          invalidCount++;
          if (maintenance.debugMode) {
            logInfo(`  ⚠️ Log ${log.id} is invalid - original: ${originalExists}, forwarded: ${forwardedExists}`);
          }
        }
        
      } catch (error) {
        logError(`Error validating log ${log.id}:`, error);
        invalidCount++;
      }
        if (options.limit && processedCount >= options.limit) {
          break;
        }
      }

      const lastLog = recentLogs[recentLogs.length - 1];
      beforeForwardedAt = lastLog.forwardedAt;
      beforeId = lastLog.id;

      if (maintenance.delayBetweenBatchesMs) {
        await new Promise(resolve => setTimeout(resolve, maintenance.delayBetweenBatchesMs));
      }
    }
    
    logSuccess(`Message log validation complete: ${validCount} valid, ${invalidCount} invalid out of ${processedCount} logs`);
    return { valid: validCount, invalid: invalidCount, total: processedCount };
    
  } catch (error) {
    logError('Error validating message logs:', error);
    return { valid: 0, invalid: 0, total: 0 };
  }
}

// Clean up database entries for deleted messages
async function cleanupDeletedMessage(originalMessageId) {
  try {
    const result = await run(`
      DELETE FROM message_logs
      WHERE originalMessageId = ? AND status = 'success'
    `, [String(originalMessageId)]);
    
    logInfo(`🗑️ Cleaned up ${result.changes || 0} database entries for deleted message ${originalMessageId}`);
    return result.changes || 0;
  } catch (error) {
    logError('Error cleaning up deleted message from database:', error);
    throw error;
  }
}

// Clean up invalid/orphaned message logs
async function cleanupOrphanedLogs(client, optionsOrLimit = 50) {
  try {
    const options = typeof optionsOrLimit === 'number'
      ? { limit: optionsOrLimit }
      : (optionsOrLimit || {});
    const maintenance = getStartupLogMaintenanceOptions(options);

    const retentionCutoff = maintenance.retentionDays !== null && maintenance.retentionDays !== undefined
      ? Date.now() - (maintenance.retentionDays * 24 * 60 * 60 * 1000)
      : null;

    if (maintenance.retentionAction === 'delete' && retentionCutoff !== null) {
      const deletedOld = await deleteOldMessageLogs(retentionCutoff);
      if (deletedOld > 0) {
        logInfo(`🧹 Retention cleanup: Removed ${deletedOld} old message logs (older than ${maintenance.retentionDays} days)`);
      }
    }

    const limitLabel = options.limit ? `last ${options.limit}` : 'paged';
    logInfo(`🧹 Cleaning up orphaned message logs (checking ${limitLabel} entries)...`);

    let deletedCount = 0;
    let processedCount = 0;
    let beforeForwardedAt = null;
    let beforeId = null;
    const startTime = Date.now();
    
    while (true) {
      if (Date.now() - startTime > maintenance.maxRuntimeMs) {
        logInfo(`Stopping cleanup due to max runtime (${maintenance.maxRuntimeMs}ms)`);
        break;
      }

      const remaining = options.limit ? options.limit - processedCount : null;
      if (remaining !== null && remaining <= 0) break;

      const pageSize = remaining !== null ? Math.min(maintenance.batchSize, remaining) : maintenance.batchSize;
      const recentLogs = await getMessageLogsPage({
        limit: pageSize,
        beforeForwardedAt,
        beforeId,
        cutoffForwardedAt: retentionCutoff
      });

      if (recentLogs.length === 0) break;

      for (const log of recentLogs) {
        processedCount++;
      if (log.status !== 'success') continue;
      
      try {
        // Check if original message still exists
        let originalExists = false;
        let originalChecked = false;
        try {
          let sourceChannel;
          
          if (log.originalServerId) {
            const sourceGuild = client.guilds.cache.get(log.originalServerId);
            if (sourceGuild) {
              sourceChannel = sourceGuild.channels.cache.get(log.originalChannelId);
            }
          } else {
            const sourceGuild = client.guilds.cache.find(guild =>
              guild.channels.cache.has(log.originalChannelId)
            );
            if (sourceGuild) {
              sourceChannel = sourceGuild.channels.cache.get(log.originalChannelId);
            }
          }

          if (!sourceChannel && log.originalChannelId) {
            try {
              sourceChannel = await client.channels.fetch(log.originalChannelId);
            } catch (_fetchError) {
              sourceChannel = null;
            }
          }
          
          if (sourceChannel && sourceChannel.messages && typeof sourceChannel.messages.fetch === 'function') {
            originalChecked = true;
            await sourceChannel.messages.fetch(log.originalMessageId);
            originalExists = true;
          }
        } catch (error) {
          if (isDiscordMissingResourceError(error)) {
            originalChecked = true;
          } else if (maintenance.debugMode) {
            logInfo(`Skipping strict orphan check for log ${log.id}: cannot verify source message (${error.message})`);
          }
        }

        if (!originalChecked) {
          if (maintenance.debugMode) {
            logInfo(`Skipping orphan cleanup for log ${log.id}: source channel/message not verifiable`);
          }
          continue;
        }
        
        // Check if forwarded message still exists
        let forwardedExists = false;
        let isTelegramTarget = false;
        
        try {
          if (log.forwardedServerId) {
            // Discord target
            const targetGuild = client.guilds.cache.get(log.forwardedServerId);
            if (targetGuild) {
              const targetChannel = targetGuild.channels.cache.get(log.forwardedChannelId);
              if (targetChannel) {
                await targetChannel.messages.fetch(log.forwardedMessageId);
                forwardedExists = true;
              }
            }
          } else {
            // No server ID - could be Telegram or Discord target with missing serverId
            // First, try to find as Discord channel
            const targetGuild = client.guilds.cache.find(guild =>
              guild.channels.cache.has(log.forwardedChannelId)
            );
            if (targetGuild) {
              // Found as Discord channel
              const targetChannel = targetGuild.channels.cache.get(log.forwardedChannelId);
              if (targetChannel) {
                await targetChannel.messages.fetch(log.forwardedMessageId);
                forwardedExists = true;
              }
            } else {
              // Not found in Discord. Only treat as Telegram when chat ID format matches groups/channels.
              if (String(log.forwardedChannelId || '').trim().startsWith('-')) {
                isTelegramTarget = true;
                // For Telegram, we'll assume the message exists unless we can verify it doesn't.
                forwardedExists = true;
              }
            }
          }
        } catch (error) {
          // Forwarded message doesn't exist
        }
        
        // Handle different cleanup scenarios (source is truth)
        if (!originalExists) {
          // Both messages are gone - just clean up database
          await run(`DELETE FROM message_logs WHERE id = ?`, [log.id]);
          deletedCount++;
          logInfo(`🗑️ Cleaned up orphaned log ${log.id}: Original missing - Original:${log.originalMessageId} -> Forwarded:${log.forwardedMessageId}`);

          // Original is gone but forwarded still exists - delete orphaned forwarded message
          try {
            if (isTelegramTarget) {
              // Handle Telegram orphaned message
              logInfo(`🗑️ TELEGRAM CLEANUP: Deleting orphaned Telegram message ${log.forwardedMessageId} in chat ${log.forwardedChannelId}`);
              
              const TelegramHandler = require('../handlers/telegramHandler');
              const telegramHandler = new TelegramHandler();
              const initialized = await telegramHandler.initialize();
              
              if (initialized) {
                try {
                  await telegramHandler.callTelegramAPI('deleteMessage', {
                    chat_id: log.forwardedChannelId,
                    message_id: parseInt(log.forwardedMessageId)
                  });
                  logSuccess(`🗑️ Deleted orphaned Telegram message ${log.forwardedMessageId} in chat ${log.forwardedChannelId} (original Discord message gone)`);
                } catch (telegramError) {
                  if (telegramError.message && (
                      telegramError.message.includes('message to delete not found') ||
                      telegramError.message.includes('Message to delete not found') ||
                      telegramError.message.includes('Bad Request: message can\'t be deleted')
                    )) {
                    logInfo(`🗑️ Telegram message ${log.forwardedMessageId} already deleted or cannot be deleted`);
                  } else {
                    logError(`Failed to delete orphaned Telegram message ${log.forwardedMessageId}:`, telegramError);
                  }
                }
              } else {
                logError(`Telegram handler failed to initialize - cannot delete orphaned message ${log.forwardedMessageId}`);
              }
            } else {
              // Handle Discord orphaned message
              let targetChannel;
              
              if (log.forwardedServerId) {
                const targetGuild = client.guilds.cache.get(log.forwardedServerId);
                if (targetGuild) {
                  targetChannel = targetGuild.channels.cache.get(log.forwardedChannelId);
                }
              } else {
                const targetGuild = client.guilds.cache.find(guild =>
                  guild.channels.cache.has(log.forwardedChannelId)
                );
                if (targetGuild) {
                  targetChannel = targetGuild.channels.cache.get(log.forwardedChannelId);
                }
              }
              
              if (targetChannel) {
                // Delete the orphaned forwarded Discord message
                const forwardedMessage = await targetChannel.messages.fetch(log.forwardedMessageId);
                if (forwardedMessage) {
                  await forwardedMessage.delete();
                  logSuccess(`🗑️ Deleted orphaned Discord forwarded message ${log.forwardedMessageId} in ${targetChannel.name} (original message gone)`);
                }
              }
            }
            
            // Database entry already removed above
          } catch (deleteError) {
            logError(`Failed to delete orphaned forwarded message ${log.forwardedMessageId}:`, deleteError);
          }
        }
        
      } catch (error) {
        logError(`Error checking log ${log.id}:`, error);
      }
        if (options.limit && processedCount >= options.limit) {
          break;
        }
      }

      const lastLog = recentLogs[recentLogs.length - 1];
      beforeForwardedAt = lastLog.forwardedAt;
      beforeId = lastLog.id;

      if (maintenance.delayBetweenBatchesMs) {
        await new Promise(resolve => setTimeout(resolve, maintenance.delayBetweenBatchesMs));
      }
    }
    
    logSuccess(`🧹 Cleanup complete: Removed ${deletedCount} orphaned message logs`);
    return deletedCount;
    
  } catch (error) {
    logError('Error cleaning up orphaned logs:', error);
    return 0;
  }
}

// Translation threads operations
async function logTranslationThread(forwardedMessageId, threadId, language) {
  try {
    await run(
      `INSERT INTO translation_threads (forwardedMessageId, threadId, language, createdAt)
       VALUES (?, ?, ?, ?)`,
      [forwardedMessageId, threadId, language, Date.now()]
    );
  } catch (error) {
    logError('Error logging translation thread:', error);
    throw error;
  }
}

async function getTranslationThreads(forwardedMessageId) {
  try {
    return await all(
      'SELECT * FROM translation_threads WHERE forwardedMessageId = ? AND archived = 0',
      [forwardedMessageId]
    );
  } catch (error) {
    logError('Error getting translation threads:', error);
    throw error;
  }
}

async function archiveTranslationThread(threadId) {
  try {
    await run(
      'UPDATE translation_threads SET archived = 1 WHERE threadId = ?',
      [threadId]
    );
  } catch (error) {
    logError('Error archiving translation thread:', error);
    throw error;
  }
}

async function deleteTranslationThreads(forwardedMessageId) {
  try {
    const result = await run(
      'DELETE FROM translation_threads WHERE forwardedMessageId = ?',
      [forwardedMessageId]
    );
    logInfo(`🗑️ Cleaned up ${result.changes || 0} translation thread entries for message ${forwardedMessageId}`);
    return result.changes || 0;
  } catch (error) {
    logError('Error deleting translation threads:', error);
    throw error;
  }
}

// Clean up orphaned translation threads (where thread no longer exists on Discord)
async function cleanupOrphanedThreads(client, limit = 50) {
  try {
    logInfo(`🧹 Cleaning up orphaned translation threads (checking last ${limit} entries)...`);
    
    const threads = await all(
      'SELECT * FROM translation_threads WHERE archived = 0 ORDER BY createdAt DESC LIMIT ?',
      [limit]
    );
    
    let deletedCount = 0;
    
    for (const threadData of threads) {
      try {
        // Try to fetch the thread from Discord
        const thread = await client.channels.fetch(threadData.threadId);
        if (!thread) {
          // Thread doesn't exist, remove from database
          await run('DELETE FROM translation_threads WHERE id = ?', [threadData.id]);
          deletedCount++;
          logInfo(`🗑️ Cleaned up orphaned thread entry: ${threadData.threadId} (${threadData.language})`);
        }
      } catch (error) {
        // Thread doesn't exist or can't be accessed, remove from database
        await run('DELETE FROM translation_threads WHERE id = ?', [threadData.id]);
        deletedCount++;
        logInfo(`🗑️ Cleaned up orphaned thread entry: ${threadData.threadId} (${threadData.language}) - Error: ${error.message}`);
      }
    }
    
    logSuccess(`🧹 Thread cleanup complete: Removed ${deletedCount} orphaned thread entries`);
    return deletedCount;
    
  } catch (error) {
    logError('Error cleaning up orphaned threads:', error);
    return 0;
  }
}

module.exports = {
  // Bot settings operations
  getBotSetting,
  setBotSetting,
  getAllBotSettings,
  // Message logging operations
  logForwardedMessage,
  logMessageChain,
  getMessageLogs,
  getMessageLogsFiltered,
  deleteMessageLogsFiltered,
  getFailedMessages,
  updateMessageLog,
  getMessageLogsByOriginalMessage,
  getMessageChain,
  isMessageChain,
  deleteMessageChain,
  validateRecentMessageLogs,
  cleanupDeletedMessage,
  cleanupOrphanedLogs,
  // Translation threads operations
  logTranslationThread,
  getTranslationThreads,
  archiveTranslationThread,
  deleteTranslationThreads,
  cleanupOrphanedThreads,
  // Database utilities
  run,
  get,
  all,
  exec,
  close,
  db
};
