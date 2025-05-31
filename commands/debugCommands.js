const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getAllActiveForwardConfigs } = require('../utils/configManager');
const { logInfo, logSuccess, logError } = require('../utils/logger');

const debugCommand = new SlashCommandBuilder()
  .setName('debug')
  .setDescription('Debug information for ProForwarder')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('servers')
      .setDescription('List all servers the bot has access to')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('channels')
      .setDescription('List channels in current server with IDs')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('configs')
      .setDescription('Show current forward configurations')
  );

async function handleDebugCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case 'servers':
        await handleServers(interaction);
        break;
      case 'channels':
        await handleChannels(interaction);
        break;
      case 'configs':
        await handleConfigs(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown debug subcommand', ephemeral: true });
    }
  } catch (error) {
    logError('Error in debug command:', error);
    
    const errorMessage = 'An error occurred while processing the debug command.';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

async function handleServers(interaction) {
  const servers = interaction.client.guilds.cache;
  
  let response = `**🌐 Servers Bot Has Access To (${servers.size}):**\n\n`;
  
  for (const [id, guild] of servers) {
    const memberCount = guild.memberCount || 'Unknown';
    const channelCount = guild.channels.cache.filter(c => c.type === 0).size;
    
    response += `**${guild.name}**\n`;
    response += `• ID: \`${id}\`\n`;
    response += `• Members: ${memberCount}\n`;
    response += `• Text Channels: ${channelCount}\n`;
    response += `• Owner: ${guild.ownerId ? `<@${guild.ownerId}>` : 'Unknown'}\n\n`;
  }

  if (response.length > 2000) {
    // Split into multiple messages if too long
    const chunks = response.match(/[\s\S]{1,1900}/g) || [];
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await interaction.reply({ content: chunks[i], ephemeral: true });
      } else {
        await interaction.followUp({ content: chunks[i], ephemeral: true });
      }
    }
  } else {
    await interaction.reply({ content: response, ephemeral: true });
  }
}

async function handleChannels(interaction) {
  const channels = interaction.guild.channels.cache.filter(c => c.type === 0);
  
  let response = `**📋 Text Channels in ${interaction.guild.name}:**\n\n`;
  response += `**Server ID:** \`${interaction.guild.id}\`\n\n`;
  
  for (const [id, channel] of channels) {
    response += `**#${channel.name}**\n`;
    response += `• ID: \`${id}\`\n`;
    response += `• Position: ${channel.position}\n\n`;
  }

  if (response.length > 2000) {
    // Split into multiple messages if too long
    const chunks = response.match(/[\s\S]{1,1900}/g) || [];
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await interaction.reply({ content: chunks[i], ephemeral: true });
      } else {
        await interaction.followUp({ content: chunks[i], ephemeral: true });
      }
    }
  } else {
    await interaction.reply({ content: response, ephemeral: true });
  }
}

async function handleConfigs(interaction) {
  const configs = await getAllActiveForwardConfigs();
  
  if (configs.length === 0) {
    await interaction.reply({ content: '❌ No forward configurations found.', ephemeral: true });
    return;
  }

  let response = `**⚙️ Current Forward Configurations (${configs.length}):**\n\n`;
  
  for (const config of configs) {
    response += `**Config ${config.id}: ${config.name || 'Unnamed'}**\n`;
    response += `• Source Server: \`${config.sourceServerId}\`\n`;
    response += `• Source Channel: \`${config.sourceChannelId}\`\n`;
    response += `• Target Server: \`${config.targetServerId}\`\n`;
    response += `• Target Channel: \`${config.targetChannelId}\`\n`;
    response += `• Status: ${config.enabled !== false ? '✅ Active' : '❌ Disabled'}\n\n`;
    
    // Try to resolve server and channel names
    try {
      const sourceGuild = interaction.client.guilds.cache.get(config.sourceServerId);
      const targetGuild = interaction.client.guilds.cache.get(config.targetServerId);
      
      if (sourceGuild) {
        const sourceChannel = sourceGuild.channels.cache.get(config.sourceChannelId);
        response += `• Source: ${sourceChannel ? `#${sourceChannel.name}` : '❌ Channel not found'} in **${sourceGuild.name}**\n`;
      } else {
        response += `• Source: ❌ Server not accessible\n`;
      }
      
      if (targetGuild) {
        const targetChannel = targetGuild.channels.cache.get(config.targetChannelId);
        response += `• Target: ${targetChannel ? `#${targetChannel.name}` : '❌ Channel not found'} in **${targetGuild.name}**\n`;
      } else {
        response += `• Target: ❌ Server not accessible\n`;
      }
      
    } catch (error) {
      response += `• Resolution Error: ${error.message}\n`;
    }
    
    response += '\n---\n\n';
  }

  if (response.length > 2000) {
    // Split into multiple messages if too long
    const chunks = response.match(/[\s\S]{1,1900}/g) || [];
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await interaction.reply({ content: chunks[i], ephemeral: true });
      } else {
        await interaction.followUp({ content: chunks[i], ephemeral: true });
      }
    }
  } else {
    await interaction.reply({ content: response, ephemeral: true });
  }
}

module.exports = {
  debugCommand,
  handleDebugCommand
};