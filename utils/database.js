const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const { logInfo, logSuccess, logError, formatUser } = require('./logger');

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdir(dataDir, { recursive: true }).catch(err => {
  logError(`Error creating data directory: ${err.message}`);
  process.exit(1);
});

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

    // Create message logs for tracking forwarded messages
    await run(`
      CREATE TABLE IF NOT EXISTS message_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        originalMessageId TEXT NOT NULL,
        originalChannelId TEXT NOT NULL,
        originalServerId TEXT,
        forwardedMessageId TEXT,
        forwardedChannelId TEXT,
        forwardedServerId TEXT,
        configId INTEGER NOT NULL, -- References config ID from env.js
        forwardedAt INTEGER NOT NULL,
        status TEXT DEFAULT 'success', -- 'success', 'failed', 'retry'
        errorMessage TEXT
      )
    `);

    // Create indexes for common queries
    await run('CREATE INDEX IF NOT EXISTS idx_bot_settings_key ON bot_settings(key)');
    await run('CREATE INDEX IF NOT EXISTS idx_message_logs_original ON message_logs(originalMessageId, originalChannelId)');
    await run('CREATE INDEX IF NOT EXISTS idx_message_logs_config ON message_logs(configId, forwardedAt)');

    logSuccess('Database tables ready (forward configs now in env.js)');
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
async function validateRecentMessageLogs(client, limit = 20) {
  try {
    logInfo(`🔍 Validating last ${limit} message logs on startup...`);
    
    const recentLogs = await getMessageLogs(null, limit);
    logInfo(`Found ${recentLogs.length} recent message logs to validate`);
    
    let validCount = 0;
    let invalidCount = 0;
    
    for (const log of recentLogs) {
      try {
        logInfo(`Checking log ${log.id}: ${log.originalMessageId} -> ${log.forwardedMessageId} (status: ${log.status})`);
        
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
              logInfo(`  ✅ Original message ${log.originalMessageId} exists`);
            }
          }
        } catch (error) {
          logInfo(`  ❌ Original message ${log.originalMessageId} not found: ${error.message}`);
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
              logInfo(`  ✅ Forwarded message ${log.forwardedMessageId} exists`);
            }
          }
        } catch (error) {
          logInfo(`  ❌ Forwarded message ${log.forwardedMessageId} not found: ${error.message}`);
        }
        
        if (originalExists && forwardedExists) {
          validCount++;
          logInfo(`  ✅ Log ${log.id} is valid - both messages exist`);
        } else {
          invalidCount++;
          logInfo(`  ⚠️ Log ${log.id} is invalid - original: ${originalExists}, forwarded: ${forwardedExists}`);
        }
        
      } catch (error) {
        logError(`Error validating log ${log.id}:`, error);
        invalidCount++;
      }
    }
    
    logSuccess(`Message log validation complete: ${validCount} valid, ${invalidCount} invalid out of ${recentLogs.length} logs`);
    return { valid: validCount, invalid: invalidCount, total: recentLogs.length };
    
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
async function cleanupOrphanedLogs(client, limit = 50) {
  try {
    logInfo(`🧹 Cleaning up orphaned message logs (checking last ${limit} entries)...`);
    
    const recentLogs = await getMessageLogs(null, limit);
    let deletedCount = 0;
    
    for (const log of recentLogs) {
      if (log.status !== 'success') continue;
      
      try {
        // Check if original message still exists
        let originalExists = false;
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
          
          if (sourceChannel) {
            await sourceChannel.messages.fetch(log.originalMessageId);
            originalExists = true;
          }
        } catch (error) {
          // Original message doesn't exist
        }
        
        // Check if forwarded message still exists
        let forwardedExists = false;
        try {
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
            await targetChannel.messages.fetch(log.forwardedMessageId);
            forwardedExists = true;
          }
        } catch (error) {
          // Forwarded message doesn't exist
        }
        
        // Handle different cleanup scenarios
        if (!originalExists && !forwardedExists) {
          // Both messages are gone - just clean up database
          await run(`DELETE FROM message_logs WHERE id = ?`, [log.id]);
          deletedCount++;
          logInfo(`🗑️ Cleaned up orphaned log ${log.id}: Both messages gone - Original:${log.originalMessageId} -> Forwarded:${log.forwardedMessageId}`);
        } else if (!originalExists && forwardedExists) {
          // Original is gone but forwarded still exists - delete orphaned forwarded message
          try {
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
              // Delete the orphaned forwarded message
              const forwardedMessage = await targetChannel.messages.fetch(log.forwardedMessageId);
              if (forwardedMessage) {
                await forwardedMessage.delete();
                logSuccess(`🗑️ Deleted orphaned forwarded message ${log.forwardedMessageId} in ${targetChannel.name} (original message gone)`);
              }
            }
            
            // Clean up database entry
            await run(`DELETE FROM message_logs WHERE id = ?`, [log.id]);
            deletedCount++;
            logInfo(`🗑️ Cleaned up orphaned log ${log.id}: Original gone, forwarded deleted - Original:${log.originalMessageId} -> Forwarded:${log.forwardedMessageId}`);
            
          } catch (deleteError) {
            logError(`Failed to delete orphaned forwarded message ${log.forwardedMessageId}:`, deleteError);
            // Still clean up database entry even if deletion failed
            await run(`DELETE FROM message_logs WHERE id = ?`, [log.id]);
            deletedCount++;
            logInfo(`🗑️ Cleaned up orphaned log ${log.id}: Original gone, forwarded deletion failed but cleaned DB - Original:${log.originalMessageId} -> Forwarded:${log.forwardedMessageId}`);
          }
        }
        
      } catch (error) {
        logError(`Error checking log ${log.id}:`, error);
      }
    }
    
    logSuccess(`🧹 Cleanup complete: Removed ${deletedCount} orphaned message logs`);
    return deletedCount;
    
  } catch (error) {
    logError('Error cleaning up orphaned logs:', error);
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
  getMessageLogs,
  getFailedMessages,
  updateMessageLog,
  getMessageLogsByOriginalMessage,
  validateRecentMessageLogs,
  cleanupDeletedMessage,
  cleanupOrphanedLogs,
  // Database utilities
  run,
  get,
  all,
  db
};