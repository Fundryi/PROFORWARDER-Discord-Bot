const { PermissionFlagsBits } = require('discord.js');

function buildConfigDisplayName(configItem) {
  if (!configItem) return 'Unnamed config';
  const name = String(configItem.name || '').trim();
  if (name) return name;
  const id = Number(configItem.id);
  if (Number.isFinite(id) && id > 0) return `Config ${id}`;
  return 'Unnamed config';
}

function buildReaderDiagnosticFailure(configItem, sourceBot, code, error, hint) {
  return {
    configId: Number.isFinite(Number(configItem && configItem.id))
      ? Number(configItem.id)
      : null,
    configName: buildConfigDisplayName(configItem),
    sourceServerId: String((configItem && configItem.sourceServerId) || ''),
    sourceChannelId: String((configItem && configItem.sourceChannelId) || ''),
    sourceBot,
    code,
    error,
    hint
  };
}

async function resolveGuildChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  let channel = guild.channels.cache.get(channelId);
  if (channel) return channel;
  try {
    channel = await guild.channels.fetch(channelId);
    return channel || null;
  } catch (_error) {
    return null;
  }
}

async function buildReaderStatusDiagnostics(mainClient, configs, { getReaderBotClient, isTextOrAnnouncementChannel }) {
  const runtimeConfig = require('../../config/config');
  const readerEnabled = Boolean(runtimeConfig.readerBot && runtimeConfig.readerBot.enabled);
  const readerClient = getReaderBotClient();
  const readerOnline = Boolean(readerClient && readerClient.isReady && readerClient.user);
  const readerInviteUrl = buildReaderInviteUrlFromClient(readerClient);
  const readerGuildCount = readerOnline ? readerClient.guilds.cache.size : 0;
  const failures = [];

  const items = Array.isArray(configs) ? configs : [];
  for (const configItem of items) {
    if (!configItem || configItem.sourceType !== 'discord') continue;

    const sourceServerId = String(configItem.sourceServerId || '').trim();
    const sourceChannelId = String(configItem.sourceChannelId || '').trim();
    const prefersReader = configItem.useReaderBot === true;
    const mainGuild = sourceServerId ? mainClient.guilds.cache.get(sourceServerId) : null;
    const readerGuild = readerOnline && sourceServerId ? readerClient.guilds.cache.get(sourceServerId) : null;

    if (!sourceServerId || !sourceChannelId) {
      failures.push(buildReaderDiagnosticFailure(
        configItem,
        prefersReader ? 'reader' : 'main',
        'invalid_source',
        'Config is missing source server/channel IDs.',
        'Edit or recreate this forward config with valid source IDs.'
      ));
      continue;
    }

    if (prefersReader && !readerEnabled) {
      failures.push(buildReaderDiagnosticFailure(
        configItem,
        'reader',
        'reader_disabled',
        'Reader bot is disabled but this config requires reader access.',
        'Set READER_BOT_ENABLED=true, provide READER_BOT_TOKEN, and restart the bot.'
      ));
      continue;
    }

    if (prefersReader && !readerOnline) {
      failures.push(buildReaderDiagnosticFailure(
        configItem,
        'reader',
        'reader_offline',
        'Reader bot is currently offline.',
        readerInviteUrl
          ? `Bring reader bot online and verify it remains in the source server. Invite link: ${readerInviteUrl}`
          : 'Bring reader bot online, then invite it to the source server if needed.'
      ));
      continue;
    }

    let sourceBot = 'main';
    let sourceGuild = mainGuild;
    let sourceBotUser = mainClient.user;

    if (prefersReader) {
      sourceBot = 'reader';
      sourceGuild = readerGuild;
      sourceBotUser = readerClient ? readerClient.user : null;
    } else if (!mainGuild && readerGuild) {
      sourceBot = 'reader';
      sourceGuild = readerGuild;
      sourceBotUser = readerClient ? readerClient.user : null;
    }

    if (!sourceGuild) {
      const hint = sourceBot === 'reader'
        ? (readerInviteUrl
          ? `Invite reader bot to source server ${sourceServerId}: ${readerInviteUrl}`
          : `Invite reader bot to source server ${sourceServerId} once it is online.`)
        : `Invite main bot back to source server ${sourceServerId} or remove/update this forward config.`;

      failures.push(buildReaderDiagnosticFailure(
        configItem,
        sourceBot,
        'source_guild_missing',
        `Source guild ${sourceServerId} is not available to the ${sourceBot} bot.`,
        hint
      ));
      continue;
    }

    if (!sourceBotUser) {
      failures.push(buildReaderDiagnosticFailure(
        configItem,
        sourceBot,
        'source_bot_unavailable',
        `Unable to resolve ${sourceBot} bot user in source guild cache.`,
        'Ensure the bot is online and fully connected before retrying diagnostics.'
      ));
      continue;
    }

    const sourceChannel = await resolveGuildChannel(sourceGuild, sourceChannelId);
    if (!sourceChannel) {
      failures.push(buildReaderDiagnosticFailure(
        configItem,
        sourceBot,
        'source_channel_missing',
        `Source channel ${sourceChannelId} was not found in guild ${sourceServerId}.`,
        'Channel may have been deleted or moved. Update/remove this config.'
      ));
      continue;
    }

    if (!isTextOrAnnouncementChannel(sourceChannel)) {
      failures.push(buildReaderDiagnosticFailure(
        configItem,
        sourceBot,
        'source_channel_type',
        'Source channel is not a text/announcement channel.',
        'Select a standard text or announcement channel as the source.'
      ));
      continue;
    }

    const sourcePermissions = sourceChannel.permissionsFor(sourceBotUser);
    if (!sourcePermissions || !sourcePermissions.has(PermissionFlagsBits.ViewChannel)) {
      failures.push(buildReaderDiagnosticFailure(
        configItem,
        sourceBot,
        'missing_view_channel',
        `${sourceBot === 'reader' ? 'Reader bot' : 'Main bot'} cannot view the source channel.`,
        `Grant View Channel permission to the ${sourceBot === 'reader' ? 'reader bot' : 'main bot'} in the source channel.`
      ));
      continue;
    }

    if (!sourcePermissions.has(PermissionFlagsBits.ReadMessageHistory)) {
      failures.push(buildReaderDiagnosticFailure(
        configItem,
        sourceBot,
        'missing_read_history',
        `${sourceBot === 'reader' ? 'Reader bot' : 'Main bot'} lacks Read Message History in the source channel.`,
        `Grant Read Message History permission to the ${sourceBot === 'reader' ? 'reader bot' : 'main bot'} in the source channel.`
      ));
      continue;
    }
  }

  failures.sort((a, b) => {
    const aId = Number.isFinite(a.configId) ? a.configId : Number.MAX_SAFE_INTEGER;
    const bId = Number.isFinite(b.configId) ? b.configId : Number.MAX_SAFE_INTEGER;
    if (aId !== bId) return aId - bId;
    return a.configName.localeCompare(b.configName);
  });

  return {
    readerBot: {
      enabled: readerEnabled,
      online: readerOnline,
      guildCount: readerGuildCount,
      username: readerOnline && readerClient.user ? readerClient.user.username : null,
      id: readerOnline && readerClient.user ? readerClient.user.id : null,
      inviteUrl: readerInviteUrl
    },
    diagnostics: {
      checkedConfigCount: items.length,
      failureCount: failures.length,
      failures
    }
  };
}

function buildReaderInviteUrlFromClient(readerClient) {
  if (!readerClient || !readerClient.user) return null;
  return `https://discord.com/oauth2/authorize?client_id=${readerClient.user.id}&permissions=66560&scope=bot`;
}

module.exports = {
  buildConfigDisplayName,
  buildReaderDiagnosticFailure,
  resolveGuildChannel,
  buildReaderStatusDiagnostics
};
