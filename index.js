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
const { proforwardCommand, handleProforwardCommand } = require('./commands/proforwardCommand');
const { debugCommand, handleDebugCommand } = require('./commands/debugCommands');
const { handleMessageCreate, handleMessageUpdate, handleMessageDelete } = require('./events/messageEvents');

logInfo('Bot is starting up...');
logInfo('Initializing client with required intents...');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

// Event Handlers
client.on("messageCreate", async (message) => {
  await handleMessageCreate(message, client);
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  await handleMessageUpdate(oldMessage, newMessage, client);
});

client.on("messageDelete", async (message) => {
  await handleMessageDelete(message, client);
});


client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'proforward') {
    await handleProforwardCommand(interaction);
  } else if (interaction.commandName === 'debug') {
    await handleDebugCommand(interaction);
  } else {
    await interaction.reply({ content: 'Unknown command', ephemeral: true });
  }
});

client.on("ready", async () => {
  logInfo('Bot is ready!');
  
  try {
    logInfo('Started refreshing application (/) commands...');
    await client.application.commands.set([proforwardCommand, debugCommand]);
    logSuccess('Successfully registered ProForwarder commands:');
    logInfo(`- /proforward ${config.debugMode ? '(DEBUG MODE)' : '(production mode)'}`);
    logInfo(`- /debug (admin-only debugging tools)`);
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

  // Validate recent message logs on startup
  const { validateRecentMessageLogs, cleanupOrphanedLogs, cleanupOrphanedThreads } = require('./utils/database');
  await validateRecentMessageLogs(client, 20);
  
  // Clean up orphaned logs from previous sessions
  await cleanupOrphanedLogs(client, 50);
  
  // Clean up orphaned translation threads from previous sessions
  await cleanupOrphanedThreads(client, 50);
  
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
