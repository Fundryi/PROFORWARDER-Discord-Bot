const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getBotSetting, setBotSetting, getMessageLogs, getFailedMessages } = require('../utils/database');
const { getConfigStats } = require('../utils/configManager');
const { getForwardHandler } = require('../events/messageEvents');
const { logInfo, logSuccess, logError } = require('../utils/logger');

const configCommand = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configure ProForwarder bot settings and view statistics')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('View forwarding statistics and bot status')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('retry-queue')
      .setDescription('View and manage the retry queue for failed messages')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('failed-messages')
      .setDescription('View recent failed message forwards')
      .addIntegerOption(option =>
        option
          .setName('limit')
          .setDescription('Number of failed messages to show (default: 10)')
          .setMinValue(1)
          .setMaxValue(50)
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('settings')
      .setDescription('View or modify bot settings')
      .addStringOption(option =>
        option
          .setName('setting')
          .setDescription('Setting to view or modify')
          .addChoices(
            { name: 'Debug Mode', value: 'debug_mode' },
            { name: 'Cross-Server Forwarding', value: 'cross_server_enabled' },
            { name: 'Reaction Forwarding', value: 'reaction_forwarding' },
            { name: 'Message Edit Forwarding', value: 'edit_forwarding' }
          )
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('value')
          .setDescription('New value for the setting (true/false)')
          .addChoices(
            { name: 'Enable', value: 'true' },
            { name: 'Disable', value: 'false' }
          )
          .setRequired(false)
      )
  );

