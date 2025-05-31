const fs = require('fs');
const path = require('path');

// Check for required config files
const configFiles = [
  { path: './config/env.js', name: 'Environment configuration' },
  { path: './config/.env', name: 'Environment variables' }
];

configFiles.forEach(file => {
  if (!fs.existsSync(file.path)) {
    console.error(`Error: ${file.name} file not found at ${file.path}`);
    console.error(`Please create ${file.path} based on the example files provided.`);
    process.exit(1);
  }
});

require('dotenv').config({ path: './config/.env' });
require("./errorHandlers");

const { Client, GatewayIntentBits } = require("discord.js");
const { db } = require('./utils/database');
const { logInfo, logSuccess, logError } = require('./utils/logger');
const config = require('./config/env');

logInfo('Bot is starting up...');
logInfo('Initializing client with required intents...');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
});

// Event Handlers
// TODO: Add message forwarding event handlers

client.on("ready", async () => {
  logInfo('Bot is ready!');
  
  try {
    logInfo('Started refreshing application (/) commands...');
    // TODO: Register forward commands
    await client.application.commands.set([]);
    logSuccess('Commands registered successfully');
  } catch (error) {
    logError('Error registering commands:', error);
  }

  // Initialize database
  logInfo('Initializing database...');
  try {
    await db.exec('PRAGMA journal_mode = WAL;');
    logSuccess('Database initialized successfully');
  } catch (error) {
    logError('Error initializing database:', error);
  }

  logSuccess(`Successfully logged in as ${client.user.tag}`);
  logInfo('ProForwarder bot is ready to forward messages!');
});

process.on('unhandledRejection', error => {
  logError('Unhandled promise rejection:', error);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  logInfo('\nClosing database connection...');
  try {
    await db.close();
    logSuccess('Database connection closed');
    process.exit(0);
  } catch (error) {
    logError('Error closing database:', error);
    process.exit(1);
  }
});

logInfo('Attempting to log in...');
client.login(process.env.BOT_TOKEN).catch(error => {
  logError('Failed to login:', error);
});
