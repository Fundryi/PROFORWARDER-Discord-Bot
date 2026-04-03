const {
  loadForwardConfigs
} = require('../../utils/configManager');
const {
  getMessageLogsFiltered,
  getFailedMessages,
  get: dbGet,
  all: dbAll
} = require('../../utils/database');

async function buildDebugDatabaseSnapshot(options = {}) {
  const logLimit = Math.max(5, Math.min(parseInt(options.logLimit, 10) || 20, 50));
  const failedLimit = Math.max(5, Math.min(parseInt(options.failedLimit, 10) || 20, 50));
  const settingLimit = Math.max(5, Math.min(parseInt(options.settingLimit, 10) || 20, 50));

  const tableNames = ['message_logs', 'bot_settings', 'telegram_chats', 'translation_threads'];
  const tableCounts = {};
  for (const tableName of tableNames) {
    const row = await dbGet(`SELECT COUNT(*) AS count FROM ${tableName}`);
    tableCounts[tableName] = Number(row && row.count ? row.count : 0);
  }

  const statusRows = await dbAll(`
    SELECT status, COUNT(*) AS count
    FROM message_logs
    GROUP BY status
    ORDER BY count DESC
  `);

  const discoveredViaRows = await dbAll(`
    SELECT discoveredVia, COUNT(*) AS count
    FROM telegram_chats
    GROUP BY discoveredVia
    ORDER BY count DESC
  `);

  const recentLogs = await getMessageLogsFiltered({ limit: logLimit });
  const failedLogs = await getFailedMessages(failedLimit);
  const recentSettings = await dbAll(
    'SELECT key, updatedAt FROM bot_settings ORDER BY updatedAt DESC LIMIT ?',
    [settingLimit]
  );

  const forwardConfigs = await loadForwardConfigs();
  const activeConfigs = forwardConfigs.filter(cfg => cfg && cfg.enabled !== false);
  const configSummary = {
    total: forwardConfigs.length,
    active: activeConfigs.length,
    disabled: forwardConfigs.length - activeConfigs.length,
    telegramTargets: activeConfigs.filter(cfg => cfg.targetType === 'telegram').length,
    discordTargets: activeConfigs.filter(cfg => cfg.targetType === 'discord').length,
    readerSources: activeConfigs.filter(cfg => cfg.useReaderBot === true).length
  };

  return {
    generatedAt: Date.now(),
    tableCounts,
    configSummary,
    statusCounts: statusRows.map(row => ({
      status: String(row.status || 'unknown'),
      count: Number(row.count || 0)
    })),
    discoveredViaCounts: discoveredViaRows.map(row => ({
      discoveredVia: String(row.discoveredVia || 'unknown'),
      count: Number(row.count || 0)
    })),
    recentLogs: recentLogs.map(log => ({
      id: Number(log.id),
      forwardedAt: Number(log.forwardedAt || 0),
      status: String(log.status || 'unknown'),
      configId: Number(log.configId || 0),
      originalMessageId: String(log.originalMessageId || ''),
      originalChannelId: String(log.originalChannelId || ''),
      forwardedMessageId: String(log.forwardedMessageId || ''),
      forwardedChannelId: String(log.forwardedChannelId || ''),
      errorMessage: log.errorMessage ? String(log.errorMessage).slice(0, 220) : ''
    })),
    failedLogs: failedLogs.map(log => ({
      id: Number(log.id),
      forwardedAt: Number(log.forwardedAt || 0),
      configId: Number(log.configId || 0),
      errorMessage: log.errorMessage ? String(log.errorMessage).slice(0, 300) : ''
    })),
    recentSettings: recentSettings.map(setting => ({
      key: String(setting.key || ''),
      updatedAt: Number(setting.updatedAt || 0)
    }))
  };
}

async function buildDebugMessageSearchSnapshot(messageId, options = {}) {
  const normalizedMessageId = String(messageId || '').trim();
  const limit = Math.max(10, Math.min(parseInt(options.limit, 10) || 200, 500));

  const [allCountRow, editCountRow] = await Promise.all([
    dbGet(
      `SELECT COUNT(*) AS count
       FROM message_logs
       WHERE originalMessageId = ? OR forwardedMessageId = ?`,
      [normalizedMessageId, normalizedMessageId]
    ),
    dbGet(
      `SELECT COUNT(*) AS count
       FROM message_logs
       WHERE originalMessageId = ? AND status = 'success'`,
      [normalizedMessageId]
    )
  ]);

  const [allMatches, editHandlerMatches] = await Promise.all([
    dbAll(
      `SELECT *
       FROM message_logs
       WHERE originalMessageId = ? OR forwardedMessageId = ?
       ORDER BY forwardedAt DESC
       LIMIT ?`,
      [normalizedMessageId, normalizedMessageId, limit]
    ),
    dbAll(
      `SELECT *
       FROM message_logs
       WHERE originalMessageId = ? AND status = 'success'
       ORDER BY forwardedAt DESC
       LIMIT ?`,
      [normalizedMessageId, limit]
    )
  ]);

  function mapLog(log) {
    return {
      id: Number(log.id),
      forwardedAt: Number(log.forwardedAt || 0),
      status: String(log.status || 'unknown'),
      configId: Number(log.configId || 0),
      originalMessageId: String(log.originalMessageId || ''),
      forwardedMessageId: String(log.forwardedMessageId || ''),
      errorMessage: log.errorMessage ? String(log.errorMessage).slice(0, 220) : ''
    };
  }

  const allTotal = Number(allCountRow && allCountRow.count ? allCountRow.count : 0);
  const editTotal = Number(editCountRow && editCountRow.count ? editCountRow.count : 0);

  return {
    messageId: normalizedMessageId,
    limit,
    allMatchesTotal: allTotal,
    editHandlerMatchesTotal: editTotal,
    allMatchesTruncated: allTotal > allMatches.length,
    editHandlerMatchesTruncated: editTotal > editHandlerMatches.length,
    allMatches: allMatches.map(mapLog),
    editHandlerMatches: editHandlerMatches.map(mapLog)
  };
}

module.exports = {
  buildDebugDatabaseSnapshot,
  buildDebugMessageSearchSnapshot
};