async function handleConfigCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case 'stats':
        await handleStats(interaction);
        break;
      case 'retry-queue':
        await handleRetryQueue(interaction);
        break;
      case 'failed-messages':
        await handleFailedMessages(interaction);
        break;
      case 'settings':
        await handleSettings(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown subcommand', ephemeral: true });
    }
  } catch (error) {
    logError('Error in config command:', error);
    
    const errorMessage = 'An error occurred while processing the config command.';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

async function handleStats(interaction) {
  try {
    // Get message logs for statistics
    const recentLogs = await getMessageLogs(null, 1000); // Last 1000 messages
    const failedMessages = await getFailedMessages(100);
    
    // Calculate statistics
    const totalForwards = recentLogs.length;
    const successfulForwards = recentLogs.filter(log => log.status === 'success').length;
    const failedForwards = recentLogs.filter(log => log.status === 'failed').length;
    const successRate = totalForwards > 0 ? ((successfulForwards / totalForwards) * 100).toFixed(2) : 0;
    
    // Get recent activity (last 24 hours)
    const yesterday = Date.now() - (24 * 60 * 60 * 1000);
    const recentActivity = recentLogs.filter(log => log.forwardedAt > yesterday);
    
    // Get retry queue stats
    const forwardHandler = getForwardHandler();
    const retryStats = forwardHandler ? forwardHandler.getRetryQueueStats() : { queueSize: 0 };
    
    // Get config stats
    const configStats = await getConfigStats();
    
    // Build statistics embed
    const statsEmbed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle('📊 ProForwarder Statistics')
      .setDescription('Current bot performance and forwarding statistics')
      .addFields(
        {
          name: '📈 Overall Statistics',
          value: `**Total Forwards:** ${totalForwards.toLocaleString()}
          **Successful:** ${successfulForwards.toLocaleString()} (${successRate}%)
          **Failed:** ${failedForwards.toLocaleString()}
          **Success Rate:** ${successRate}%`,
          inline: true
        },
        {
          name: '🕐 Last 24 Hours',
          value: `**Recent Forwards:** ${recentActivity.length.toLocaleString()}
          **Currently in Retry Queue:** ${retryStats.queueSize}
          **Recent Failures:** ${failedMessages.filter(f => f.forwardedAt > yesterday).length}`,
          inline: true
        },
        {
          name: '🔧 Bot Status',
          value: `**Uptime:** <t:${Math.floor((Date.now() - interaction.client.uptime) / 1000)}:R>
          **Servers:** ${interaction.client.guilds.cache.size}
          **Channels Monitored:** ${interaction.client.channels.cache.filter(c => c.type === 0 || c.type === 5).size}`,
          inline: true
        },
        {
          name: '⚙️ Forward Configurations',
          value: `**Total Configs:** ${configStats.total}
          **Active:** ${configStats.active}
          **Same-Server:** ${configStats.sameServer}
          **Cross-Server:** ${configStats.crossServer}`,
          inline: true
        }
      );

    // Try to get emoji stats if available
    try {
      const { initializeAppEmojiManager } = require('../utils/webhookManager');
      const appEmojiManager = initializeAppEmojiManager(interaction.client);
      if (appEmojiManager) {
        const emojiStats = appEmojiManager.getEmojiStats();
        statsEmbed.addFields({
          name: '😀 Application Emojis',
          value: `**Uploaded:** ${emojiStats.cachedEmojis}/2000
          **Total Usage:** ${emojiStats.totalUsage}
          **Memory:** ${emojiStats.cacheMemoryUsage}`,
          inline: true
        });
      }
    } catch (emojiError) {
      // Emoji stats not available
    }

    statsEmbed.addFields(
        {
          name: '\u200b', // Empty field for spacing
          value: '\u200b',
          inline: false
        }
      )
      .setFooter({ text: 'Statistics based on recent activity' })
      .setTimestamp();

    await interaction.reply({ embeds: [statsEmbed], ephemeral: true });

  } catch (error) {
    logError('Error in handleStats:', error);
    await interaction.reply({ content: 'Failed to retrieve statistics.', ephemeral: true });
  }
}

async function handleRetryQueue(interaction) {
  try {
    const forwardHandler = getForwardHandler();
    
    if (!forwardHandler) {
      await interaction.reply({ content: 'Forward handler not initialized.', ephemeral: true });
      return;
    }

    const retryStats = forwardHandler.getRetryQueueStats();
    
    if (retryStats.queueSize === 0) {
      await interaction.reply({ content: '✅ Retry queue is empty - all messages processed successfully!', ephemeral: true });
      return;
    }

    let response = `**🔄 Retry Queue Status**\n\n**Queue Size:** ${retryStats.queueSize} items\n\n`;
    
    for (const item of retryStats.items.slice(0, 10)) { // Show max 10 items
      response += `**${item.key}**\n`;
      response += `• Attempts: ${item.attempts}/${item.maxRetries}\n`;
      response += `• Next Retry: <t:${Math.floor(item.nextRetry.getTime() / 1000)}:R>\n`;
      response += `• Error: ${item.error.substring(0, 100)}${item.error.length > 100 ? '...' : ''}\n\n`;
    }

    if (retryStats.queueSize > 10) {
      response += `*... and ${retryStats.queueSize - 10} more items*`;
    }

    await interaction.reply({ content: response, ephemeral: true });

  } catch (error) {
    logError('Error in handleRetryQueue:', error);
    await interaction.reply({ content: 'Failed to retrieve retry queue information.', ephemeral: true });
  }
}

async function handleFailedMessages(interaction) {
  try {
    const limit = interaction.options.getInteger('limit') || 10;
    const failedMessages = await getFailedMessages(limit);
    
    if (failedMessages.length === 0) {
      await interaction.reply({ content: '✅ No failed messages found!', ephemeral: true });
      return;
    }

    let response = `**❌ Failed Message Forwards (Last ${failedMessages.length})**\n\n`;
    
    for (const failed of failedMessages) {
      const timestamp = Math.floor(failed.forwardedAt / 1000);
      response += `**<t:${timestamp}:f>**\n`;
      response += `• Message: ${failed.originalMessageId} → ${failed.forwardedChannelId}\n`;
      response += `• Error: ${failed.errorMessage?.substring(0, 150) || 'Unknown error'}${failed.errorMessage?.length > 150 ? '...' : ''}\n\n`;
    }

    await interaction.reply({ content: response, ephemeral: true });

  } catch (error) {
    logError('Error in handleFailedMessages:', error);
    await interaction.reply({ content: 'Failed to retrieve failed messages.', ephemeral: true });
  }
}

async function handleSettings(interaction) {
  try {
    const setting = interaction.options.getString('setting');
    const value = interaction.options.getString('value');
    
    if (!setting) {
      // Show all current settings
      const settings = {
        'debug_mode': await getBotSetting('debug_mode') || 'false',
        'cross_server_enabled': await getBotSetting('cross_server_enabled') || 'true',
        'reaction_forwarding': await getBotSetting('reaction_forwarding') || 'true',
        'edit_forwarding': await getBotSetting('edit_forwarding') || 'true'
      };

      const settingsEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('⚙️ Bot Settings')
        .setDescription('Current ProForwarder configuration')
        .addFields(
          {
            name: 'Debug Mode',
            value: settings.debug_mode === 'true' ? '✅ Enabled' : '❌ Disabled',
            inline: true
          },
          {
            name: 'Cross-Server Forwarding',
            value: settings.cross_server_enabled === 'true' ? '✅ Enabled' : '❌ Disabled',
            inline: true
          },
          {
            name: 'Reaction Forwarding',
            value: settings.reaction_forwarding === 'true' ? '✅ Enabled' : '❌ Disabled',
            inline: true
          },
          {
            name: 'Message Edit Forwarding',
            value: settings.edit_forwarding === 'true' ? '✅ Enabled' : '❌ Disabled',
            inline: true
          }
        )
        .setFooter({ text: 'Use /config settings setting:<name> value:<true/false> to modify' });

      await interaction.reply({ embeds: [settingsEmbed], ephemeral: true });
      return;
    }

    if (!value) {
      // Show specific setting
      const currentValue = await getBotSetting(setting) || 'false';
      await interaction.reply({ 
        content: `**${setting}:** ${currentValue === 'true' ? 'Enabled' : 'Disabled'}`, 
        ephemeral: true 
      });
      return;
    }

    // Update setting
    await setBotSetting(setting, value);
    
    const settingNames = {
      'debug_mode': 'Debug Mode',
      'cross_server_enabled': 'Cross-Server Forwarding',
      'reaction_forwarding': 'Reaction Forwarding',
      'edit_forwarding': 'Message Edit Forwarding'
    };

    await interaction.reply({ 
      content: `✅ **${settingNames[setting]}** has been ${value === 'true' ? 'enabled' : 'disabled'}.`, 
      ephemeral: false 
    });

    logSuccess(`Setting ${setting} updated to ${value} by ${interaction.user.username}`);

  } catch (error) {
    logError('Error in handleSettings:', error);
    await interaction.reply({ content: 'Failed to manage settings.', ephemeral: true });
  }
}

module.exports = {
  configCommand,
  handleConfigCommand
};