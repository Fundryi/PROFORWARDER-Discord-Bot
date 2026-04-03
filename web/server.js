const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { getWebAdminConfig, validateWebAdminConfig } = require('./lib/config');
const { evaluateLocalBypassRequest } = require('./lib/localBypass');
const {
  loadForwardConfigs,
  getForwardConfigById,
  addForwardConfig,
  getForwardConfigsForChannel,
  enableForwardConfig,
  disableForwardConfig,
  removeForwardConfig,
  getConfigStats,
  getAutoPublishConfig,
  setAutoPublishChannelEnabled
} = require('../utils/configManager');
const {
  getMessageLogs,
  getMessageLogsFiltered,
  deleteMessageLogsFiltered,
  getFailedMessages,
  getAllBotSettings,
  getBotSetting,
  setBotSetting,
  getTelegramChat,
  removeTelegramChat,
  get: dbGet,
  all: dbAll,
  run: dbRun
} = require('../utils/database');
const { logInfo, logSuccess, logError } = require('../utils/logger');
const { renderDashboardPage } = require('./views/dashboard');
const { buildReaderStatusDiagnostics } = require('./lib/readerDiagnostics');
const { clearTelegramDiscoveryCache, collectTelegramChatOptions, verifyAndTrackTelegramChatAccess } = require('./lib/telegramDiscovery');
const { buildDebugDatabaseSnapshot, buildDebugMessageSearchSnapshot } = require('./lib/debugDiagnostics');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GUILD_CACHE_REFRESH_TTL_MS = 15 * 1000;
const guildCacheRefreshState = new WeakMap();

function isMutatingApiRequest(req) {
  if (!req || !req.path || !req.method) return false;
  if (!req.path.startsWith('/api/')) return false;
  return MUTATING_METHODS.has(String(req.method).toUpperCase());
}

function isAuthSensitiveRoute(req) {
  if (!req || !req.path) return false;
  const pathName = String(req.path);
  return pathName === '/admin/login'
    || pathName === '/admin/callback'
    || pathName === '/admin/dev-login'
    || pathName === '/admin/bot-invite'
    || pathName === '/admin/bot-invite/callback';
}

function createSimpleRateLimiter(options = {}) {
  const max = Math.max(1, Number(options.max) || 60);
  const windowMs = Math.max(1000, Number(options.windowMs) || (60 * 1000));
  const keyPrefix = String(options.keyPrefix || 'rate');
  const buckets = new Map();

  function cleanup(now) {
    if (buckets.size <= 512) return;
    for (const [key, bucket] of buckets.entries()) {
      if (!bucket || bucket.expiresAt <= now) {
        buckets.delete(key);
      }
    }
  }

  return function checkLimit(rawKey) {
    const now = Date.now();
    cleanup(now);

    const key = `${keyPrefix}:${String(rawKey || 'unknown')}`;
    const existing = buckets.get(key);
    if (!existing || existing.expiresAt <= now) {
      buckets.set(key, {
        count: 1,
        expiresAt: now + windowMs
      });
      return {
        allowed: true,
        remaining: max - 1
      };
    }

    existing.count += 1;
    buckets.set(key, existing);

    if (existing.count > max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000))
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, max - existing.count)
    };
  };
}

class SQLiteSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.ttlMs = Math.max(60 * 1000, Number(options.ttlMs) || (24 * 60 * 60 * 1000));
    this.cleanupIntervalMs = Math.max(60 * 1000, Number(options.cleanupIntervalMs) || (15 * 60 * 1000));
    this.lastCleanupAt = 0;
    this.ready = this.initialize();
  }

  async initialize() {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS web_admin_sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_web_admin_sessions_expires ON web_admin_sessions(expiresAt)');
    await this.pruneExpiredSessions();
  }

  get(sid, callback) {
    this.withCallback(callback, async () => {
      await this.ready;
      await this.pruneExpiredSessionsIfNeeded();

      const row = await dbGet(
        'SELECT sess, expiresAt FROM web_admin_sessions WHERE sid = ?',
        [String(sid)]
      );

      if (!row) {
        return null;
      }

      if (Number(row.expiresAt) <= Date.now()) {
        await dbRun('DELETE FROM web_admin_sessions WHERE sid = ?', [String(sid)]);
        return null;
      }

      try {
        return JSON.parse(row.sess);
      } catch (_error) {
        await dbRun('DELETE FROM web_admin_sessions WHERE sid = ?', [String(sid)]);
        return null;
      }
    });
  }

  set(sid, sess, callback) {
    this.withCallback(callback, async () => {
      await this.ready;
      await this.pruneExpiredSessionsIfNeeded();

      const expiresAt = this.getExpiresAt(sess);
      await dbRun(
        `INSERT INTO web_admin_sessions (sid, sess, expiresAt, updatedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET
           sess = excluded.sess,
           expiresAt = excluded.expiresAt,
           updatedAt = excluded.updatedAt`,
        [
          String(sid),
          JSON.stringify(sess),
          expiresAt,
          Date.now()
        ]
      );
    });
  }

  destroy(sid, callback) {
    this.withCallback(callback, async () => {
      await this.ready;
      await dbRun('DELETE FROM web_admin_sessions WHERE sid = ?', [String(sid)]);
    });
  }

  touch(sid, sess, callback) {
    this.withCallback(callback, async () => {
      await this.ready;
      const expiresAt = this.getExpiresAt(sess);
      await dbRun(
        `UPDATE web_admin_sessions
         SET sess = ?, expiresAt = ?, updatedAt = ?
         WHERE sid = ?`,
        [
          JSON.stringify(sess),
          expiresAt,
          Date.now(),
          String(sid)
        ]
      );
    });
  }

  withCallback(callback, operation) {
    Promise.resolve()
      .then(operation)
      .then(result => callback && callback(null, result))
      .catch(error => callback && callback(error));
  }

  getExpiresAt(sess) {
    const cookie = sess && sess.cookie ? sess.cookie : null;
    const explicitExpires = cookie && cookie.expires ? new Date(cookie.expires).getTime() : NaN;
    if (Number.isFinite(explicitExpires)) {
      return explicitExpires;
    }

    if (cookie && typeof cookie.maxAge === 'number' && Number.isFinite(cookie.maxAge)) {
      return Date.now() + cookie.maxAge;
    }

    return Date.now() + this.ttlMs;
  }

  async pruneExpiredSessionsIfNeeded() {
    const now = Date.now();
    if ((now - this.lastCleanupAt) < this.cleanupIntervalMs) {
      return;
    }

    this.lastCleanupAt = now;
    await this.pruneExpiredSessions(now);
  }

  async pruneExpiredSessions(now = Date.now()) {
    await dbRun('DELETE FROM web_admin_sessions WHERE expiresAt <= ?', [now]);
  }
}

function buildDiscordAuthorizeUrl(webAdminConfig, state) {
  const params = new URLSearchParams({
    client_id: webAdminConfig.oauthClientId,
    redirect_uri: webAdminConfig.oauthRedirectUri,
    response_type: 'code',
    scope: webAdminConfig.oauthScopes,
    state
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

function createOauthStateToken(sessionSecret) {
  const issuedAt = Date.now().toString(36);
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${issuedAt}.${nonce}`;
  const signature = crypto
    .createHmac('sha256', String(sessionSecret || ''))
    .update(payload)
    .digest('hex');
  return `${payload}.${signature}`;
}

function verifyOauthStateToken(stateToken, sessionSecret, maxAgeMs = 10 * 60 * 1000) {
  const raw = String(stateToken || '');
  const parts = raw.split('.');
  if (parts.length !== 3) return false;

  const [issuedAtRaw, nonce, providedSignature] = parts;
  if (!issuedAtRaw || !nonce || !providedSignature) return false;

  const issuedAt = parseInt(issuedAtRaw, 36);
  if (!Number.isFinite(issuedAt)) return false;
  if ((Date.now() - issuedAt) > maxAgeMs) return false;

  const payload = `${issuedAtRaw}.${nonce}`;
  const expectedSignature = crypto
    .createHmac('sha256', String(sessionSecret || ''))
    .update(payload)
    .digest('hex');

  const providedBuffer = Buffer.from(providedSignature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  if (providedBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

async function exchangeCodeForToken(webAdminConfig, code, overrides) {
  const opts = overrides || {};
  const body = new URLSearchParams({
    client_id: opts.clientId || webAdminConfig.oauthClientId,
    client_secret: opts.clientSecret || webAdminConfig.oauthClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: opts.redirectUri || webAdminConfig.oauthRedirectUri
  });

  const response = await axios.post(
    'https://discord.com/api/oauth2/token',
    body.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    }
  );

  return response.data;
}

async function fetchDiscordUser(accessToken) {
  const response = await axios.get('https://discord.com/api/users/@me', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    timeout: 10000
  });
  return response.data;
}

async function fetchDiscordGuilds(accessToken) {
  const response = await axios.get('https://discord.com/api/users/@me/guilds', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    timeout: 10000
  });
  return response.data;
}

function renderLoginPage(webAdminConfig, errorMessage = '', localBypassAvailable = false) {
  const errorBlock = errorMessage
    ? `<div class="card error">${errorMessage}</div>`
    : '';
  const loginUrl = '/admin/login';
  const isLocalMode = webAdminConfig.authMode === 'local';
  const localBypassBlock = isLocalMode
    ? `<section class="card">
      <h2>Local Mode</h2>
      <p>Web admin is in localhost mode. Open this page from localhost and continue.</p>
      ${localBypassAvailable ? '<a class="button secondary" href="/admin">Continue to Admin</a>' : ''}
    </section>`
    : '';
  const oauthBlock = isLocalMode
    ? ''
    : `<section class="card">
      <h1>ProForwarder Admin</h1>
      <p>Login with Discord to access the web admin panel.</p>
      <a class="button" href="${loginUrl}">Login with Discord</a>
    </section>`;
  const modeLabel = isLocalMode ? 'local' : 'oauth';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ProForwarder Admin Login</title>
  <link rel="stylesheet" href="/admin/static/styles.css">
</head>
<body>
  <main class="layout">
    ${oauthBlock}
    ${localBypassBlock}
    ${errorBlock}
    <section class="card muted">
      <p>Web admin auth mode: ${modeLabel}</p>
      <p>Web admin base URL: ${webAdminConfig.baseUrl || '(not set)'}</p>
    </section>
  </main>
</body>
</html>`;
}

// renderAuthenticatedShell removed -- superseded by the tabbed dashboard

const BOT_SETTING_DEFINITIONS = {
  uploaded_emoji_names: {
    label: 'Uploaded Application Emoji Names',
    description: 'JSON array of sanitized emoji names tracked by the application emoji manager.',
    format: 'JSON array string',
    example: '["party_parrot","thonk"]',
    managedBy: 'Automatic (maintained by emoji sync/upload logic)'
  }
};

function parseUploadedEmojiNames(settings) {
  const target = settings.find(setting => setting && setting.key === 'uploaded_emoji_names');
  if (!target || typeof target.value !== 'string') {
    return { names: [], parseError: false };
  }

  try {
    const parsed = JSON.parse(target.value);
    if (!Array.isArray(parsed)) {
      return { names: [], parseError: true };
    }

    const names = Array.from(
      new Set(
        parsed
          .map(name => String(name || '').trim())
          .filter(Boolean)
      )
    );

    return { names, parseError: false };
  } catch (_error) {
    return { names: [], parseError: true };
  }
}

function normalizeUploadedEmojiNamesValue(rawValue) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawValue));
  } catch (_error) {
    return {
      valid: false,
      error: 'uploaded_emoji_names must be a valid JSON array string'
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      valid: false,
      error: 'uploaded_emoji_names must be a JSON array of names'
    };
  }

  const normalizedNames = Array.from(
    new Set(
      parsed
        .map(name => String(name || '').trim())
        .filter(Boolean)
    )
  );

  return {
    valid: true,
    value: JSON.stringify(normalizedNames)
  };
}

