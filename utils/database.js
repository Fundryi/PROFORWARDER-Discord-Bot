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

    // Create indexes for common queries
    await run('CREATE INDEX IF NOT EXISTS idx_bot_settings_key ON bot_settings(key)');

    logSuccess('Database tables ready');
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

module.exports = {
  // Bot settings operations
  getBotSetting,
  setBotSetting,
  getAllBotSettings,
  // Database utilities
  run,
  get,
  all,
  db
};