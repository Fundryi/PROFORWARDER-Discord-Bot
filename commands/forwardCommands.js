const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addForwardConfig, getForwardConfigsForChannel, disableForwardConfig, getAllActiveForwardConfigs } = require('../utils/configManager');
const { logInfo, logSuccess, logError } = require('../utils/logger');

const forwardCommand = new SlashCommandBuilder()
  .setName('forward')
  .setDescription('Manage message forwarding configurations')
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
      .setName('list')
      .setDescription('List all active forward configurations')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Show configs for specific channel only')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('delete')
      .setDescription('Delete a forward configuration')
      .addIntegerOption(option =>
        option
          .setName('config_id')
          .setDescription('ID of the configuration to delete')
          .setRequired(true)
      )
  );

async function handleForwardCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case 'setup':
        await handleSetup(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
      case 'delete':
        await handleDelete(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown subcommand', ephemeral: true });
    }
  } catch (error) {
    logError('Error in forward command:', error);
    
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
  // Check if it's a channel mention without brackets
  else if (targetChannelInput.startsWith('#')) {
    await interaction.reply({
      content: '❌ For same-server forwarding, please use a channel mention like #channel-name.\nFor cross-server forwarding, use the channel ID (numeric) and provide target_server.',
      ephemeral: true
    });
    return;
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
    // Try to find the target channel in the same server
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
      content: `✅ **Same-server forward configuration created!**\n**Source:** ${sourceChannel}\n**Target:** ${targetChannel}\n**Config ID:** ${configId}`,
      ephemeral: false
    });

    logSuccess(`Same-server forward config created: ${sourceChannel.name} -> ${targetChannel.name} by ${interaction.user.username}`);
  }
  // For cross-server forwarding
  else {
    // Validate target server exists and bot has access
    const targetGuild = interaction.client.guilds.cache.get(targetServerId);
    if (!targetGuild) {
      await interaction.reply({
        content: `❌ **Target server not found!**\nThe bot is not a member of server ID: \`${targetServerId}\`\n\n**Please ensure:**\n• The server ID is correct\n• The bot is invited to that server\n• The bot has necessary permissions`,
        ephemeral: true
      });
      return;
    }

    // Try to get target channel from cache first
    let actualTargetChannel = targetGuild.channels.cache.get(targetChannelId);
    
    // If not in cache, try to fetch it
    if (!actualTargetChannel) {
      try {
        actualTargetChannel = await targetGuild.channels.fetch(targetChannelId);
      } catch (error) {
        await interaction.reply({
          content: `❌ **Target channel not found!**\nChannel ID \`${targetChannelId}\` not found in server **${targetGuild.name}**\n\n**Please check:**\n• The channel ID is correct\n• The channel exists in the target server\n• The bot has access to that channel`,
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

    // Check bot permissions in target channel
    const permissions = actualTargetChannel.permissionsFor(interaction.client.user);
    if (!permissions || !permissions.has(['ViewChannel', 'SendMessages'])) {
      await interaction.reply({
        content: `❌ **Missing permissions in target channel!**\nThe bot lacks required permissions in **${actualTargetChannel.name}** (${targetGuild.name})\n\n**Required permissions:**\n• View Channel\n• Send Messages\n• Embed Links\n• Attach Files`,
        ephemeral: true
      });
      return;
    }

    // Create the forward configuration
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
      content: `✅ **Cross-server forward configuration created!**\n**Source:** ${sourceChannel} (${interaction.guild.name})\n**Target:** ${actualTargetChannel.name} (${targetGuild.name})\n**Config ID:** ${configId}\n\n🚀 Messages from ${sourceChannel} will now be forwarded to the target channel!`,
      ephemeral: false
    });

    logSuccess(`Cross-server forward config created: ${sourceChannel.name} -> ${actualTargetChannel.name} (${targetGuild.name}) by ${interaction.user.username}`);
  }
}

async function handleList(interaction) {
  const specificChannel = interaction.options.getChannel('channel');
  
  let configs;
  if (specificChannel) {
    configs = await getForwardConfigsForChannel(specificChannel.id);
  } else {
    // Get all configs for the current server
    const allConfigs = await getAllActiveForwardConfigs();
    configs = allConfigs.filter(config => config.sourceServerId === interaction.guild.id);
  }

  if (configs.length === 0) {
    const message = specificChannel 
      ? `No forward configurations found for ${specificChannel}.`
      : 'No forward configurations found for this server.';
    
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  let response = specificChannel 
    ? `**Forward configurations for ${specificChannel}:**\n`
    : `**Forward configurations for ${interaction.guild.name}:**\n`;

  for (const config of configs) {
    const sourceChannel = interaction.guild.channels.cache.get(config.sourceChannelId);
    let targetInfo;

    if (config.targetServerId === interaction.guild.id) {
      // Same server
      const targetChannel = interaction.guild.channels.cache.get(config.targetChannelId);
      targetInfo = targetChannel ? `${targetChannel}` : `#deleted-channel (${config.targetChannelId})`;
    } else {
      // Cross server
      const targetGuild = interaction.client.guilds.cache.get(config.targetServerId);
      if (targetGuild) {
        const targetChannel = targetGuild.channels.cache.get(config.targetChannelId);
        targetInfo = targetChannel 
          ? `${targetChannel.name} in ${targetGuild.name}`
          : `#deleted-channel in ${targetGuild.name}`;
      } else {
        targetInfo = `Unknown server (${config.targetServerId})`;
      }
    }

    response += `\n**ID:** ${config.id}\n`;
    response += `**Source:** ${sourceChannel ? sourceChannel : '#deleted-channel'}\n`;
    response += `**Target:** ${targetInfo}\n`;
    response += `**Name:** ${config.name || 'Unnamed'}\n`;
    response += `**Status:** ${config.enabled !== false ? '✅ Active' : '❌ Disabled'}\n`;
    response += '---\n';
  }

  await interaction.reply({ content: response, ephemeral: true });
}

async function handleDelete(interaction) {
  const configId = interaction.options.getInteger('config_id');

  try {
    await disableForwardConfig(configId);
    
    await interaction.reply({ 
      content: `✅ Forward configuration ${configId} has been deleted.`,
      ephemeral: false
    });

    logSuccess(`Forward config ${configId} deleted by ${interaction.user.username}`);
  } catch (error) {
    if (error.message === 'Forward configuration not found') {
      await interaction.reply({ 
        content: `❌ Forward configuration ${configId} not found.`,
        ephemeral: true
      });
    } else {
      throw error; // Re-throw for general error handling
    }
  }
}

module.exports = {
  forwardCommand,
  handleForwardCommand
};