async function buildUploadedEmojiPreview(client, names) {
  const normalizedNames = Array.from(
    new Set(
      (Array.isArray(names) ? names : [])
        .map(name => String(name || '').trim())
        .filter(Boolean)
    )
  );

  const preview = {
    requestedNames: normalizedNames,
    matchedCount: 0,
    parseError: false,
    available: false,
    emojis: []
  };

  if (!normalizedNames.length) {
    return preview;
  }

  try {
    if (!client || !client.application || !client.application.emojis) {
      return preview;
    }

    const allEmojis = await client.application.emojis.fetch();
    const wanted = new Set(normalizedNames.map(name => name.toLowerCase()));

    const emojis = [];
    for (const emoji of allEmojis.values()) {
      const name = String(emoji.name || '');
      if (!wanted.has(name.toLowerCase())) {
        continue;
      }

      emojis.push({
        id: emoji.id,
        name,
        animated: Boolean(emoji.animated),
        imageUrl: emoji.imageURL({ size: 64 }) || null
      });
    }

    preview.available = true;
    preview.matchedCount = emojis.length;
    preview.emojis = emojis.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    logInfo(`Web admin emoji preview unavailable: ${error.message}`);
  }

  return preview;
}

// renderDashboardPage extracted to ./views/dashboard.js

function getAuthFromSession(req) {
  return req.session && req.session.webAdminAuth ? req.session.webAdminAuth : null;
}


function isLocalBypassRequestAllowed(req, webAdminConfig) {
  const decision = evaluateLocalBypassRequest(req, webAdminConfig);
  if (webAdminConfig.debug) {
    logInfo(
      `[WebAdmin Debug] Local bypass ${decision.allowed ? 'allowed' : 'denied'}: ` +
      `${decision.reason}; host=${decision.host || '(empty)'}; remoteIp=${decision.remoteIp || '(empty)'}`
    );
  }
  return decision.allowed;
}

function getEffectiveAuth(req, client, webAdminConfig) {
  const sessionAuth = getAuthFromSession(req);
  if (sessionAuth) return sessionAuth;

  if (webAdminConfig.authMode === 'local' && isLocalBypassRequestAllowed(req, webAdminConfig)) {
    req.session.webAdminAuth = buildLocalBypassAuth(client);
    return req.session.webAdminAuth;
  }

  return null;
}

function getReaderBotClient() {
  try {
    const { readerBot } = require('../index');
    if (!readerBot || !readerBot.client || !readerBot.client.user) return null;
    return readerBot.client;
  } catch (_error) {
    return null;
  }
}

function buildLocalBypassAuth(client) {
  const guildMap = new Map();

  for (const guild of client.guilds.cache.values()) {
    guildMap.set(guild.id, {
      id: guild.id,
      name: guild.name,
      permissions: String(PermissionFlagsBits.Administrator)
    });
  }

  const readerClient = getReaderBotClient();
  if (readerClient) {
    for (const guild of readerClient.guilds.cache.values()) {
      if (!guildMap.has(guild.id)) {
        guildMap.set(guild.id, {
          id: guild.id,
          name: guild.name,
          permissions: String(PermissionFlagsBits.Administrator)
        });
      }
    }
  }

  const oauthGuilds = Array.from(guildMap.values());

  return {
    user: {
      id: 'local-dev',
      username: 'local-dev',
      global_name: 'Local Dev',
      avatar: ''
    },
    oauthGuilds,
    loggedInAt: Date.now(),
    localBypass: true
  };
}

function buildConfigView(configItem) {
  return {
    id: configItem.id,
    name: configItem.name || '',
    sourceServerId: configItem.sourceServerId || '',
    sourceChannelId: configItem.sourceChannelId || '',
    useReaderBot: configItem.useReaderBot === true,
    targetType: configItem.targetType || '',
    targetServerId: configItem.targetServerId || '',
    targetChannelId: configItem.targetChannelId || '',
    targetChatId: configItem.targetChatId || '',
    enabled: configItem.enabled !== false,
    createdBy: configItem.createdBy || ''
  };
}

function buildOauthGuildMap(auth) {
  const map = new Map();
  const oauthGuilds = Array.isArray(auth.oauthGuilds) ? auth.oauthGuilds : [];
  for (const guild of oauthGuilds) {
    map.set(guild.id, guild);
  }
  return map;
}

