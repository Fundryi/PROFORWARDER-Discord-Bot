const { SlashCommandBuilder } = require('discord.js');
const config = require('../config/config');

const proforwarderCommand = new SlashCommandBuilder()
  .setName('proforwarder')
  .setDescription('Open ProForwarder Web Admin');

function getWebAdminUrlDetails() {
  const webAdmin = config && config.webAdmin ? config.webAdmin : {};
  const rawBase = String(webAdmin.baseUrl || '').trim().replace(/\/+$/, '');
  const authMode = String(webAdmin.authMode || 'local').trim().toLowerCase() === 'oauth'
    ? 'oauth'
    : 'local';

  const adminUrl = rawBase
    ? (rawBase.endsWith('/admin') ? rawBase : `${rawBase}/admin`)
    : '/admin';
  const loginUrl = adminUrl === '/admin' ? '/admin/login' : `${adminUrl}/login`;
  const isHttps = /^https:\/\//i.test(adminUrl);
  const canAutoAuth = authMode === 'oauth' && isHttps;

  return {
    adminUrl,
    loginUrl,
    authMode,
    canAutoAuth
  };
}

function buildPortalNotice(prefixMessage) {
  const details = getWebAdminUrlDetails();
  const lines = [];

  if (prefixMessage) {
    lines.push(prefixMessage);
    lines.push('');
  }

  lines.push(`🌐 Web Admin: ${details.adminUrl}`);

  if (details.canAutoAuth) {
    lines.push(`🔐 Direct login flow: ${details.loginUrl}`);
  } else if (details.authMode === 'oauth') {
    lines.push('ℹ️ OAuth mode detected. Set an HTTPS `WEB_ADMIN_BASE_URL` to enable direct login link behavior.');
  } else {
    lines.push('ℹ️ Local auth mode is enabled; open the admin from an allowed localhost environment.');
  }

  return lines.join('\n');
}

async function handleProforwarderCommand(interaction) {
  await interaction.reply({
    content: buildPortalNotice(),
    ephemeral: true
  });
}

module.exports = {
  proforwarderCommand,
  handleProforwarderCommand,
  getWebAdminUrlDetails,
  buildPortalNotice
};
