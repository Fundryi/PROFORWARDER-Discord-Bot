const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Get help with ProForwarder commands and features');

async function handleHelpCommand(interaction) {
  const helpEmbed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle('📨 ProForwarder Bot - Help')
    .setDescription('A powerful Discord bot for forwarding messages between channels and servers.')
    .addFields(
      {
        name: '🔧 Setup Commands',
        value: `\`/forward setup\` - Set up message forwarding between channels
        \`/forward list\` - List all active forward configurations
        \`/forward delete\` - Delete a forward configuration
        \`/config\` - Admin tools for monitoring and configuration`,
        inline: false
      },
      {
        name: '📋 How to Use',
        value: `1. **Same Server:** \`/forward setup source:#source target_channel:#target\`
        2. **Cross Server:** \`/forward setup source:#source target_channel:123456789 target_server:987654321\`
        3. Messages will be automatically forwarded in real-time
        4. Use \`/forward list\` to see all active configurations
        5. Use \`/forward delete config_id:X\` to remove configurations`,
        inline: false
      },
      {
        name: '🚀 Features',
        value: `✅ Same-server forwarding
        ✅ Cross-server forwarding
        ✅ Preserves text, embeds, and attachments
        ✅ Real-time message forwarding
        🔄 Message editing forwarding (coming soon)
        🗑️ Message deletion forwarding (coming soon)`,
        inline: false
      },
      {
        name: '🔒 Permissions',
        value: 'You need **Manage Channels** permission to set up forward configurations.',
        inline: false
      },
      {
        name: '💡 Examples',
        value: `**Same Server:** \`/forward setup source:#announcements target_channel:#general\`
        **Cross Server:** \`/forward setup source:#news target_channel:1375900190460084445 target_server:812312654705328154\`
        
        **Getting Channel IDs:** Right-click channel → Copy ID (requires Developer Mode)`,
        inline: false
      },
      {
        name: '📁 Configuration Storage',
        value: `Forward configurations are stored in \`config/env.js\` for easy management.
        You can also edit the config file directly to add or modify forwards.
        Message logs are stored in the database for efficiency.`,
        inline: false
      }
    )
    .setFooter({ 
      text: 'ProForwarder v1.0.0 | Use /forward setup to get started',
      iconURL: interaction.client.user.displayAvatarURL()
    })
    .setTimestamp();

  await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
}

module.exports = {
  helpCommand,
  handleHelpCommand
};