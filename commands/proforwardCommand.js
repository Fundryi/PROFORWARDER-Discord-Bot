const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addForwardConfig, getForwardConfigsForChannel, disableForwardConfig, getAllActiveForwardConfigs } = require('../utils/configManager');
const { hasWebhookPermissions } = require('../utils/webhookManager');
const { logInfo, logSuccess, logError } = require('../utils/logger');

const proforwardCommand = new SlashCommandBuilder()
  .setName('proforward')
  .setDescription('ProForwarder - Simple message forwarding between Discord channels')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addSubcommand(subcommand =>
    subcommand
      .setName('setup')
      .setDescription('Set up message forwarding from one channel to another')
      .addChannelOption(option =>
        option
          .setName('source')
          .setDescription('Source channel to forward messages from')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('target_channel')
          .setDescription('Target channel ID (use channel ID for cross-server, or #channel for same server)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('target_server')
          .setDescription('Target server ID (required for cross-server forwarding)')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('telegram')
      .setDescription('Set up message forwarding from Discord channel to Telegram chat')
      .addChannelOption(option =>
        option
          .setName('source')
          .setDescription('Source Discord channel to forward messages from')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('chat_id')
          .setDescription('Telegram chat ID (negative for groups/channels, positive for private chats)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription('Custom name for this forward configuration')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('List all active forward configurations')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Remove a forward configuration')
      .addIntegerOption(option =>
        option
          .setName('config_id')
          .setDescription('ID of the configuration to remove')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('status')
      .setDescription('Show bot status and quick server/channel info')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('test')
      .setDescription('Test Telegram connection')
      .addStringOption(option =>
        option
          .setName('chat_id')
          .setDescription('Telegram chat ID to test')
          .setRequired(true)
      )
  );

async function handleProforwardCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case 'setup':
        await handleSetup(interaction);
        break;
      case 'telegram':
        await handleTelegram(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
      case 'remove':
        await handleRemove(interaction);
        break;
      case 'status':
        await handleStatus(interaction);
        break;
      case 'test':
        await handleTest(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown subcommand', ephemeral: true });
    }
  } catch (error) {
    logError('Error in proforward command:', error);
    
    const errorMessage = 'An error occurred while processing the command. Please try again.';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

async function handleSetup(interaction) {
  const sourceChannel = interaction.options.getChannel('source');
  const targetChannelInput = interaction.options.getString('target_channel');
  const targetServerId = interaction.options.getString('target_server');
  
  // Validate source channel
  if (sourceChannel.type !== 0) { // 0 = GUILD_TEXT
    await interaction.reply({
      content: '❌ Source channel must be a text channel.',
      ephemeral: true
    });
    return;
  }

  // Parse target channel input
  let targetChannelId;
  
  // Check if it's a channel mention (same server)
  if (targetChannelInput.startsWith('<#') && targetChannelInput.endsWith('>')) {
    targetChannelId = targetChannelInput.slice(2, -1);
  }
  // Check if it's just a channel ID (numeric string)
  else if (/^\d+$/.test(targetChannelInput)) {
    targetChannelId = targetChannelInput;
  }
  else {
    await interaction.reply({
      content: '❌ Invalid target channel format.\n**Same server:** Use #channel-name\n**Cross server:** Use channel ID (like `1375900190460084445`) with target_server parameter',
      ephemeral: true
    });
    return;
  }

  // For same-server forwarding
  if (!targetServerId) {
    const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
    
    if (!targetChannel) {
      await interaction.reply({
        content: `❌ Target channel not found in this server.\n**Tip:** For same-server forwarding, use #channel-name.\nFor cross-server forwarding, provide both channel ID and target_server.`,
        ephemeral: true
      });
      return;
    }

    if (targetChannel.type !== 0) {
      await interaction.reply({
        content: '❌ Target channel must be a text channel.',
        ephemeral: true
      });
      return;
    }

    if (sourceChannel.id === targetChannel.id) {
      await interaction.reply({
        content: '❌ Source and target channels cannot be the same.',
        ephemeral: true
      });
      return;
    }

    // Create the forward configuration
    const newConfig = {
      name: `${sourceChannel.name} to ${targetChannel.name}`,
      sourceType: 'discord',
      sourceServerId: interaction.guild.id,
      sourceChannelId: sourceChannel.id,
      targetType: 'discord',
      targetServerId: interaction.guild.id,
      targetChannelId: targetChannel.id,
      createdBy: interaction.user.id
    };

    const configId = await addForwardConfig(newConfig);

    await interaction.reply({
      content: `✅ **Forward configured!**\n**From:** ${sourceChannel}\n**To:** ${targetChannel}\n**ID:** ${configId}`,
      ephemeral: false
    });

    logSuccess(`Same-server forward: ${sourceChannel.name} -> ${targetChannel.name} by ${interaction.user.username}`);
  }
  // For cross-server forwarding
  else {
    const targetGuild = interaction.client.guilds.cache.get(targetServerId);
    if (!targetGuild) {
      await interaction.reply({
        content: `❌ **Target server not found!**\nBot is not in server: \`${targetServerId}\`\n\n**Use \`/proforward status\` to see available servers**`,
        ephemeral: true
      });
      return;
    }

    let actualTargetChannel = targetGuild.channels.cache.get(targetChannelId);
    
    if (!actualTargetChannel) {
      try {
        actualTargetChannel = await targetGuild.channels.fetch(targetChannelId);
      } catch (error) {
        await interaction.reply({
          content: `❌ **Target channel not found!**\nChannel \`${targetChannelId}\` not found in **${targetGuild.name}**\n\n**Use \`/proforward status\` to see available channels**`,
          ephemeral: true
        });
        return;
      }
    }

    if (actualTargetChannel.type !== 0) {
      await interaction.reply({
        content: `❌ Target channel **${actualTargetChannel.name}** must be a text channel.`,
        ephemeral: true
      });
      return;
    }

    // Check bot permissions
    const permissions = actualTargetChannel.permissionsFor(interaction.client.user);
    if (!permissions || !permissions.has(['ViewChannel', 'SendMessages'])) {
      await interaction.reply({
        content: `❌ **Missing permissions!**\nBot lacks permissions in **${actualTargetChannel.name}** (${targetGuild.name})\n\n**Required:** View Channel, Send Messages`,
        ephemeral: true
      });
      return;
    }

    // Check forwarding quality based on permissions
    const hasWebhooks = hasWebhookPermissions(actualTargetChannel, interaction.client.user);
    const qualityInfo = hasWebhooks
      ? "🎯 **Perfect 1:1 forwarding** (webhook permissions detected)"
      : "⚠️ **Basic forwarding** (no webhook permissions - messages will show as bot)";

    // Create cross-server configuration
    const newConfig = {
      name: `${sourceChannel.name} to ${actualTargetChannel.name} (${targetGuild.name})`,
      sourceType: 'discord',
      sourceServerId: interaction.guild.id,
      sourceChannelId: sourceChannel.id,
      targetType: 'discord',
      targetServerId: targetServerId,
      targetChannelId: targetChannelId,
      createdBy: interaction.user.id
    };

    const configId = await addForwardConfig(newConfig);

    await interaction.reply({
      content: `✅ **Cross-server forward configured!**\n**From:** ${sourceChannel} (${interaction.guild.name})\n**To:** ${actualTargetChannel.name} (${targetGuild.name})\n**ID:** ${configId}\n\n${qualityInfo}\n\n🚀 Ready to forward messages!`,
      ephemeral: false
    });

    logSuccess(`Cross-server forward: ${sourceChannel.name} -> ${actualTargetChannel.name} (${targetGuild.name}) by ${interaction.user.username}`);
  }
}

async function handleTelegram(interaction) {
  const sourceChannel = interaction.options.getChannel('source');
  const chatId = interaction.options.getString('chat_id');
  const customName = interaction.options.getString('name');
  
  // Validate source channel
  if (sourceChannel.type !== 0) { // 0 = GUILD_TEXT
    await interaction.reply({
      content: '❌ Source channel must be a text channel.',
      ephemeral: true
    });
    return;
  }

  // Validate chat ID format
  if (!/^-?\d+$/.test(chatId)) {
    await interaction.reply({
      content: '❌ Invalid Telegram chat ID format.\n\n**Examples:**\n• Group/Channel: `-1001234567890` (negative)\n• Private chat: `123456789` (positive)\n\n**How to get chat ID:**\n1. Add @userinfobot to your chat\n2. Send any message\n3. Use the chat ID it provides',
      ephemeral: true
    });
    return;
  }

  // Check if Telegram is enabled
  const config = require('../config/env');
  if (!config.telegram?.enabled) {
    await interaction.reply({
      content: '❌ **Telegram integration is not enabled.**\n\nTo enable Telegram forwarding:\n1. Set `TELEGRAM_ENABLED=true` in your .env file\n2. Add your `TELEGRAM_BOT_TOKEN`\n3. Restart the bot\n\n**Need help?** Check the README for Telegram setup instructions.',
      ephemeral: true
    });
    return;
  }

  // Test Telegram connection
  await interaction.deferReply({ ephemeral: true });
  
  try {
    // Create the forward configuration name
    const configName = customName || `${sourceChannel.name} to Telegram (${chatId})`;

    // Create the forward configuration
    const newConfig = {
      name: configName,
      sourceType: 'discord',
      sourceServerId: interaction.guild.id,
      sourceChannelId: sourceChannel.id,
      targetType: 'telegram',
      targetChatId: chatId,
      createdBy: interaction.user.id
    };

    const configId = await addForwardConfig(newConfig);

    await interaction.editReply({
      content: `✅ **Telegram forward configured!**\n**From:** ${sourceChannel} (${interaction.guild.name})\n**To:** Telegram chat \`${chatId}\`\n**Name:** ${configName}\n**ID:** ${configId}\n\n🚀 **Ready to forward messages!**\n\n💡 **Tip:** Send a test message in ${sourceChannel} to verify the connection.`,
    });

    logSuccess(`Telegram forward: ${sourceChannel.name} -> ${chatId} by ${interaction.user.username}`);
  } catch (error) {
    logError('Error creating Telegram forward:', error);
    
    await interaction.editReply({
      content: `❌ **Failed to create Telegram forward configuration.**\n\n**Possible issues:**\n• Invalid Telegram chat ID\n• Bot not added to the Telegram chat\n• Telegram bot token invalid\n\n**Error:** ${error.message}\n\n**Need help?** Check the bot logs or README for troubleshooting.`,
    });
  }
}

async function handleList(interaction) {
  const allConfigs = await getAllActiveForwardConfigs();
  const configs = allConfigs.filter(config => config.sourceServerId === interaction.guild.id);

  if (configs.length === 0) {
    await interaction.reply({ 
      content: '📋 No forward configurations found for this server.\n\nUse `/proforward setup` to create one!', 
      ephemeral: true 
    });
    return;
  }

  let response = `**📋 Forward Configurations (${configs.length}):**\n\n`;

  for (const config of configs) {
    const sourceChannel = interaction.guild.channels.cache.get(config.sourceChannelId);
    let targetInfo;

    if (config.targetType === 'telegram') {
      // Telegram target
      targetInfo = `📱 Telegram chat \`${config.targetChatId}\``;
    } else if (config.targetServerId === interaction.guild.id) {
      // Same server Discord
      const targetChannel = interaction.guild.channels.cache.get(config.targetChannelId);
      targetInfo = targetChannel ? `${targetChannel}` : `❌ Channel deleted`;
    } else {
      // Cross server Discord
      const targetGuild = interaction.client.guilds.cache.get(config.targetServerId);
      if (targetGuild) {
        const targetChannel = targetGuild.channels.cache.get(config.targetChannelId);
        targetInfo = targetChannel
          ? `#${targetChannel.name} in **${targetGuild.name}**`
          : `❌ Channel deleted in **${targetGuild.name}**`;
      } else {
        targetInfo = `❌ Server not accessible`;
      }
    }

    response += `**${config.id}.** ${config.name || 'Unnamed'}\n`;
    response += `${sourceChannel ? sourceChannel : '❌ Source deleted'} → ${targetInfo}\n`;
    response += `Status: ${config.enabled !== false ? '✅ Active' : '❌ Disabled'}\n\n`;
  }

  response += `*Use \`/proforward remove config_id:<ID>\` to remove a configuration*`;

  await interaction.reply({ content: response, ephemeral: true });
}

async function handleRemove(interaction) {
  const configId = interaction.options.getInteger('config_id');

  try {
    await disableForwardConfig(configId);
    
    await interaction.reply({ 
      content: `✅ Forward configuration **${configId}** has been removed.`,
      ephemeral: false
    });

    logSuccess(`Forward config ${configId} removed by ${interaction.user.username}`);
  } catch (error) {
    await interaction.reply({ 
      content: `❌ Configuration **${configId}** not found.`,
      ephemeral: true
    });
  }
}

async function handleStatus(interaction) {
  const servers = interaction.client.guilds.cache;
  const config = require('../config/env');
  
  let response = `**🤖 ProForwarder Status**\n\n`;
  response += `**Servers:** ${servers.size}\n`;
  response += `**Current Server:** ${interaction.guild.name} (\`${interaction.guild.id}\`)\n`;
  
  // Telegram status
  const telegramStatus = config.telegram?.enabled ? '✅ Enabled' : '❌ Disabled';
  response += `**Telegram Integration:** ${telegramStatus}\n\n`;
  
  response += `**📡 Available Servers:**\n`;
  for (const [id, guild] of servers) {
    const channelCount = guild.channels.cache.filter(c => c.type === 0).size;
    response += `• **${guild.name}** - \`${id}\` (${channelCount} channels)\n`;
  }
  
  response += `\n**💡 Quick Tips:**\n`;
  response += `• Same server: \`/proforward setup source:#from target_channel:#to\`\n`;
  response += `• Cross server: \`/proforward setup source:#from target_channel:CHANNEL_ID target_server:SERVER_ID\`\n`;
  if (config.telegram?.enabled) {
    response += `• Telegram: \`/proforward telegram source:#from chat_id:CHAT_ID\`\n`;
  }
  response += `• Right-click → Copy ID to get channel/server IDs (Developer Mode required)`;

  if (response.length > 2000) {
    const chunks = [response.substring(0, 1900), response.substring(1900)];
    await interaction.reply({ content: chunks[0], ephemeral: true });
    await interaction.followUp({ content: chunks[1], ephemeral: true });
  } else {
    await interaction.reply({ content: response, ephemeral: true });
  }
}

async function handleTest(interaction) {
  const chatId = interaction.options.getString('chat_id');
  
  // Validate chat ID format
  if (!/^-?\d+$/.test(chatId)) {
    await interaction.reply({
      content: '❌ Invalid Telegram chat ID format.\n\n**Examples:**\n• Group/Channel: `-1001234567890` (negative)\n• Private chat: `123456789` (positive)',
      ephemeral: true
    });
    return;
  }

  // Check if Telegram is enabled
  const config = require('../config/env');
  if (!config.telegram?.enabled) {
    await interaction.reply({
      content: '❌ **Telegram integration is not enabled.**\n\nTo enable Telegram forwarding:\n1. Set `TELEGRAM_ENABLED=true` in your .env file\n2. Add your `TELEGRAM_BOT_TOKEN`\n3. Restart the bot',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Import the TelegramHandler
    const TelegramHandler = require('../handlers/telegramHandler');
    const telegramHandler = new TelegramHandler();
    
    // Initialize and test
    const initialized = await telegramHandler.initialize();
    if (!initialized) {
      await interaction.editReply({
        content: '❌ **Failed to initialize Telegram handler.**\n\nCheck your Telegram bot token and try again.',
      });
      return;
    }

    // Send test message
    const testResult = await telegramHandler.testTelegram(chatId);
    
    if (testResult.success) {
      await interaction.editReply({
        content: `✅ **Telegram test successful!**\n\n**Chat ID:** \`${chatId}\`\n**Message ID:** ${testResult.messageId}\n\n🎉 **Your Telegram integration is working perfectly!**\n\nYou can now use \`/proforward telegram\` to set up message forwarding.`,
      });
    } else {
      await interaction.editReply({
        content: `❌ **Telegram test failed.**\n\n**Chat ID:** \`${chatId}\`\n**Error:** ${testResult.error}\n\n**Common issues:**\n• Bot not added to the Telegram chat\n• Invalid chat ID\n• Missing bot permissions in the chat\n\n**Fix:** Add your bot to the Telegram chat and make sure it has permission to send messages.`,
      });
    }
  } catch (error) {
    logError('Error testing Telegram:', error);
    
    await interaction.editReply({
      content: `❌ **Telegram test failed with error.**\n\n**Error:** ${error.message}\n\nCheck the bot logs for more details.`,
    });
  }
}

module.exports = {
  proforwardCommand,
  handleProforwardCommand
};