async function getManageableGuilds(client, auth, allowedRoleIds) {
  if (!client || !client.isReady || !client.isReady()) return [];

  async function refreshGuildCache(targetClient) {
    const now = Date.now();
    const lastRefreshAt = guildCacheRefreshState.get(targetClient) || 0;
    if (now - lastRefreshAt < GUILD_CACHE_REFRESH_TTL_MS) return;

    try {
      await targetClient.guilds.fetch();
    } catch (_error) {
      // Continue with the current cache if Discord rejects the refresh.
    } finally {
      guildCacheRefreshState.set(targetClient, now);
    }
  }

  await refreshGuildCache(client);

  if (auth && auth.localBypass) {
    return Array.from(client.guilds.cache.values())
      .map(guild => ({ id: guild.id, name: guild.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const normalizedAllowedRoleIds = Array.isArray(allowedRoleIds) ? allowedRoleIds : [];
  const useRoleAllowlist = normalizedAllowedRoleIds.length > 0;
  const oauthGuildMap = buildOauthGuildMap(auth);
  const botGuilds = Array.from(client.guilds.cache.values());

  const checks = await Promise.all(botGuilds.map(async guild => {
    const oauthGuild = oauthGuildMap.get(guild.id);
    if (!oauthGuild) return null;

    try {
      const member = await guild.members.fetch(auth.user.id);
      const hasAllowedRole = useRoleAllowlist
        ? member.roles.cache.some(role => normalizedAllowedRoleIds.includes(role.id))
        : false;
      const isDiscordAdmin = !useRoleAllowlist && member.permissions.has(PermissionFlagsBits.Administrator);
      if (hasAllowedRole || isDiscordAdmin) {
        return {
          id: guild.id,
          name: guild.name
        };
      }
    } catch (error) {
      return null;
    }

    return null;
  }));

  return checks.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

async function getManageableSourceGuilds(mainClient, auth, allowedRoleIds) {
  const combined = new Map();

  const mainGuilds = await getManageableGuilds(mainClient, auth, allowedRoleIds);
  for (const guild of mainGuilds) {
    combined.set(guild.id, {
      id: guild.id,
      name: guild.name,
      sourceBot: 'main'
    });
  }

  const readerClient = getReaderBotClient();
  if (readerClient && readerClient.isReady && readerClient.isReady()) {
    const now = Date.now();
    const lastRefreshAt = guildCacheRefreshState.get(readerClient) || 0;
    if (now - lastRefreshAt >= GUILD_CACHE_REFRESH_TTL_MS) {
      try {
        await readerClient.guilds.fetch();
      } catch (_error) {
        // Continue with the current cache if Discord rejects the refresh.
      } finally {
        guildCacheRefreshState.set(readerClient, now);
      }
    }

    for (const guild of readerClient.guilds.cache.values()) {
      const existing = combined.get(guild.id);
      if (existing) {
        existing.sourceBot = 'both';
      } else {
        combined.set(guild.id, {
          id: guild.id,
          name: guild.name,
          sourceBot: 'reader'
        });
      }
    }
  }

  return Array.from(combined.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function isTextOrAnnouncementChannel(channel) {
  if (!channel) return false;
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}

function isDiscordId(value) {
  return typeof value === 'string' && /^\d+$/.test(value.trim());
}

function normalizeTelegramChatLookupValue(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;

  if (/^-?\d+$/.test(raw)) {
    return { lookupValue: raw, kind: 'chat_id' };
  }

  let candidate = raw;
  const resolveMatch = candidate.match(/^tg:\/\/resolve\?domain=([A-Za-z0-9_]{4,32})/i);
  if (resolveMatch) {
    candidate = resolveMatch[1];
  } else {
    candidate = candidate
      .replace(/^https?:\/\/t\.me\//i, '')
      .replace(/^t\.me\//i, '')
      .replace(/^@/, '');

    const slashIndex = candidate.indexOf('/');
    if (slashIndex >= 0) {
      candidate = candidate.slice(0, slashIndex);
    }

    const queryIndex = candidate.indexOf('?');
    if (queryIndex >= 0) {
      candidate = candidate.slice(0, queryIndex);
    }

    candidate = candidate.trim();
  }

  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(candidate)) {
    return null;
  }

  return { lookupValue: `@${candidate}`, kind: 'username' };
}

function parseConfigId(value) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function inferLogTargetType(log, configItem) {
  if (configItem && typeof configItem.targetType === 'string') {
    const normalized = configItem.targetType.trim().toLowerCase();
    if (normalized === 'discord' || normalized === 'telegram') {
      return normalized;
    }
  }

  if (!log) return 'unknown';
  const forwardedServerId = String(log.forwardedServerId || '').trim();
  const forwardedChannelId = String(log.forwardedChannelId || '').trim();
  if (!forwardedServerId && forwardedChannelId) {
    return 'telegram';
  }
  if (forwardedServerId || forwardedChannelId) {
    return 'discord';
  }
  return 'unknown';
}

function buildLogTargetLabel(log, targetType, configItem) {
  if (targetType === 'telegram') {
    const chatId = String(
      (configItem && configItem.targetChatId)
      || log.forwardedChannelId
      || '-'
    );
    return `Telegram ${chatId}`;
  }

  if (targetType === 'discord') {
    const serverId = String(
      (configItem && configItem.targetServerId)
      || log.forwardedServerId
      || ''
    ).trim();
    const channelId = String(
      (configItem && configItem.targetChannelId)
      || log.forwardedChannelId
      || ''
    ).trim();

    if (serverId && channelId) return `Discord ${serverId}:${channelId}`;
    if (channelId) return `Discord ${channelId}`;
    return 'Discord -';
  }

  return 'Unknown';
}

async function getAuthorizedGuildSet(client, auth, allowedRoleIds) {
  const guilds = await getManageableGuilds(client, auth, allowedRoleIds);
  return new Set(guilds.map(guild => guild.id));
}

async function getVisibleSourceGuildSet(client, auth, allowedRoleIds) {
  const guilds = await getManageableSourceGuilds(client, auth, allowedRoleIds);
  return new Set(guilds.map(guild => guild.id));
}

function mapGuildDebugSummary(guild) {
  if (!guild) return null;
  return {
    id: guild.id,
    name: guild.name,
    memberCount: guild.memberCount ?? null,
    joinedAt: guild.joinedAt ? guild.joinedAt.toISOString() : null
  };
}

async function tryFetchGuildSummary(client, guildId) {
  if (!client || !guildId) return null;
  try {
    const guild = await client.guilds.fetch(guildId);
    return {
      ok: true,
      guild: mapGuildDebugSummary(guild)
    };
  } catch (error) {
    return {
      ok: false,
      code: error && error.code ? error.code : null,
      message: error && error.message ? error.message : 'Unknown guild fetch error'
    };
  }
}

async function buildReaderBotDebugPayload(mainClient, auth, allowedRoleIds, requestedGuildId = '') {
  const startedAt = Date.now();
  const runtimeConfig = require('../config/config');
  const readerClient = getReaderBotClient();
  const oauthGuilds = Array.from(buildOauthGuildMap(auth).values())
    .map(guild => ({
      id: guild.id,
      name: guild.name || null,
      permissions: guild.permissions || null
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const mainCacheGuilds = Array.from(mainClient.guilds.cache.values())
    .map(mapGuildDebugSummary)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  const readerCacheGuilds = readerClient
    ? Array.from(readerClient.guilds.cache.values())
      .map(mapGuildDebugSummary)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const oauthGuildIdSet = new Set(oauthGuilds.map(guild => guild.id));
  const authorizedMainGuilds = await getManageableGuilds(mainClient, auth, allowedRoleIds);
  const visibleSourceGuilds = await getManageableSourceGuilds(mainClient, auth, allowedRoleIds);
  const readerVisibleGuilds = visibleSourceGuilds
    .filter(guild => guild.sourceBot === 'reader' || guild.sourceBot === 'both')
    .map(guild => ({
      id: guild.id,
      name: guild.name,
      sourceBot: guild.sourceBot
    }));
  const allConfigs = await loadForwardConfigs();
  const readerConfigs = (allConfigs || [])
    .filter(configItem => configItem && configItem.sourceType === 'discord' && configItem.useReaderBot === true)
    .map(configItem => ({
      id: configItem.id,
      name: configItem.name || '',
      enabled: configItem.enabled !== false,
      sourceServerId: configItem.sourceServerId || '',
      sourceChannelId: configItem.sourceChannelId || ''
    }))
    .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

  const normalizedRequestedGuildId = String(requestedGuildId || '').trim();

  return {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    auth: {
      userId: auth && auth.user ? auth.user.id : null,
      username: auth && auth.user ? (auth.user.username || auth.user.global_name || null) : null,
      localBypass: Boolean(auth && auth.localBypass),
      oauthGuildCount: oauthGuilds.length
    },
    requestedGuildId: normalizedRequestedGuildId || null,
    oauthGuilds,
    mainBot: {
      ready: Boolean(mainClient && mainClient.isReady && mainClient.isReady()),
      userId: mainClient && mainClient.user ? mainClient.user.id : null,
      username: mainClient && mainClient.user ? mainClient.user.username : null,
      cacheGuildCount: mainCacheGuilds.length,
      cacheGuilds: mainCacheGuilds,
      authorizedGuilds: authorizedMainGuilds,
      requestedGuildFetch: normalizedRequestedGuildId
        ? await tryFetchGuildSummary(mainClient, normalizedRequestedGuildId)
        : null
    },
    readerBot: {
      enabled: Boolean(runtimeConfig.readerBot && runtimeConfig.readerBot.enabled),
      ready: Boolean(readerClient && readerClient.isReady && readerClient.isReady()),
      userId: readerClient && readerClient.user ? readerClient.user.id : null,
      username: readerClient && readerClient.user ? readerClient.user.username : null,
      inviteUrl: buildReaderInviteUrlFromClient(readerClient),
      cacheGuildCount: readerCacheGuilds.length,
      cacheGuilds: readerCacheGuilds,
      visibleGuilds: readerVisibleGuilds,
      hiddenFromOauthGuilds: readerCacheGuilds.filter(guild => !oauthGuildIdSet.has(guild.id)),
      requestedGuildFetch: normalizedRequestedGuildId && readerClient
        ? await tryFetchGuildSummary(readerClient, normalizedRequestedGuildId)
        : null
    },
    authorizedMainGuilds,
    visibleSourceGuilds,
    readerConfigs
  };
}

function clearWebAdminSessionState(req) {
  if (!req || !req.session) return;
  delete req.session.webAdminAuth;
  delete req.session.oauthState;
  delete req.session.botInviteState;
  delete req.session.csrfToken;
}

function destroySession(req) {
  return new Promise(resolve => {
    if (!req || !req.session) {
      resolve();
      return;
    }

    req.session.destroy(() => resolve());
  });
}

function ensureCsrfToken(req) {
  if (!req || !req.session) return null;
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

function isProtectedWebAdminRequest(req) {
  const requestPath = String((req && req.path) || '');
  return requestPath === '/admin'
    || requestPath === '/admin/bot-invite'
    || requestPath.startsWith('/api/');
}

function getSourceGuildContexts(mainClient, guildId) {
  const contexts = {};
  const mainGuild = mainClient.guilds.cache.get(guildId);
  if (mainGuild) {
    contexts.main = {
      guild: mainGuild,
      botUser: mainClient.user,
      botType: 'main'
    };
  }

  const readerClient = getReaderBotClient();
  if (readerClient) {
    const readerGuild = readerClient.guilds.cache.get(guildId);
    if (readerGuild) {
      contexts.reader = {
        guild: readerGuild,
        botUser: readerClient.user,
        botType: 'reader'
      };
    }
  }

  return contexts;
}

function getSourceGuildContext(mainClient, guildId, requestedSourceBot = '') {
  const normalizedSourceBot = String(requestedSourceBot || '').trim().toLowerCase();
  const contexts = getSourceGuildContexts(mainClient, guildId);

  if (normalizedSourceBot === 'main') {
    return contexts.main || null;
  }
  if (normalizedSourceBot === 'reader') {
    return contexts.reader || null;
  }

  return contexts.main || contexts.reader || null;
}

function sortGuildChannels(channels) {
  return channels.sort((a, b) => {
    const aPos = typeof a.rawPosition === 'number' ? a.rawPosition : Number.MAX_SAFE_INTEGER;
    const bPos = typeof b.rawPosition === 'number' ? b.rawPosition : Number.MAX_SAFE_INTEGER;
    if (aPos !== bPos) return aPos - bPos;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function mapGuildChannels(guild, botUser, options = {}) {
  const {
    requireSendMessages = false,
    requireManageMessages = false,
    announcementOnly = false
  } = options;

  const channels = Array.from(guild.channels.cache.values()).filter(channel => {
    if (!channel) return false;
    if (!isTextOrAnnouncementChannel(channel)) return false;
    if (announcementOnly && channel.type !== ChannelType.GuildAnnouncement) return false;

    const perms = channel.permissionsFor(botUser);
    if (!perms || !perms.has(PermissionFlagsBits.ViewChannel)) return false;
    if (requireSendMessages && !perms.has(PermissionFlagsBits.SendMessages)) return false;
    if (requireManageMessages && !perms.has(PermissionFlagsBits.ManageMessages)) return false;
    return true;
  });

  return sortGuildChannels(channels).map(channel => ({
    id: channel.id,
    name: channel.name,
    type: channel.type === ChannelType.GuildAnnouncement ? 'announcement' : 'text'
  }));
}

function buildReaderInviteUrlFromClient(readerClient) {
  if (!readerClient || !readerClient.user) return null;
  return `https://discord.com/oauth2/authorize?client_id=${readerClient.user.id}&permissions=66560&scope=bot`;
}



function createWebAdminApp(client, config) {
  const webAdminConfig = getWebAdminConfig(config);
  const app = express();

  if (webAdminConfig.trustProxy) {
    app.set('trust proxy', 1);
  }

  const sessionTtlMs = Math.max(1, webAdminConfig.sessionTtlHours) * 60 * 60 * 1000;
  const sessionStore = new SQLiteSessionStore({ ttlMs: sessionTtlMs });

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use('/admin/static', express.static(path.join(__dirname, 'public')));
  app.use(session({
    name: 'proforwarder_admin',
    secret: webAdminConfig.sessionSecret || crypto.randomBytes(32).toString('hex'),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: webAdminConfig.trustProxy,
      maxAge: sessionTtlMs
    }
  }));

  app.use(async (req, res, next) => {
    if (!isProtectedWebAdminRequest(req)) {
      next();
      return;
    }

    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth || auth.localBypass) {
      next();
      return;
    }

    try {
      const allowedGuildIds = await getAuthorizedGuildSet(client, auth, webAdminConfig.allowedRoleIds);
      if (allowedGuildIds.size > 0) {
        next();
        return;
      }

      clearWebAdminSessionState(req);
      await destroySession(req);
      const errorMessage = 'Your Discord account is not authorized for this web admin.';
      if (req.path.startsWith('/api/')) {
        res.status(403).json({ error: errorMessage });
        return;
      }

      const localBypassAvailable = isLocalBypassRequestAllowed(req, webAdminConfig);
      res.status(403).send(renderLoginPage(webAdminConfig, errorMessage, localBypassAvailable));
    } catch (error) {
      logError(`Web admin authorization check failed: ${error.message}`);
      if (req.path.startsWith('/api/')) {
        res.status(500).json({ error: 'Failed to verify web admin authorization' });
        return;
      }
      res.status(500).send('Failed to verify web admin authorization.');
    }
  });

  if (webAdminConfig.securityStrict) {
    const authLimiter = createSimpleRateLimiter({
      keyPrefix: 'webauth',
      windowMs: webAdminConfig.authRateLimitWindowMs,
      max: webAdminConfig.authRateLimitMax
    });
    const mutationLimiter = createSimpleRateLimiter({
      keyPrefix: 'webmut',
      windowMs: webAdminConfig.mutationRateLimitWindowMs,
      max: webAdminConfig.mutationRateLimitMax
    });

    app.use((req, res, next) => {
      const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');

      if (isAuthSensitiveRoute(req)) {
        const decision = authLimiter(`${ip}:${req.path}`);
        if (!decision.allowed) {
          res.set('Retry-After', String(decision.retryAfterSeconds || 60));
          res.status(429).send('Too many auth requests. Please retry shortly.');
          return;
        }
      }

      if (isMutatingApiRequest(req)) {
        const actor = (req.session && req.session.webAdminAuth && req.session.webAdminAuth.user && req.session.webAdminAuth.user.id)
          ? req.session.webAdminAuth.user.id
          : ip;
        const decision = mutationLimiter(String(actor));
        if (!decision.allowed) {
          res.set('Retry-After', String(decision.retryAfterSeconds || 60));
          res.status(429).json({ error: 'Too many mutation requests. Please retry shortly.' });
          return;
        }
      }

      next();
    });

    app.use((req, res, next) => {
      if (!isMutatingApiRequest(req)) {
        next();
        return;
      }

      const expectedToken = req.session ? req.session.csrfToken : '';
      const providedToken = req.get('x-csrf-token') || '';
      if (!expectedToken || !providedToken || providedToken !== expectedToken) {
        res.status(403).json({ error: 'Invalid CSRF token' });
        return;
      }

      next();
    });

    app.use((req, res, next) => {
      if (!isMutatingApiRequest(req)) {
        next();
        return;
      }

      const startedAt = Date.now();
      res.on('finish', () => {
        if (res.statusCode >= 500) return;
        const auth = getAuthFromSession(req);
        const actor = auth && auth.user
          ? (auth.user.username || auth.user.id)
          : String(req.ip || req.socket?.remoteAddress || 'unknown');
        logInfo(
          `Web admin mutation audit: actor=${actor}; method=${req.method}; path=${req.path}; ` +
          `status=${res.statusCode}; durationMs=${Date.now() - startedAt}`
        );
      });
      next();
    });
  }

  app.get('/', (req, res) => res.redirect('/admin'));

  app.get('/admin/login', (req, res) => {
    if (webAdminConfig.authMode === 'local') {
      if (isLocalBypassRequestAllowed(req, webAdminConfig)) {
        req.session.webAdminAuth = buildLocalBypassAuth(client);
        delete req.session.oauthState;
        res.redirect('/admin');
        return;
      }

      res.status(403).send(renderLoginPage(
        webAdminConfig,
        'Local mode only allows localhost requests.',
        false
      ));
      return;
    }

    if (!webAdminConfig.oauthClientId || !webAdminConfig.oauthClientSecret || !webAdminConfig.oauthRedirectUri) {
      const localBypassAvailable = isLocalBypassRequestAllowed(req, webAdminConfig);
      res.status(400).send(renderLoginPage(
        webAdminConfig,
        'OAuth is not configured. Set Discord OAuth env values.',
        localBypassAvailable
      ));
      return;
    }

    const state = createOauthStateToken(webAdminConfig.sessionSecret);
    res.redirect(buildDiscordAuthorizeUrl(webAdminConfig, state));
  });

  app.get('/admin/dev-login', (req, res) => {
    if (webAdminConfig.authMode !== 'local' || !isLocalBypassRequestAllowed(req, webAdminConfig)) {
      res.status(403).send(renderLoginPage(
        webAdminConfig,
        'Local mode is not allowed for this request origin.',
        false
      ));
      return;
    }

    req.session.webAdminAuth = buildLocalBypassAuth(client);
    delete req.session.oauthState;
    res.redirect('/admin');
  });

  app.get('/admin/callback', async (req, res) => {
    if (webAdminConfig.authMode !== 'oauth') {
      res.redirect('/admin');
      return;
    }

    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      clearWebAdminSessionState(req);
      await destroySession(req);
      logError(`Web admin OAuth error: ${errorDescription || error}`);
      const localBypassAvailable = isLocalBypassRequestAllowed(req, webAdminConfig);
      res.status(400).send(renderLoginPage(webAdminConfig, 'OAuth login failed.', localBypassAvailable));
      return;
    }

    if (!code || !state || !verifyOauthStateToken(state, webAdminConfig.sessionSecret)) {
      clearWebAdminSessionState(req);
      await destroySession(req);
      const localBypassAvailable = isLocalBypassRequestAllowed(req, webAdminConfig);
      res.status(400).send(renderLoginPage(webAdminConfig, 'Invalid OAuth state.', localBypassAvailable));
      return;
    }

    try {
      const tokenData = await exchangeCodeForToken(webAdminConfig, code);
      const user = await fetchDiscordUser(tokenData.access_token);
      let guilds = [];
      try {
        guilds = await fetchDiscordGuilds(tokenData.access_token);
      } catch (guildError) {
        logInfo(`Web admin OAuth guild fetch skipped: ${guildError.message}`);
      }

      const sessionAuth = {
        user: {
          id: user.id,
          username: user.username,
          global_name: user.global_name || '',
          avatar: user.avatar || ''
        },
        oauthGuilds: Array.isArray(guilds) ? guilds : [],
        loggedInAt: Date.now()
      };

      const allowedGuildIds = await getAuthorizedGuildSet(client, sessionAuth, webAdminConfig.allowedRoleIds);
      if (allowedGuildIds.size === 0) {
        clearWebAdminSessionState(req);
        await destroySession(req);
        const localBypassAvailable = isLocalBypassRequestAllowed(req, webAdminConfig);
        res.status(403).send(renderLoginPage(
          webAdminConfig,
          'Your Discord account is not authorized for this web admin.',
          localBypassAvailable
        ));
        return;
      }

      req.session.webAdminAuth = sessionAuth;
      delete req.session.oauthState;
      if (webAdminConfig.securityStrict) {
        ensureCsrfToken(req);
      }

      res.redirect('/admin');
    } catch (oauthError) {
      clearWebAdminSessionState(req);
      await destroySession(req);
      logError(`Web admin OAuth callback failed: ${oauthError.message}`);
      const localBypassAvailable = isLocalBypassRequestAllowed(req, webAdminConfig);
      res.status(500).send(renderLoginPage(
        webAdminConfig,
        'OAuth callback failed. Check server logs.',
        localBypassAvailable
      ));
    }
  });

  app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/admin');
    });
  });

  app.get('/admin', (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      const localBypassAvailable = isLocalBypassRequestAllowed(req, webAdminConfig);
      res.status(200).send(renderLoginPage(webAdminConfig, '', localBypassAvailable));
      return;
    }

    res.status(200).send(renderDashboardPage(auth, webAdminConfig));
  });

  app.get('/admin/shell', (req, res) => {
    res.redirect('/admin');
  });

  app.get('/api/me', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const guilds = await getManageableSourceGuilds(client, auth, webAdminConfig.allowedRoleIds);
      const csrfToken = webAdminConfig.securityStrict ? ensureCsrfToken(req) : null;
      res.json({
        user: auth.user,
        guilds,
        csrfToken
      });
    } catch (error) {
      logError(`Web admin /api/me failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load user context' });
    }
  });

  app.get('/api/form-options', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const manageableSourceGuilds = await getManageableSourceGuilds(client, auth, webAdminConfig.allowedRoleIds);
      const manageableTargetGuilds = await getManageableGuilds(client, auth, webAdminConfig.allowedRoleIds);
      const sourceGuilds = [];
      const targetGuilds = [];

      for (const sourceMeta of manageableSourceGuilds) {
        const sourceContexts = getSourceGuildContexts(client, sourceMeta.id);
        const mainContext = sourceContexts.main || null;
        const readerContext = sourceContexts.reader || null;
        const fallbackContext = mainContext || readerContext;
        if (!fallbackContext || !fallbackContext.guild) continue;

        const sourceBots = {};
        if (mainContext && mainContext.guild) {
          sourceBots.main = {
            available: true,
            sourceChannels: mapGuildChannels(mainContext.guild, mainContext.botUser)
          };
        }
        if (readerContext && readerContext.guild) {
          sourceBots.reader = {
            available: true,
            sourceChannels: mapGuildChannels(readerContext.guild, readerContext.botUser)
          };
        }

        const defaultSourceBot = sourceMeta.sourceBot === 'reader' && sourceBots.reader
          ? 'reader'
          : (sourceBots.main ? 'main' : (sourceBots.reader ? 'reader' : 'main'));
        const defaultSourceChannels = sourceBots[defaultSourceBot]
          ? sourceBots[defaultSourceBot].sourceChannels
          : [];

        sourceGuilds.push({
          id: fallbackContext.guild.id,
          name: fallbackContext.guild.name,
          sourceBot: sourceMeta.sourceBot,
          defaultSourceBot,
          sourceChannels: defaultSourceChannels,
          sourceBots
        });
      }

      for (const targetMeta of manageableTargetGuilds) {
        const targetGuild = client.guilds.cache.get(targetMeta.id);
        if (!targetGuild) continue;

        targetGuilds.push({
          id: targetGuild.id,
          name: targetGuild.name,
          targetChannels: mapGuildChannels(targetGuild, client.user, { requireSendMessages: true })
        });
      }

      const telegram = await collectTelegramChatOptions();

      res.json({
        sourceGuilds,
        targetGuilds,
        telegram
      });
    } catch (error) {
      logError(`Web admin /api/form-options failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load setup form options' });
    }
  });

  app.get('/api/configs', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const guildId = (req.query.guildId || '').trim();
    if (!guildId) {
      res.status(400).json({ error: 'guildId is required' });
      return;
    }

    try {
      const guilds = await getManageableSourceGuilds(client, auth, webAdminConfig.allowedRoleIds);
      const canAccess = guilds.some(guild => guild.id === guildId);
      if (!canAccess) {
        res.status(403).json({ error: 'Forbidden for this guild' });
        return;
      }

      const allConfigs = await loadForwardConfigs();
      const guildConfigs = allConfigs
        .filter(configItem => configItem.sourceServerId === guildId)
        .sort((a, b) => a.id - b.id)
        .map(buildConfigView);

      // Enrich Telegram configs with target health status from tracked chats
      for (const cfg of guildConfigs) {
        if (cfg.targetType !== 'telegram' || !cfg.targetChatId) continue;
        try {
          const tracked = await getTelegramChat(cfg.targetChatId);
          if (tracked) {
            cfg.telegramChatTitle = tracked.title || null;
            cfg.telegramChatType = tracked.type || null;
            if (tracked.memberStatus === 'left' || tracked.memberStatus === 'kicked') {
              cfg.targetStatus = 'unreachable';
            }
          }
        } catch (_) { /* best-effort enrichment */ }
      }

      res.json({
        guildId,
        configs: guildConfigs
      });
    } catch (error) {
      logError(`Web admin /api/configs failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load configs' });
    }
  });

  app.post('/api/configs', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const guildId = typeof req.body.guildId === 'string' ? req.body.guildId.trim() : '';
    if (!guildId) {
      res.status(400).json({ error: 'guildId is required' });
      return;
    }

    const sourceChannelId = typeof req.body.sourceChannelId === 'string' ? req.body.sourceChannelId.trim() : '';
    const sourceBotInput = typeof req.body.sourceBot === 'string' ? req.body.sourceBot.trim().toLowerCase() : '';
    const targetType = typeof req.body.targetType === 'string' ? req.body.targetType.trim().toLowerCase() : '';
    const customName = typeof req.body.name === 'string' ? req.body.name.trim() : '';

    if (!isDiscordId(sourceChannelId)) {
      res.status(400).json({ error: 'sourceChannelId must be a numeric Discord ID' });
      return;
    }

    if (targetType !== 'discord' && targetType !== 'telegram') {
      res.status(400).json({ error: 'targetType must be discord or telegram' });
      return;
    }
    if (sourceBotInput && sourceBotInput !== 'main' && sourceBotInput !== 'reader') {
      res.status(400).json({ error: 'sourceBot must be main or reader when provided' });
      return;
    }

    try {
      const allowedGuilds = await getVisibleSourceGuildSet(client, auth, webAdminConfig.allowedRoleIds);
      if (!allowedGuilds.has(guildId)) {
        res.status(403).json({ error: 'Forbidden for this guild' });
        return;
      }

      const sourceContexts = getSourceGuildContexts(client, guildId);
      const selectedSourceBot = sourceBotInput || (sourceContexts.main ? 'main' : 'reader');
      const sourceContext = selectedSourceBot === 'reader'
        ? (sourceContexts.reader || null)
        : (sourceContexts.main || null);
      if (!sourceContext || !sourceContext.guild) {
        const unavailableMsg = selectedSourceBot === 'reader'
          ? 'Selected source bot (reader) is not in this guild'
          : 'Selected source bot (main) is not in this guild';
        res.status(400).json({ error: unavailableMsg });
        return;
      }
      const sourceGuild = sourceContext.guild;
      const sourceBotUser = sourceContext.botUser;

      let sourceChannel = sourceGuild.channels.cache.get(sourceChannelId);
      if (!sourceChannel) {
        try {
          sourceChannel = await sourceGuild.channels.fetch(sourceChannelId);
        } catch (error) {
          sourceChannel = null;
        }
      }
      if (!isTextOrAnnouncementChannel(sourceChannel)) {
        res.status(400).json({ error: 'Source channel must be a text or announcement channel' });
        return;
      }
      const sourcePermissions = sourceChannel.permissionsFor(sourceBotUser);
      if (!sourcePermissions || !sourcePermissions.has(PermissionFlagsBits.ViewChannel)) {
        res.status(400).json({ error: 'Selected source channel is not readable by the source bot' });
        return;
      }

      const newConfig = {
        sourceType: 'discord',
        sourceServerId: guildId,
        sourceChannelId,
        useReaderBot: selectedSourceBot === 'reader',
        targetType,
        createdBy: auth.user.id
      };

      if (targetType === 'discord') {
        const targetChannelId = typeof req.body.targetChannelId === 'string' ? req.body.targetChannelId.trim() : '';
        const targetServerIdRaw = typeof req.body.targetServerId === 'string' ? req.body.targetServerId.trim() : '';
        const targetServerId = targetServerIdRaw || guildId;

        if (!isDiscordId(targetChannelId)) {
          res.status(400).json({ error: 'targetChannelId must be a numeric Discord ID' });
          return;
        }
        if (!isDiscordId(targetServerId)) {
          res.status(400).json({ error: 'targetServerId must be a numeric Discord ID' });
          return;
        }

        const targetGuild = client.guilds.cache.get(targetServerId);
        if (!targetGuild) {
          res.status(400).json({ error: 'Target guild not found in bot cache' });
          return;
        }

        let targetChannel = targetGuild.channels.cache.get(targetChannelId);
        if (!targetChannel) {
          try {
            targetChannel = await targetGuild.channels.fetch(targetChannelId);
          } catch (error) {
            targetChannel = null;
          }
        }
        if (!isTextOrAnnouncementChannel(targetChannel)) {
          res.status(400).json({ error: 'Target channel must be a text or announcement channel' });
          return;
        }

        if (guildId === targetServerId && sourceChannelId === targetChannelId) {
          res.status(400).json({ error: 'Source and target channels cannot be the same' });
          return;
        }

        newConfig.targetServerId = targetServerId;
        newConfig.targetChannelId = targetChannelId;
        newConfig.name = customName || `${sourceChannel.name} to ${targetChannel.name}`;
      } else {
        const targetChatInput = typeof req.body.targetChatId === 'string' ? req.body.targetChatId.trim() : '';
        const targetChatLookup = normalizeTelegramChatLookupValue(targetChatInput);
        if (!targetChatLookup) {
          res.status(400).json({ error: 'targetChatId must be a valid Telegram chat ID, @username, or t.me link' });
          return;
        }

        let verifiedChat;
        try {
          verifiedChat = await verifyAndTrackTelegramChatAccess(targetChatLookup.lookupValue, { discoveredVia: 'config_create' });
        } catch (verifyError) {
          const statusCode = Number(verifyError && verifyError.statusCode) || 400;
          res.status(statusCode).json({ error: verifyError.message || 'Failed to verify Telegram chat access' });
          return;
        }

        newConfig.targetChatId = verifiedChat.id;
        newConfig.name = customName || `${sourceChannel.name} to Telegram`;
      }

      const configId = await addForwardConfig(newConfig);
      const created = await getForwardConfigById(configId);
      if (!created) {
        res.status(500).json({ error: 'Config created but could not be reloaded' });
        return;
      }
      clearTelegramDiscoveryCache();

      res.status(201).json({
        config: buildConfigView(created)
      });
    } catch (error) {
      logError(`Web admin create config failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to create config' });
    }
  });

  app.patch('/api/configs/:id', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const configId = parseConfigId(req.params.id);
    if (!configId) {
      res.status(400).json({ error: 'Invalid config id' });
      return;
    }

    if (typeof req.body.enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be boolean' });
      return;
    }

    try {
      const existing = await getForwardConfigById(configId);
      if (!existing) {
        res.status(404).json({ error: 'Config not found' });
        return;
      }

      const allowedGuilds = await getVisibleSourceGuildSet(client, auth, webAdminConfig.allowedRoleIds);
      if (!allowedGuilds.has(existing.sourceServerId)) {
        res.status(403).json({ error: 'Forbidden for this guild' });
        return;
      }

      if (req.body.enabled) {
        await enableForwardConfig(configId);
      } else {
        await disableForwardConfig(configId);
      }

      const updated = await getForwardConfigById(configId);
      if (!updated) {
        res.status(500).json({ error: 'Config update succeeded but reload failed' });
        return;
      }

      res.json({
        config: buildConfigView(updated)
      });
    } catch (error) {
      logError(`Web admin toggle config failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  app.delete('/api/configs/:id', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const configId = parseConfigId(req.params.id);
    if (!configId) {
      res.status(400).json({ error: 'Invalid config id' });
      return;
    }

    try {
      const existing = await getForwardConfigById(configId);
      if (!existing) {
        res.status(404).json({ error: 'Config not found' });
        return;
      }

      const allowedGuilds = await getVisibleSourceGuildSet(client, auth, webAdminConfig.allowedRoleIds);
      if (!allowedGuilds.has(existing.sourceServerId)) {
        res.status(403).json({ error: 'Forbidden for this guild' });
        return;
      }

      await removeForwardConfig(configId);
      clearTelegramDiscoveryCache();

      let deletedLogs = 0;
      try {
        deletedLogs = await deleteMessageLogsFiltered({ configId });
      } catch (cleanupError) {
        logError(`Web admin remove config log cleanup failed for config ${configId}: ${cleanupError.message}`);
      }

      res.json({ success: true, removedConfigId: configId, deletedLogs });
    } catch (error) {
      logError(`Web admin remove config failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to remove config' });
    }
  });

  app.post('/api/configs/:id/test-telegram', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const configId = parseConfigId(req.params.id);
    if (!configId) {
      res.status(400).json({ error: 'Invalid config id' });
      return;
    }

    try {
      const existing = await getForwardConfigById(configId);
      if (!existing) {
        res.status(404).json({ error: 'Config not found' });
        return;
      }

      const allowedGuilds = await getVisibleSourceGuildSet(client, auth, webAdminConfig.allowedRoleIds);
      if (!allowedGuilds.has(existing.sourceServerId)) {
        res.status(403).json({ error: 'Forbidden for this guild' });
        return;
      }

      if (existing.targetType !== 'telegram') {
        res.status(400).json({ error: 'Config target is not Telegram' });
        return;
      }

      const runtimeConfig = require('../config/config');
      if (!runtimeConfig.telegram || runtimeConfig.telegram.enabled !== true) {
        res.status(400).json({ error: 'Telegram integration is disabled' });
        return;
      }

      const TelegramHandler = require('../handlers/telegramHandler');
      const telegramHandler = new TelegramHandler();
      const initialized = await telegramHandler.initialize();
      if (!initialized) {
        res.status(500).json({ error: 'Telegram handler initialization failed' });
        return;
      }

      const testResult = await telegramHandler.testTelegram(existing.targetChatId);
      if (testResult.success) {
        res.json({ success: true, messageId: testResult.messageId || null });
      } else {
        res.status(400).json({ error: testResult.error || 'Telegram test failed' });
      }
    } catch (error) {
      logError(`Web admin telegram test failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to test Telegram target' });
    }
  });

  // --- Telegram Chat Verify & Register ---
  app.post('/api/telegram-chats/verify', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const chatIdInput = typeof req.body.chatId === 'string' ? req.body.chatId.trim() : '';
    const chatLookup = normalizeTelegramChatLookupValue(chatIdInput);
    if (!chatLookup) {
      res.status(400).json({ error: 'chatId must be a valid Telegram chat ID, @username, or t.me link' });
      return;
    }

    try {
      const verifiedChat = await verifyAndTrackTelegramChatAccess(chatLookup.lookupValue, { discoveredVia: 'manual_verify' });

      res.json({
        success: true,
        chat: verifiedChat
      });
    } catch (error) {
      logError(`Telegram chat verify failed: ${error.message}`);
      const statusCode = Number(error && error.statusCode) || 500;
      const errorMessage = statusCode >= 500
        ? 'Failed to verify Telegram chat'
        : error.message;
      res.status(statusCode).json({ error: errorMessage });
    }
  });

  // Remove a tracked Telegram chat from discovery storage.
  // Safety rule: block removal if any forward config still targets this chat.
  app.delete('/api/telegram-chats/:chatId', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const chatId = typeof req.params.chatId === 'string' ? req.params.chatId.trim() : '';
    if (!/^-?\d+$/.test(chatId)) {
      res.status(400).json({ error: 'chatId must be a numeric Telegram chat ID' });
      return;
    }

    try {
      const allConfigs = await loadForwardConfigs();
      const usedByConfigs = (allConfigs || []).filter(cfg =>
        cfg &&
        cfg.targetType === 'telegram' &&
        String(cfg.targetChatId || '') === chatId
      );

      if (usedByConfigs.length > 0) {
        res.status(409).json({
          error: `Cannot remove tracked chat while it is used by ${usedByConfigs.length} forward config(s). Remove or retarget those configs first.`
        });
        return;
      }

      const removed = await removeTelegramChat(chatId);
      if (!removed) {
        res.status(404).json({ error: 'Tracked Telegram chat not found' });
        return;
      }

      clearTelegramDiscoveryCache();
      res.json({ success: true, chatId, removed });
    } catch (error) {
      logError(`Telegram chat remove failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to remove tracked Telegram chat' });
    }
  });

  // --- Bot Invite (OAuth2 Code Grant) ---
  app.get('/admin/bot-invite', (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.redirect('/admin');
      return;
    }

    const botClientId = (client.user && client.user.id) || webAdminConfig.oauthClientId;
    if (!botClientId || !webAdminConfig.oauthClientSecret) {
      res.status(400).send(renderLoginPage(
        webAdminConfig,
        'Bot invite requires WEB_ADMIN_DISCORD_CLIENT_ID and WEB_ADMIN_DISCORD_CLIENT_SECRET to be set.',
        false
      ));
      return;
    }

    const redirectUri = webAdminConfig.botInviteRedirectUri
      || `http://localhost:${webAdminConfig.port}/admin/bot-invite/callback`;

    const state = crypto.randomBytes(20).toString('hex');
    req.session.botInviteState = state;

    const params = new URLSearchParams({
      client_id: botClientId,
      permissions: '412317248576',
      scope: 'bot applications.commands',
      response_type: 'code',
      redirect_uri: redirectUri,
      state
    });

    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  });

  app.get('/admin/bot-invite/callback', async (req, res) => {
    const { code, state, error, error_description: errorDescription, guild_id: guildId } = req.query;

    if (error) {
      logError(`Bot invite OAuth error: ${errorDescription || error}`);
      res.redirect('/admin?invite=error');
      return;
    }

    if (!code || !state || !req.session.botInviteState || state !== req.session.botInviteState) {
      logError('Bot invite callback: invalid or missing state');
      res.redirect('/admin?invite=error');
      return;
    }

    delete req.session.botInviteState;

    const botClientId = (client.user && client.user.id) || webAdminConfig.oauthClientId;
    const redirectUri = webAdminConfig.botInviteRedirectUri
      || `http://localhost:${webAdminConfig.port}/admin/bot-invite/callback`;

    try {
      await exchangeCodeForToken(webAdminConfig, code, {
        clientId: botClientId,
        redirectUri
      });

      const guildParam = guildId ? `&guild=${guildId}` : '';
      logSuccess(`Bot invited to guild ${guildId || '(unknown)'} via web admin`);
      res.redirect(`/admin?invite=success${guildParam}`);
    } catch (exchangeError) {
      logError(`Bot invite token exchange failed: ${exchangeError.message}`);
      res.redirect('/admin?invite=error');
    }
  });

  app.get('/admin/health', (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    res.json({
      ok: true,
      loggedIn: Boolean(auth),
      botReady: Boolean(client && client.isReady && client.isReady())
    });
  });

  app.get('/api/reader-status', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const allowedGuildIds = await getVisibleSourceGuildSet(client, auth, webAdminConfig.allowedRoleIds);
      const isLocalBypass = Boolean(auth.localBypass);
      const allConfigs = await loadForwardConfigs();
      const scopedConfigs = (allConfigs || []).filter(configItem => {
        if (!configItem || configItem.sourceType !== 'discord') return false;
        if (configItem.enabled === false) return false;
        const sourceServerId = String(configItem.sourceServerId || '').trim();
        if (!sourceServerId) return isLocalBypass;
        return allowedGuildIds.has(sourceServerId);
      });

      const status = await buildReaderStatusDiagnostics(client, scopedConfigs, { getReaderBotClient, isTextOrAnnouncementChannel });
      res.json(status);
    } catch (error) {
      logError(`Web admin /api/reader-status failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load reader diagnostics' });
    }
  });

  app.get('/api/debug/reader-bot', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const guildId = typeof req.query.guildId === 'string' ? req.query.guildId.trim() : '';
      const payload = await buildReaderBotDebugPayload(
        client,
        auth,
        webAdminConfig.allowedRoleIds,
        guildId
      );
      res.json(payload);
    } catch (error) {
      logError(`Web admin /api/debug/reader-bot failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load reader debug data' });
    }
  });

  // --- Dashboard API ---
  app.get('/api/dashboard', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const configStatsData = await getConfigStats();
      const recentLogs = await getMessageLogs(null, 10);
      const failedMessages = await getFailedMessages(10);

      res.json({
        bot: {
          ready: client.isReady(),
          uptime: client.uptime,
          readyAt: client.readyAt ? client.readyAt.toISOString() : null,
          guildCount: client.guilds.cache.size,
          username: client.user ? client.user.username : null
        },
        configs: configStatsData,
        recentActivity: {
          recent: recentLogs.length,
          failed: failedMessages.length,
          lastForwardedAt: recentLogs[0] ? recentLogs[0].forwardedAt : null
        }
      });
    } catch (error) {
      logError(`Web admin /api/dashboard failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load dashboard data' });
    }
  });

  app.post('/api/forwards/retry', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const sourceMessageId = typeof req.body.sourceMessageId === 'string'
      ? req.body.sourceMessageId.trim()
      : '';
    if (!/^\d+$/.test(sourceMessageId)) {
      res.status(400).json({ error: 'sourceMessageId must be a numeric Discord message ID' });
      return;
    }

    try {
      const allowedGuildIds = await getVisibleSourceGuildSet(client, auth, webAdminConfig.allowedRoleIds);
      if (!allowedGuildIds.size) {
        res.status(403).json({ error: 'No authorized source guilds' });
        return;
      }

      let originalMessage = null;
      let sourceGuild = null;
      let sourceChannel = null;

      for (const guildId of allowedGuildIds) {
        const sourceContext = getSourceGuildContext(client, guildId);
        if (!sourceContext || !sourceContext.guild || !sourceContext.botUser) continue;

        const channels = Array.from(sourceContext.guild.channels.cache.values()).filter(channel => {
          if (!isTextOrAnnouncementChannel(channel)) return false;
          const perms = channel.permissionsFor(sourceContext.botUser);
          return perms && perms.has(PermissionFlagsBits.ViewChannel);
        });

        for (const channel of channels) {
          try {
            const fetched = await channel.messages.fetch(sourceMessageId);
            if (!fetched) continue;
            originalMessage = fetched;
            sourceGuild = sourceContext.guild;
            sourceChannel = channel;
            break;
          } catch (_error) {
            // Continue searching other channels
          }
        }

        if (originalMessage) break;
      }

      if (!originalMessage || !sourceGuild || !sourceChannel) {
        res.status(404).json({
          error: 'Source message not found in authorized guilds/channels'
        });
        return;
      }

      const forwardConfigs = await getForwardConfigsForChannel(sourceChannel.id);
      const allowedConfigs = forwardConfigs.filter(cfg => allowedGuildIds.has(cfg.sourceServerId));
      if (!allowedConfigs.length) {
        res.status(400).json({
          error: 'No active forward configurations found for the source channel'
        });
        return;
      }

      const ForwardHandler = require('../handlers/forwardHandler');
      const forwardHandler = new ForwardHandler(client);
      await forwardHandler.initialize();

      const results = [];
      let successCount = 0;
      let failedCount = 0;

      for (const configItem of allowedConfigs) {
        try {
          const retryResult = await forwardHandler.forwardToTarget(originalMessage, configItem);
          const ok = Boolean(retryResult);
          if (ok) successCount += 1;
          else failedCount += 1;

          results.push({
            configId: configItem.id,
            configName: configItem.name || `Config ${configItem.id}`,
            targetType: configItem.targetType || 'discord',
            success: ok,
            error: ok ? null : 'Forward attempt failed'
          });
        } catch (error) {
          failedCount += 1;
          results.push({
            configId: configItem.id,
            configName: configItem.name || `Config ${configItem.id}`,
            targetType: configItem.targetType || 'discord',
            success: false,
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        sourceMessageId,
        sourceGuildId: sourceGuild.id,
        sourceGuildName: sourceGuild.name,
        sourceChannelId: sourceChannel.id,
        sourceChannelName: sourceChannel.name,
        processed: allowedConfigs.length,
        successCount,
        failedCount,
        results
      });
    } catch (error) {
      logError(`Web admin /api/forwards/retry failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to retry source message forward' });
    }
  });

  // --- Message Logs API ---
  app.get('/api/logs', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const configId = req.query.configId ? parseInt(req.query.configId, 10) : null;
      const status = ['success', 'failed', 'retry'].includes(req.query.status) ? req.query.status : null;
      const messageId = typeof req.query.messageId === 'string' && req.query.messageId.trim()
        ? req.query.messageId.trim()
        : null;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const beforeId = req.query.beforeId ? parseInt(req.query.beforeId, 10) : null;

      const logs = await getMessageLogsFiltered({ configId, status, limit, beforeId, messageId });
      const forwardConfigs = await loadForwardConfigs();
      const configMap = new Map(
        (forwardConfigs || []).map(item => [Number(item.id), item])
      );

      const logsWithTargets = logs.map(log => {
        const configItem = configMap.get(Number(log.configId));
        const targetType = inferLogTargetType(log, configItem);
        return {
          ...log,
          targetType,
          targetLabel: buildLogTargetLabel(log, targetType, configItem)
        };
      });

      res.json({
        logs: logsWithTargets,
        hasMore: logsWithTargets.length === limit,
        nextBeforeId: logsWithTargets.length > 0 ? logsWithTargets[logsWithTargets.length - 1].id : null
      });
    } catch (error) {
      logError(`Web admin /api/logs failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load message logs' });
    }
  });

  app.delete('/api/logs', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const status = ['success', 'failed', 'retry'].includes(req.query.status) ? req.query.status : null;
      const configIdRaw = req.query.configId;
      const configId = configIdRaw === undefined || configIdRaw === null || configIdRaw === ''
        ? null
        : parseInt(configIdRaw, 10);

      if (!status) {
        res.status(400).json({ error: 'status query is required (success|failed|retry)' });
        return;
      }
      if (configIdRaw !== undefined && configIdRaw !== null && configIdRaw !== '' && Number.isNaN(configId)) {
        res.status(400).json({ error: 'configId must be a valid integer' });
        return;
      }
      const deleted = await deleteMessageLogsFiltered({ status, configId });
      res.json({ success: true, deleted, status, configId });
    } catch (error) {
      logError(`Web admin DELETE /api/logs failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to delete logs' });
    }
  });

  app.get('/api/logs/stats', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const total = await dbGet('SELECT COUNT(*) as count FROM message_logs');
      const failed = await dbGet("SELECT COUNT(*) as count FROM message_logs WHERE status = 'failed'");
      const today = await dbGet(
        'SELECT COUNT(*) as count FROM message_logs WHERE forwardedAt >= ?',
        [Date.now() - 24 * 60 * 60 * 1000]
      );

      res.json({
        total: total.count,
        failed: failed.count,
        today: today.count
      });
    } catch (error) {
      logError(`Web admin /api/logs/stats failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load log stats' });
    }
  });

  app.get('/api/debug/database', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!webAdminConfig.debug) {
      res.status(404).json({ error: 'Debug diagnostics are disabled' });
      return;
    }

    try {
      const diagnostics = await buildDebugDatabaseSnapshot({
        logLimit: req.query.logLimit,
        failedLimit: req.query.failedLimit,
        settingLimit: req.query.settingLimit
      });
      res.json(diagnostics);
    } catch (error) {
      logError(`Web admin /api/debug/database failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load debug diagnostics' });
    }
  });

  app.get('/api/debug/message-search', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!webAdminConfig.debug) {
      res.status(404).json({ error: 'Debug diagnostics are disabled' });
      return;
    }

    const messageId = typeof req.query.messageId === 'string'
      ? req.query.messageId.trim()
      : '';
    if (!/^\d+$/.test(messageId)) {
      res.status(400).json({ error: 'messageId must be a numeric Discord message ID' });
      return;
    }

    try {
      const result = await buildDebugMessageSearchSnapshot(messageId, {
        limit: req.query.limit
      });
      res.json(result);
    } catch (error) {
      logError(`Web admin /api/debug/message-search failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to run debug message search' });
    }
  });

  // --- Settings API ---
  app.get('/api/settings', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const settings = await getAllBotSettings();
      const uploadedEmojiState = parseUploadedEmojiNames(settings);
      const emojiPreview = await buildUploadedEmojiPreview(client, uploadedEmojiState.names);
      emojiPreview.parseError = uploadedEmojiState.parseError;

      const configPath = require.resolve('../config/config');
      delete require.cache[configPath];
      const runtimeConfig = require('../config/config');

      res.json({
        settings,
        definitions: BOT_SETTING_DEFINITIONS,
        emojiPreview,
        runtime: {
          debugMode: runtimeConfig.debugMode || false,
          forwardBotMessages: runtimeConfig.forwardBotMessages || false,
          useSliceFormatConverter: runtimeConfig.useSliceFormatConverter || false,
          telegramEnabled: (runtimeConfig.telegram && runtimeConfig.telegram.enabled) || false,
          readerBotEnabled: (runtimeConfig.readerBot && runtimeConfig.readerBot.enabled) || false,
          webAdminAuthMode: webAdminConfig.authMode
        }
      });
    } catch (error) {
      logError(`Web admin /api/settings failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load settings' });
    }
  });

  app.delete('/api/settings/uploaded-emoji/:emojiName', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const requestedName = String(req.params.emojiName || '').trim();
    if (!requestedName) {
      res.status(400).json({ error: 'emojiName is required' });
      return;
    }

    try {
      const rawValue = await getBotSetting('uploaded_emoji_names');
      const parsedState = parseUploadedEmojiNames([
        {
          key: 'uploaded_emoji_names',
          value: rawValue
        }
      ]);

      if (parsedState.parseError) {
        res.status(400).json({
          error: 'uploaded_emoji_names is not valid JSON. Fix the setting value before removing individual emoji names.'
        });
        return;
      }

      if (!client || !client.application || !client.application.emojis) {
        res.status(503).json({
          error: 'Discord application emoji manager is not available yet. Wait for bot readiness and retry.'
        });
        return;
      }

      const normalizedRequestedName = requestedName.toLowerCase();
      const matchedStoredName = parsedState.names.find(name => name.toLowerCase() === normalizedRequestedName) || null;
      const canonicalName = matchedStoredName || requestedName;

      let allEmojis;
      try {
        allEmojis = await client.application.emojis.fetch();
      } catch (error) {
        logError(`Web admin emoji remove fetch failed (${canonicalName}): ${error.message}`);
        res.status(502).json({
          error: 'Failed to query Discord application emojis. Check bot permissions/API status and retry.'
        });
        return;
      }

      const appEmoji = Array.from(allEmojis.values()).find(emoji =>
        String(emoji.name || '').toLowerCase() === normalizedRequestedName
      ) || null;

      let discordStatus = 'already_absent';
      if (appEmoji) {
        try {
          await appEmoji.delete();
          discordStatus = 'deleted';
          logInfo(`Web admin emoji remove: deleted Discord app emoji :${appEmoji.name}: (${appEmoji.id})`);
        } catch (error) {
          logError(`Web admin emoji remove failed deleting Discord app emoji :${appEmoji.name}: ${error.message}`);
          res.status(502).json({
            error: `Failed to delete Discord application emoji :${appEmoji.name}:. Check Discord application emoji permissions/API status and retry.`,
            discordError: error.message
          });
          return;
        }
      } else {
        logInfo(`Web admin emoji remove: Discord app emoji :${canonicalName}: already absent`);
      }

      const nextNames = parsedState.names.filter(name => name.toLowerCase() !== normalizedRequestedName);
      const removedFromDb = nextNames.length !== parsedState.names.length;

      if (removedFromDb || rawValue === null) {
        await setBotSetting('uploaded_emoji_names', JSON.stringify(nextNames));
      }

      logInfo(
        `Web admin emoji remove outcome for :${canonicalName}: discord=${discordStatus}; ` +
        `dbRemoved=${removedFromDb}; remaining=${nextNames.length}; requestedBy=${auth.user.username || auth.user.id}`
      );

      res.json({
        success: true,
        name: canonicalName,
        discord: {
          status: discordStatus,
          id: appEmoji ? appEmoji.id : null
        },
        db: {
          removed: removedFromDb,
          remainingCount: nextNames.length
        }
      });
    } catch (error) {
      logError(`Web admin emoji remove failed (${requestedName}): ${error.message}`);
      res.status(500).json({ error: 'Failed to remove emoji name' });
    }
  });

  app.put('/api/settings/:key', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const key = req.params.key;
    const value = req.body.value;

    if (typeof key !== 'string' || !key.trim()) {
      res.status(400).json({ error: 'Key is required' });
      return;
    }
    if (value === undefined || value === null) {
      res.status(400).json({ error: 'Value is required' });
      return;
    }

    try {
      const trimmedKey = key.trim();
      const existingValue = await getBotSetting(trimmedKey);
      if (existingValue === null) {
        res.status(400).json({ error: 'Creating new settings from web admin is disabled' });
        return;
      }

      let valueToPersist = String(value);
      if (trimmedKey === 'uploaded_emoji_names') {
        const normalized = normalizeUploadedEmojiNamesValue(value);
        if (!normalized.valid) {
          res.status(400).json({ error: normalized.error });
          return;
        }
        valueToPersist = normalized.value;
      }

      await setBotSetting(trimmedKey, valueToPersist);
      res.json({ success: true, key: trimmedKey, value: valueToPersist });
    } catch (error) {
      logError(`Web admin PUT /api/settings/${key} failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to save setting' });
    }
  });

  app.delete('/api/settings/:key', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const key = String(req.params.key || '').trim();
    if (!key) {
      res.status(400).json({ error: 'Key is required' });
      return;
    }

    if (key === 'uploaded_emoji_names') {
      res.status(400).json({ error: 'Delete emoji names individually in the web UI instead of deleting uploaded_emoji_names.' });
      return;
    }

    try {
      await dbRun('DELETE FROM bot_settings WHERE key = ?', [key]);
      res.json({ success: true });
    } catch (error) {
      logError(`Web admin DELETE /api/settings/${key} failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to delete setting' });
    }
  });

  // --- Auto Publish API ---
  app.get('/api/auto-publish', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const manageableGuilds = await getManageableSourceGuilds(client, auth, webAdminConfig.allowedRoleIds);
      const autoPublishConfig = await getAutoPublishConfig();
      const guilds = [];
      const enabledChannels = [];

      for (const manageableGuild of manageableGuilds) {
        const sourceContext = getSourceGuildContext(client, manageableGuild.id);
        if (!sourceContext || !sourceContext.guild) continue;
        const guild = sourceContext.guild;

        const enabledSet = new Set(Array.isArray(autoPublishConfig[guild.id]) ? autoPublishConfig[guild.id] : []);
        const announcementChannels = mapGuildChannels(guild, sourceContext.botUser, {
          announcementOnly: true,
          requireManageMessages: true
        }).map(channel => ({
          ...channel,
          enabled: enabledSet.has(channel.id)
        }));

        for (const channel of announcementChannels) {
          if (!channel.enabled) continue;
          enabledChannels.push({
            guildId: guild.id,
            guildName: guild.name,
            channelId: channel.id,
            channelName: channel.name
          });
        }

        guilds.push({
          id: guild.id,
          name: guild.name,
          sourceBot: sourceContext.botType,
          channels: announcementChannels
        });
      }

      res.json({
        guilds,
        enabledChannels
      });
    } catch (error) {
      logError(`Web admin /api/auto-publish failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load auto-publish data' });
    }
  });

  app.put('/api/auto-publish', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const guildId = typeof req.body.guildId === 'string' ? req.body.guildId.trim() : '';
    const channelId = typeof req.body.channelId === 'string' ? req.body.channelId.trim() : '';
    const enabled = req.body.enabled;

    if (!isDiscordId(guildId) || !isDiscordId(channelId)) {
      res.status(400).json({ error: 'guildId and channelId must be numeric Discord IDs' });
      return;
    }
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be boolean' });
      return;
    }

    try {
      const allowedGuilds = await getVisibleSourceGuildSet(client, auth, webAdminConfig.allowedRoleIds);
      if (!allowedGuilds.has(guildId)) {
        res.status(403).json({ error: 'Forbidden for this guild' });
        return;
      }

      const sourceContext = getSourceGuildContext(client, guildId);
      if (!sourceContext || !sourceContext.guild) {
        res.status(404).json({ error: 'Guild not found in source bot cache' });
        return;
      }
      const guild = sourceContext.guild;

      let channel = guild.channels.cache.get(channelId);
      if (!channel) {
        try {
          channel = await guild.channels.fetch(channelId);
        } catch (_error) {
          channel = null;
        }
      }

      if (!channel || channel.type !== ChannelType.GuildAnnouncement) {
        res.status(400).json({ error: 'Channel must be an announcement channel' });
        return;
      }

      const permissions = channel.permissionsFor(sourceContext.botUser);
      if (!permissions || !permissions.has(PermissionFlagsBits.ManageMessages)) {
        res.status(400).json({ error: 'Source bot requires Manage Messages permission in that channel' });
        return;
      }

      await setAutoPublishChannelEnabled(guildId, channelId, enabled);
      res.json({
        success: true,
        guildId,
        channelId,
        enabled
      });
    } catch (error) {
      logError(`Web admin PUT /api/auto-publish failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to update auto-publish setting' });
    }
  });

  // --- Bot Info API ---
  app.get('/api/bot-info', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const mainBotId = client.user ? client.user.id : null;
      const mainBotPermissions = '412317248576'; // ViewChannel, SendMessages, ManageMessages, ReadMessageHistory, EmbedLinks, AttachFiles, ManageChannels

      const result = {
        mainBot: {
          username: client.user ? client.user.username : null,
          id: mainBotId,
          inviteUrl: mainBotId
            ? `https://discord.com/oauth2/authorize?client_id=${mainBotId}&permissions=${mainBotPermissions}&scope=bot`
            : null
        },
        readerBot: {
          enabled: false,
          online: false,
          username: null,
          id: null,
          inviteUrl: null
        }
      };

      try {
        const { readerBot } = require('../index');
        const runtimeConfig = require('../config/config');

        if (runtimeConfig.readerBot && runtimeConfig.readerBot.enabled) {
          result.readerBot.enabled = true;

          if (readerBot && readerBot.isReady && readerBot.client && readerBot.client.user) {
            const readerBotId = readerBot.client.user.id;
            result.readerBot.online = true;
            result.readerBot.username = readerBot.client.user.username;
            result.readerBot.id = readerBotId;
            result.readerBot.inviteUrl = buildReaderInviteUrlFromClient(readerBot.client);
          }
        }
      } catch (_e) {
        // reader bot module not available, leave defaults
      }

      res.json(result);
    } catch (error) {
      logError(`Web admin /api/bot-info failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load bot info' });
    }
  });

  // --- Guild Management API ---
  function mapGuildToView(guild) {
    if (!guild) return null;

    let ownerName = null;
    if (guild.ownerId) {
      const ownerMember = guild.members && guild.members.cache
        ? guild.members.cache.get(guild.ownerId)
        : null;
      if (ownerMember && ownerMember.user) ownerName = ownerMember.user.username;
    }

    return {
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount,
      joinedAt: guild.joinedAt ? guild.joinedAt.toISOString() : null,
      icon: typeof guild.iconURL === 'function' ? (guild.iconURL({ size: 64 }) || null) : null,
      owner: ownerName,
      ownerId: guild.ownerId || null
    };
  }

  async function getAuthorizedGuildViews(botClient, auth, allowedRoleIds) {
    const manageableGuilds = await getManageableGuilds(botClient, auth, allowedRoleIds);
    if (!manageableGuilds.length) return [];

    const views = [];
    for (const manageableGuild of manageableGuilds) {
      let guild = botClient.guilds.cache.get(manageableGuild.id) || null;
      if (!guild) {
        try {
          guild = await botClient.guilds.fetch(manageableGuild.id);
        } catch (_error) {
          guild = null;
        }
      }

      const guildView = mapGuildToView(guild);
      if (guildView) views.push(guildView);
    }

    views.sort((a, b) => a.name.localeCompare(b.name));
    return views;
  }

  async function getAllGuildViews(botClient) {
    if (!botClient || !botClient.isReady || !botClient.isReady()) return [];

    const now = Date.now();
    const lastRefreshAt = guildCacheRefreshState.get(botClient) || 0;
    if (now - lastRefreshAt >= GUILD_CACHE_REFRESH_TTL_MS) {
      try {
        await botClient.guilds.fetch();
      } catch (_error) {
        // Continue with the current cache if Discord rejects the refresh.
      } finally {
        guildCacheRefreshState.set(botClient, now);
      }
    }

    return Array.from(botClient.guilds.cache.values())
      .map(mapGuildToView)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  app.get('/api/guilds', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const mainGuildViews = await getAuthorizedGuildViews(client, auth, webAdminConfig.allowedRoleIds);
      const result = {
        mainBot: {
          guilds: mainGuildViews,
          visibleGuildCount: mainGuildViews.length,
          totalGuildCount: client.guilds.cache.size
        },
        readerBot: {
          enabled: false,
          online: false,
          guilds: [],
          visibleGuildCount: 0,
          totalGuildCount: 0
        }
      };

      try {
        const { readerBot } = require('../index');
        const runtimeConfig = require('../config/config');
        if (runtimeConfig.readerBot && runtimeConfig.readerBot.enabled) {
          result.readerBot.enabled = true;
          if (readerBot && readerBot.isReady && readerBot.client) {
            result.readerBot.online = true;
            result.readerBot.guilds = await getAllGuildViews(readerBot.client);
            result.readerBot.visibleGuildCount = result.readerBot.guilds.length;
            result.readerBot.totalGuildCount = readerBot.client.guilds.cache.size;
          }
        }
      } catch (error) {
        logError(`Web admin /api/guilds reader bot lookup failed: ${error.message}`);
      }

      res.json(result);
    } catch (error) {
      logError(`Web admin /api/guilds failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load guilds' });
    }
  });

  app.post('/api/guilds/:id/leave', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const guildId = req.params.id;
    if (!isDiscordId(guildId)) {
      res.status(400).json({ error: 'Invalid guild ID' });
      return;
    }

    const botType = req.query.bot || 'main';

    try {
      if (!auth.localBypass) {
        const allowedGuildIds = await getVisibleSourceGuildSet(client, auth, webAdminConfig.allowedRoleIds);
        if (!allowedGuildIds.has(guildId)) {
          res.status(403).json({ error: 'Forbidden for this guild' });
          return;
        }
      }

      let guild;
      let botLabel;

      if (botType === 'reader') {
        const { readerBot } = require('../index');
        if (!readerBot || !readerBot.isReady || !readerBot.client) {
          res.status(400).json({ error: 'Reader bot is not available' });
          return;
        }
        guild = readerBot.client.guilds.cache.get(guildId);
        botLabel = 'Reader bot';
      } else {
        guild = client.guilds.cache.get(guildId);
        botLabel = 'Main bot';
      }

      if (!guild) {
        res.status(404).json({ error: 'Guild not found in bot cache' });
        return;
      }

      const guildName = guild.name;
      await guild.leave();
      logInfo(`Web admin: ${botLabel} left guild "${guildName}" (${guildId}) - requested by ${auth.user.username || auth.user.id}`);
      res.json({ success: true, guildName });
    } catch (error) {
      logError(`Web admin leave guild ${guildId} failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to leave guild' });
    }
  });

  return { app, webAdminConfig };
}

function startWebAdminServer(client, config) {
  const webAdminConfig = getWebAdminConfig(config);
  if (!webAdminConfig.enabled) {
    logInfo('Web admin disabled');
    return null;
  }

  if (webAdminConfig.authMode === 'local') {
    logInfo('Web admin auth mode is local (localhost checks active)');
  }
  if (webAdminConfig.debug) {
    logInfo(
      `[WebAdmin Debug] trustProxy=${webAdminConfig.trustProxy}; ` +
      `baseUrl=${webAdminConfig.baseUrl || '(not set)'}; ` +
      `authMode=${webAdminConfig.authMode}; ` +
      `securityStrict=${webAdminConfig.securityStrict}; ` +
      `allowedHosts=${(webAdminConfig.localAllowedHosts || []).join(',') || '(none)'}; ` +
      `allowedIps=${(webAdminConfig.localAllowedIps || []).join(',') || '(none)'}`
    );
  }

  const validation = validateWebAdminConfig(webAdminConfig);
  if (!validation.valid) {
    logError(`Web admin disabled due to missing config: ${validation.missing.join(', ')}`);
    return null;
  }

  const { app } = createWebAdminApp(client, config);
  const server = app.listen(webAdminConfig.port, () => {
    logSuccess(`Web admin listening on port ${webAdminConfig.port}`);
  });

  server.on('error', error => {
    logError(`Web admin server error: ${error.message}`);
  });

  return server;
}

function stopWebAdminServer(server) {
  if (!server) return Promise.resolve();
  return new Promise(resolve => {
    server.close(() => resolve());
  });
}

module.exports = {
  getWebAdminConfig,
  createWebAdminApp,
  startWebAdminServer,
  stopWebAdminServer
};
