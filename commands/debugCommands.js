const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getMessageLogs, all } = require('../utils/database');
const { logInfo } = require('../utils/logger');

const debugCommand = new SlashCommandBuilder()
  .setName('debug')
  .setDescription('Debug ProForwarder database and message tracking')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(subcommand =>
    subcommand
      .setName('database')
      .setDescription('Show recent database entries for message tracking')
      .addIntegerOption(option =>
        option
          .setName('limit')
          .setDescription('Number of entries to show (default: 10)')
          .setMinValue(1)
          .setMaxValue(50)
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('search')
      .setDescription('Search for a specific message in the database')
      .addStringOption(option =>
        option
          .setName('message_id')
          .setDescription('Original message ID to search for')
          .setRequired(true)
      )
  );

async function handleDebugCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case 'database':
        await handleDatabaseDebug(interaction);
        break;
      case 'search':
        await handleSearchDebug(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown subcommand', ephemeral: true });
    }
  } catch (error) {
    logInfo('Error in debug command:', error);
    
    const errorMessage = 'An error occurred while processing the debug command.';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

async function handleDatabaseDebug(interaction) {
  try {
    const limit = interaction.options.getInteger('limit') || 10;
    const logs = await getMessageLogs(null, limit);
    
    if (logs.length === 0) {
      await interaction.reply({ content: 'No message logs found in database.', ephemeral: true });
      return;
    }

    let response = `**🔍 Recent Database Entries (${logs.length} shown)**\n\n`;
    
    for (const log of logs) {
      const timestamp = Math.floor(log.forwardedAt / 1000);
      response += `**Entry ID:** ${log.id}\n`;
      response += `**Time:** <t:${timestamp}:f>\n`;
      response += `**Original:** \`${log.originalMessageId}\` (Channel: ${log.originalChannelId})\n`;
      response += `**Forwarded:** \`${log.forwardedMessageId}\` (Channel: ${log.forwardedChannelId})\n`;
      response += `**Status:** ${log.status}\n`;
      response += `**Config ID:** ${log.configId}\n`;
      if (log.errorMessage) {
        response += `**Error:** ${log.errorMessage.substring(0, 100)}...\n`;
      }
      response += '\n---\n\n';
    }

    // Split response if too long
    if (response.length > 2000) {
      const chunks = [];
      let currentChunk = '';
      const lines = response.split('\n');
      
      for (const line of lines) {
        if (currentChunk.length + line.length > 1900) {
          chunks.push(currentChunk);
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
      }
      if (currentChunk) chunks.push(currentChunk);
      
      await interaction.reply({ content: chunks[0], ephemeral: true });
      for (let i = 1; i < chunks.length && i < 3; i++) {
        await interaction.followUp({ content: chunks[i], ephemeral: true });
      }
    } else {
      await interaction.reply({ content: response, ephemeral: true });
    }

  } catch (error) {
    logInfo('Error in handleDatabaseDebug:', error);
    await interaction.reply({ content: 'Failed to retrieve database information.', ephemeral: true });
  }
}

async function handleSearchDebug(interaction) {
  try {
    const messageId = interaction.options.getString('message_id');
    
    // Search for the specific message
    const results = await all(`
      SELECT * FROM message_logs 
      WHERE originalMessageId = ? OR forwardedMessageId = ?
      ORDER BY forwardedAt DESC
    `, [messageId, messageId]);
    
    if (results.length === 0) {
      await interaction.reply({ 
        content: `❌ No database entries found for message ID: \`${messageId}\``, 
        ephemeral: true 
      });
      return;
    }

    let response = `**🔍 Search Results for Message ID: \`${messageId}\`**\n\n`;
    response += `Found ${results.length} entries:\n\n`;
    
    for (const result of results) {
      const timestamp = Math.floor(result.forwardedAt / 1000);
      response += `**Entry ${result.id}:** <t:${timestamp}:f>\n`;
      response += `• Original: \`${result.originalMessageId}\`\n`;
      response += `• Forwarded: \`${result.forwardedMessageId}\`\n`;
      response += `• Status: ${result.status}\n`;
      response += `• Config: ${result.configId}\n`;
      if (result.errorMessage) {
        response += `• Error: ${result.errorMessage.substring(0, 100)}...\n`;
      }
      response += '\n';
    }

    // Test the specific query that edit handler uses
    const { getMessageLogsByOriginalMessage } = require('../utils/database');
    const editResults = await getMessageLogsByOriginalMessage(messageId);
    response += `\n**Edit Handler Query Results:** ${editResults.length} entries\n`;
    
    if (editResults.length > 0) {
      for (const edit of editResults) {
        response += `• ${edit.originalMessageId} → ${edit.forwardedMessageId} (${edit.status})\n`;
      }
    }

    await interaction.reply({ content: response, ephemeral: true });

  } catch (error) {
    logInfo('Error in handleSearchDebug:', error);
    await interaction.reply({ content: 'Failed to search database.', ephemeral: true });
  }
}

module.exports = {
  debugCommand,
  handleDebugCommand
};