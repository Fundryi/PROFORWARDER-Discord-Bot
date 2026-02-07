const fs = require('fs');
const path = require('path');

// Check for required config files
const configFiles = [
  { path: './config/config.js', name: 'Environment configuration' },
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
const { exec, close, setMaintenanceReaderBotClient } = require('./utils/database');
const { logInfo, logSuccess, logError } = require('./utils/logger');
const config = require('./config/config');
const {
  handleProforwardCommand,
  buildRegisteredProforwardCommandData,
  webManagedDeprecatedSubcommands
} = require('./commands/proforwardCommand');
const { handleMessageCreate, handleMessageUpdate, handleMessageDelete } = require('./events/messageEvents');
let startWebAdminServer = () => null;
let stopWebAdminServer = async () => {};
try {
  ({ startWebAdminServer, stopWebAdminServer } = require('./web/server'));
} catch (error) {
  logError(`Web admin module unavailable, continuing without web admin: ${error.message}`);
}

// Reader Bot import
const ReaderBot = require('./readerBot');

function getWebAdminUrlForNotice() {
  try {
    const base = String(config?.webAdmin?.baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) return '/admin';
    if (base.endsWith('/admin')) return base;
    return `${base}/admin`;
  } catch (_error) {
    return '/admin';
  }
}

logInfo('Bot is starting up...');
logInfo('Initializing client with required intents...');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

// Reader Bot instance
let readerBot = null;
let webAdminServer = null;

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
    await interaction.reply({
      content: `⛔ \`/debug\` is disabled. Use Web Admin Debug tab: ${getWebAdminUrlForNotice()}`,
      ephemeral: true
    });
  } else {
    await interaction.reply({ content: 'Unknown command', ephemeral: true });
  }
});

client.on("clientReady", async () => {
  logInfo('Bot is ready!');
  
  try {
    logInfo('Started refreshing application (/) commands...');
    const registeredProforwardCommand = buildRegisteredProforwardCommandData({ hideDeprecated: true });
    const visibleSubcommands = Array.isArray(registeredProforwardCommand.options)
      ? registeredProforwardCommand.options.map(option => option.name)
      : [];
    const commandsToRegister = [];

    // If all /proforward subcommands are web-managed, unregister slash commands fully.
    if (visibleSubcommands.length > 0) {
      commandsToRegister.push(registeredProforwardCommand);
    }

    // /debug is web-managed only now and intentionally not registered.
    await client.application.commands.set(commandsToRegister);

    logSuccess('Successfully registered ProForwarder commands:');
    if (visibleSubcommands.length > 0) {
      logInfo(`- /proforward ${config.debugMode ? '(DEBUG MODE)' : '(production mode)'}`);
      logInfo(`  ├─ Visible subcommands: ${visibleSubcommands.join(', ') || '(none)'}`);
      logInfo(`  └─ Hidden (web-managed): ${webManagedDeprecatedSubcommands.join(', ')}`);
    } else {
      logInfo(`- /proforward fully web-managed (all subcommands hidden/disabled)`);
    }
    logInfo(`- /debug fully web-managed (command unregistered)`);
  } catch (error) {
    logError('Error registering commands:', error);
  }

  // Initialize database
  logInfo('Initializing database...');
  try {
    await exec('PRAGMA journal_mode = WAL;');
    logSuccess('Database initialized successfully');
  } catch (error) {
    logError('Error initializing database:', error);
  }

  // Initialize Discord invite manager for source headers
  logInfo('Initializing Discord invite manager...');
  try {
    const discordInviteManager = require('./utils/discordInviteManager');
    discordInviteManager.initialize(client);
    logSuccess('Discord invite manager initialized');
  } catch (error) {
    logError('Error initializing Discord invite manager:', error);
  }
  
  // Initialize Reader Bot if enabled
  if (config.readerBot && config.readerBot.enabled) {
    logInfo('Initializing Reader Bot...');
    try {
      readerBot = new ReaderBot(client); // Pass main bot client
      module.exports.readerBot = readerBot; // Update exports so importers see the live value
      const success = await readerBot.initialize();
      if (success) {
        setMaintenanceReaderBotClient(readerBot.client);
        logSuccess('Reader Bot initialized successfully');
      } else {
        setMaintenanceReaderBotClient(null);
        logInfo('Reader Bot initialization failed or disabled');
      }
    } catch (error) {
      setMaintenanceReaderBotClient(null);
      logError('Error initializing Reader Bot:', error);
    }
  } else {
    setMaintenanceReaderBotClient(null);
  }

  // Validate/cleanup logs on startup (run in background so bot is responsive immediately)
  // This runs after reader bot initialization so source verification can use reader access when available.
  const { validateRecentMessageLogs, cleanupOrphanedLogs, cleanupOrphanedThreads } = require('./utils/database');
  const maintenanceOptions = config.startupLogMaintenance || {};
  if (maintenanceOptions.enabled !== false) {
    setTimeout(async () => {
      try {
        await validateRecentMessageLogs(client, maintenanceOptions);
        await cleanupOrphanedLogs(client, maintenanceOptions);
        await cleanupOrphanedThreads(client, 50);
      } catch (error) {
        logError('Startup log maintenance failed:', error);
      }
    }, 0);
  } else {
    logInfo('Startup log maintenance disabled');
  }

  // Initialize Web Admin if enabled
  if (!webAdminServer) {
    webAdminServer = startWebAdminServer(client, config);
  }

  // Telegram chat startup sync (background, non-blocking)
  if (config.telegram && config.telegram.enabled) {
    setTimeout(async () => {
      try {
        const TelegramHandler = require('./handlers/telegramHandler');
        const { runStartupSync } = require('./utils/telegramChatTracker');
        const telegramHandler = new TelegramHandler();
        const initialized = await telegramHandler.initialize();
        if (!initialized) return;
        await runStartupSync(telegramHandler);
      } catch (error) {
        logError(`Telegram chat startup sync failed: ${error.message}`);
      }
    }, 5000);
  }

  logSuccess(`Successfully logged in as ${client.user.tag}`);
  logInfo('ProForwarder bot is ready to forward messages!');
});

// Note: unhandledRejection is handled in errorHandlers.js

// Cleanup on exit
process.on('SIGINT', async () => {
  logInfo('\nShutting down bots...');
  
  if (readerBot) {
    await readerBot.shutdown();
  }

  if (webAdminServer) {
    logInfo('Shutting down web admin server...');
    await stopWebAdminServer(webAdminServer);
  }
  
  logInfo('Closing database connection...');
  try {
    await close();
    logSuccess('Database connection closed');
    process.exit(0);
  } catch (error) {
    logError('Error closing database:', error);
    process.exit(1);
  }
});

// Migrate dynamic config data from config.js to JSON files (one-time, idempotent)
const { migrateToJsonConfigs } = require('./utils/configManager');
migrateToJsonConfigs().then(() => {
  logInfo('Attempting to log in...');
  client.login(process.env.BOT_TOKEN).catch(error => {
    logError('Failed to login:', error);
  });
}).catch(error => {
  logError('Config migration error (proceeding anyway):', error);
  client.login(process.env.BOT_TOKEN).catch(err => {
    logError('Failed to login:', err);
  });
});

// Export references for use in other modules
// Note: readerBot is set later in clientReady; importers must access
// module.exports.readerBot (or re-require) to get the live value.
module.exports = { client, readerBot };
