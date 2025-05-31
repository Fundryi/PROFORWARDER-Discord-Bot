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
    const results = await all(`
      SELECT * FROM message_logs
      WHERE originalMessageId = ? AND status = 'success'
      ORDER BY forwardedAt DESC
    `, [originalMessageId]);
    
    logInfo(`Debug: Query for message ${originalMessageId} returned ${results.length} results`);
    return results;
  } catch (error) {
    logError('Error getting message logs by original message:', error);
    throw error;
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
  // Database utilities
  run,
  get,
  all,
  db
};