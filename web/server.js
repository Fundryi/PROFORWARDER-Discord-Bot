const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { PermissionFlagsBits } = require('discord.js');
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
  upsertTelegramChat: dbUpsertTelegramChat,
  getTelegramChats,
  getTelegramChat,
  get: dbGet,
  run: dbRun
} = require('../utils/database');
const { logInfo, logSuccess, logError } = require('../utils/logger');
const {
  normalizeTelegramChat: trackerNormalize,
  parseMyChatMemberUpdate,
  persistChatsFromUpdates,
  enrichChatViaAPI
} = require('../utils/telegramChatTracker');

const TELEGRAM_DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (DB is the persistent backstop)
let telegramDiscoveryCache = {
  loadedAt: 0,
  payload: null
};
const TELEGRAM_DISCOVERY_ALLOWED_TYPES = new Set(['group', 'supergroup', 'channel']);

function clearTelegramDiscoveryCache() {
  telegramDiscoveryCache = {
    loadedAt: 0,
    payload: null
  };
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

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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

function renderDashboardPage(auth) {
  const tag = escapeHtml(auth.user.global_name || auth.user.username || auth.user.id);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ProForwarder Admin</title>
  <link rel="stylesheet" href="/admin/static/styles.css">
</head>
<body>
  <main class="layout">
    <section class="card">
      <div class="header-bar">
        <h1>ProForwarder Admin</h1>
        <div class="row">
          <span class="badge" data-user-tag>${tag}</span>
          <a class="button secondary sm" href="/admin/logout">Logout</a>
        </div>
      </div>
      <p id="status-message" class="muted-text">Ready.</p>
    </section>

    <nav class="tab-nav">
      <button data-tab="dashboard" class="active">Dashboard</button>
      <button data-tab="configs">Configs</button>
      <button data-tab="autopublish">Auto Publish</button>
      <button data-tab="guilds">Guilds</button>
      <button data-tab="logs">Logs</button>
      <button data-tab="settings">Settings</button>
    </nav>

    <!-- Dashboard Tab -->
    <section id="tab-dashboard" class="tab-panel active">
      <div class="card">
        <h2>Bot Status</h2>
        <div id="dashboard-stats" class="stat-grid">
          <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">Status</div></div>
        </div>
      </div>
    </section>

    <!-- Configs Tab -->
    <section id="tab-configs" class="tab-panel">
      <div class="card">
        <h2>Guild</h2>
        <select id="guild-select" class="input">
          <option value="">Loading guilds...</option>
        </select>
      </div>

      <div class="card">
        <h2>Forward Configurations</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Source</th>
                <th>Target</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="configs-body">
              <tr><td colspan="6" class="muted-text">Select a guild first.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Create Discord Forward</h2>
        <form id="create-discord-form" class="form-grid config-builder-form">
          <div class="config-builder-grid">
            <fieldset class="config-box">
              <legend>Source</legend>
              <label>Source Server
                <input id="discord-source-server-search" class="input select-search" placeholder="Search source servers">
                <select id="discord-source-server" class="input" required>
                  <option value="">Loading source servers...</option>
                </select>
              </label>
              <label>Source Channel
                <input id="discord-source-channel-search" class="input select-search" placeholder="Search source channels">
                <select id="discord-source-channel" class="input" required>
                  <option value="">Select source server first</option>
                </select>
              </label>
            </fieldset>
            <fieldset class="config-box">
              <legend>Target</legend>
              <label>Target Server (Main Bot)
                <input id="discord-target-server-search" class="input select-search" placeholder="Search target servers">
                <select id="discord-target-server" class="input" required>
                  <option value="">Loading target servers...</option>
                </select>
              </label>
              <label>Target Channel (Main Bot)
                <input id="discord-target-channel-search" class="input select-search" placeholder="Search target channels">
                <select id="discord-target-channel" class="input" required>
                  <option value="">Select target server first</option>
                </select>
              </label>
            </fieldset>
          </div>
          <label>Name (optional)<input id="discord-name" class="input"></label>
          <button type="submit" class="button">Create Discord Forward</button>
        </form>
      </div>

      <div class="card">
        <h2>Create Telegram Forward</h2>
        <form id="create-telegram-form" class="form-grid config-builder-form">
          <div class="config-builder-grid">
            <fieldset class="config-box">
              <legend>Source</legend>
              <label>Source Server
                <input id="telegram-source-server-search" class="input select-search" placeholder="Search source servers">
                <select id="telegram-source-server" class="input" required>
                  <option value="">Loading source servers...</option>
                </select>
              </label>
              <label>Source Channel
                <input id="telegram-source-channel-search" class="input select-search" placeholder="Search source channels">
                <select id="telegram-source-channel" class="input" required>
                  <option value="">Select source server first</option>
                </select>
              </label>
            </fieldset>
            <fieldset class="config-box">
              <legend>Target</legend>
              <label>Telegram Chat (discovered)
                <input id="telegram-chat-search" class="input select-search" placeholder="Search discovered chats">
                <select id="telegram-chat-select" class="input">
                  <option value="">Select discovered chat (optional)</option>
                </select>
              </label>
              <label>Telegram Chat ID (manual or selected)<input id="telegram-chat-id" class="input" required></label>
              <button type="button" id="telegram-verify-btn" class="button secondary sm">Verify &amp; Register Chat</button>
              <p id="telegram-verify-result" class="muted-text" style="display:none"></p>
              <p id="telegram-chat-hint" class="muted-text">Telegram cannot list chats automatically. Use Verify &amp; Register to add a chat by ID, or it will be tracked after first use.</p>
            </fieldset>
          </div>
          <label>Name (optional)<input id="telegram-name" class="input"></label>
          <button type="submit" class="button">Create Telegram Forward</button>
        </form>
      </div>
    </section>

    <!-- Auto Publish Tab -->
    <section id="tab-autopublish" class="tab-panel">
      <div class="card">
        <h2>Auto Publish</h2>
        <p class="muted-text">Manage announcement channels where the bot auto-publishes posts after 1 minute.</p>
        <div class="form-grid">
          <label>Server
            <input id="autopublish-guild-search" class="input select-search" placeholder="Search servers">
            <select id="autopublish-guild-select" class="input">
              <option value="">Loading servers...</option>
            </select>
          </label>
          <label>Announcement Channel
            <input id="autopublish-channel-search" class="input select-search" placeholder="Search announcement channels">
            <select id="autopublish-channel-select" class="input">
              <option value="">Select a server first</option>
            </select>
          </label>
        </div>
        <div class="row autopublish-actions">
          <span id="autopublish-selected-state" class="status-badge retry">Select a channel</span>
          <button id="autopublish-toggle-btn" class="button secondary sm" type="button" disabled>Enable</button>
          <button id="autopublish-refresh-btn" class="button secondary sm" type="button">Refresh</button>
        </div>
      </div>

      <div class="card">
        <h2>Enabled Announcement Channels</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Server</th>
                <th>Channel</th>
                <th>ID</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="autopublish-enabled-body">
              <tr><td colspan="4" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Guilds Tab -->
    <section id="tab-guilds" class="tab-panel">
      <div class="card">
        <h2>Invite Bots</h2>
        <p class="muted-text">Add the bots to a new server using the invite links below.</p>
        <div id="invite-cards" class="stat-grid"></div>
      </div>

      <div class="card">
        <h2>Main Bot Guilds</h2>
        <p class="muted-text">Servers the main bot is currently in.</p>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th class="icon-col"></th>
                <th>Name</th>
                <th>ID</th>
                <th>Members</th>
                <th>Owner</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="main-guilds-body">
              <tr><td colspan="7" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Reader Bot Guilds</h2>
        <p class="muted-text" id="reader-guilds-status">Servers the reader bot is currently in.</p>
        <div class="table-wrapper" id="reader-guilds-wrapper">
          <table>
            <thead>
              <tr>
                <th class="icon-col"></th>
                <th>Name</th>
                <th>ID</th>
                <th>Members</th>
                <th>Owner</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="reader-guilds-body">
              <tr><td colspan="7" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Logs Tab -->
    <section id="tab-logs" class="tab-panel">
      <div class="card">
        <h2>Message Logs</h2>
        <div class="filter-bar">
          <select id="logs-config-filter">
            <option value="">All Configs</option>
          </select>
          <select id="logs-status-filter">
            <option value="">All Statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="retry">Retry</option>
          </select>
          <input id="logs-message-search" class="input filter-wide-input" placeholder="Search message ID (source or forwarded)">
          <button id="logs-search" class="button secondary sm">Search</button>
          <button id="logs-clear-search" class="button secondary sm">Clear</button>
          <button id="logs-refresh" class="button secondary sm">Refresh</button>
          <button id="logs-delete-failed" class="button secondary sm danger">Delete Failed Logs</button>
        </div>
        <div class="filter-bar">
          <input id="logs-retry-source-id" class="input filter-wide-input" placeholder="Source message ID to retry">
          <button id="logs-retry-source" class="button secondary sm">Retry Source Message</button>
        </div>
        <div class="table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Config</th>
                <th>Original</th>
                <th>Forwarded</th>
                <th>Target</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="logs-body">
              <tr><td colspan="7" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <button id="logs-load-more" class="button secondary sm is-hidden">Load More</button>
        </div>
      </div>
    </section>

    <!-- Settings Tab -->
    <section id="tab-settings" class="tab-panel">
      <div class="card">
        <h2>Runtime Configuration</h2>
        <p class="muted-text">Read-only values from config.js. Edit the config file to change these.</p>
        <div id="runtime-config" class="runtime-grid"></div>
      </div>
      <div class="card">
        <h2>Bot Settings</h2>
        <p class="muted-text">Manage existing settings stored in SQLite. New setting creation is disabled in web admin.</p>
        <div class="settings-help">
          <div class="settings-help-item">
            <strong>Existing keys only</strong>
            <p class="muted-text">This page edits existing settings only. New keys are not created from web admin.</p>
          </div>
          <div class="settings-help-item">
            <strong>Emoji behavior</strong>
            <p class="muted-text"><code>uploaded_emoji_names</code> is managed automatically. Add/edit is disabled; remove entries individually.</p>
          </div>
        </div>
        <div id="bot-settings" class="settings-section"></div>
      </div>
    </section>
  </main>

  <script src="/admin/static/app.js"></script>
  <script src="/admin/static/dashboard.js"></script>
  <script src="/admin/static/configs.js"></script>
  <script src="/admin/static/autopublish.js"></script>
  <script src="/admin/static/guilds.js"></script>
  <script src="/admin/static/logs.js"></script>
  <script src="/admin/static/settings.js"></script>
</body>
</html>`;
}

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
    targetType: configItem.targetType || '',
    targetServerId: configItem.targetServerId || '',
    targetChannelId: configItem.targetChannelId || '',
    targetChatId: configItem.targetChatId || '',
    enabled: configItem.enabled !== false,
    createdBy: configItem.createdBy || ''
  };
}

function hasAdminPermission(permissionString) {
  try {
    if (!permissionString) return false;
    const bitfield = BigInt(permissionString);
    return (bitfield & 0x8n) === 0x8n;
  } catch (error) {
    return false;
  }
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
  const oauthGuildMap = buildOauthGuildMap(auth);
  const botGuilds = Array.from(client.guilds.cache.values());

  const checks = await Promise.all(botGuilds.map(async guild => {
    const oauthGuild = oauthGuildMap.get(guild.id);
    if (!oauthGuild) return null;

    if (hasAdminPermission(oauthGuild.permissions)) {
      return {
        id: guild.id,
        name: guild.name
      };
    }

    try {
      const member = await guild.members.fetch(auth.user.id);
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      const hasAllowedRole = allowedRoleIds.length > 0 &&
        member.roles.cache.some(role => allowedRoleIds.includes(role.id));
      if (isAdmin || hasAllowedRole) {
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
  if (readerClient) {
    const readerGuilds = await getManageableGuilds(readerClient, auth, allowedRoleIds);
    for (const guild of readerGuilds) {
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
  return channel.type === 0 || channel.type === 5;
}

function isDiscordId(value) {
  return typeof value === 'string' && /^\d+$/.test(value.trim());
}

function isTelegramChatId(value) {
  return typeof value === 'string' && /^-?\d+$/.test(value.trim());
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
  const guilds = await getManageableSourceGuilds(client, auth, allowedRoleIds);
  return new Set(guilds.map(guild => guild.id));
}

function getSourceGuildContext(mainClient, guildId) {
  const mainGuild = mainClient.guilds.cache.get(guildId);
  if (mainGuild) {
    return {
      guild: mainGuild,
      botUser: mainClient.user,
      botType: 'main'
    };
  }

  const readerClient = getReaderBotClient();
  if (readerClient) {
    const readerGuild = readerClient.guilds.cache.get(guildId);
    if (readerGuild) {
      return {
        guild: readerGuild,
        botUser: readerClient.user,
        botType: 'reader'
      };
    }
  }

  return null;
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
    if (announcementOnly && channel.type !== 5) return false;

    const perms = channel.permissionsFor(botUser);
    if (!perms || !perms.has(PermissionFlagsBits.ViewChannel)) return false;
    if (requireSendMessages && !perms.has(PermissionFlagsBits.SendMessages)) return false;
    if (requireManageMessages && !perms.has(PermissionFlagsBits.ManageMessages)) return false;
    return true;
  });

  return sortGuildChannels(channels).map(channel => ({
    id: channel.id,
    name: channel.name,
    type: channel.type === 5 ? 'announcement' : 'text'
  }));
}

// In-memory map helper: merge a chat into the response map (used during collectTelegramChatOptions)
function upsertChatIntoMap(chatMap, chat, source) {
  if (!chat || !chat.id) return;
  const id = String(chat.id);
  const chatType = String(chat.type || '').toLowerCase();

  // Filter: only include group/supergroup/channel (or configured with negative ID)
  if (source === 'configured' || chatType === 'configured') {
    if (!id.startsWith('-')) return;
  } else if (!TELEGRAM_DISCOVERY_ALLOWED_TYPES.has(chatType)) {
    return;
  }

  const existing = chatMap.get(id);
  if (!existing) {
    chatMap.set(id, { id, title: chat.title || `Chat ${id}`, type: chat.type || 'unknown', username: chat.username || null, source });
    return;
  }
  chatMap.set(id, {
    ...existing,
    title: chat.title || existing.title,
    type: (chat.type && chat.type !== 'unknown' && chat.type !== 'configured') ? chat.type : existing.type,
    username: chat.username || existing.username,
    source: existing.source === 'tracked' ? 'tracked' : source
  });
}

async function collectTelegramChatOptions() {
  const now = Date.now();
  if (
    telegramDiscoveryCache.payload &&
    (now - telegramDiscoveryCache.loadedAt) < TELEGRAM_DISCOVERY_CACHE_TTL_MS
  ) {
    return telegramDiscoveryCache.payload;
  }

  const runtimeConfig = require('../config/config');
  const telegramEnabled = Boolean(runtimeConfig.telegram && runtimeConfig.telegram.enabled);
  const chatMap = new Map();
  const warnings = [];

  // STEP 1: Load persisted chats from database (primary source)
  try {
    const dbChats = await getTelegramChats({ includeLeft: false });
    for (const dbChat of dbChats) {
      chatMap.set(dbChat.chatId, {
        id: dbChat.chatId,
        title: dbChat.title || `Chat ${dbChat.chatId}`,
        type: dbChat.type,
        username: dbChat.username || null,
        source: 'tracked'
      });
    }
  } catch (error) {
    warnings.push(`Failed to load tracked Telegram chats: ${error.message}`);
  }

  // STEP 2: Merge in chat IDs from existing forward configs (fill gaps not yet in DB)
  try {
    const configs = await loadForwardConfigs();
    for (const cfg of configs) {
      if (cfg.targetType !== 'telegram' || !cfg.targetChatId) continue;
      const chatId = String(cfg.targetChatId);
      if (!chatMap.has(chatId)) {
        upsertChatIntoMap(chatMap, { id: chatId, title: 'Configured Chat', type: 'configured' }, 'configured');
      }
    }
  } catch (error) {
    warnings.push(`Failed to read configured Telegram chats: ${error.message}`);
  }

  // STEP 3: Poll getUpdates (with my_chat_member) and persist new discoveries
  let telegramHandler = null;
  if (telegramEnabled) {
    try {
      const TelegramHandler = require('../handlers/telegramHandler');
      telegramHandler = new TelegramHandler();
      const initialized = await telegramHandler.initialize();
      if (!initialized) {
        warnings.push('Telegram handler failed to initialize.');
        telegramHandler = null;
      } else {
        const updates = await telegramHandler.callTelegramAPI('getUpdates', {
          limit: 100,
          timeout: 0,
          allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post', 'my_chat_member']
        });

        if (updates && updates.ok && Array.isArray(updates.result)) {
          // Persist to DB
          await persistChatsFromUpdates(updates.result);

          // Also merge into in-memory map for immediate response
          for (const update of updates.result) {
            const rawChat = update.message?.chat
              || update.edited_message?.chat
              || update.channel_post?.chat
              || update.edited_channel_post?.chat
              || null;
            if (rawChat) {
              const normalized = trackerNormalize(rawChat);
              if (normalized) upsertChatIntoMap(chatMap, normalized, 'tracked');
            }
            const memberEvent = parseMyChatMemberUpdate(update);
            if (memberEvent) {
              const normalized = trackerNormalize(memberEvent.chat);
              if (normalized) {
                // If bot was removed, remove from the map
                if (memberEvent.memberStatus === 'left' || memberEvent.memberStatus === 'kicked') {
                  chatMap.delete(normalized.id);
                } else {
                  upsertChatIntoMap(chatMap, normalized, 'tracked');
                }
              }
            }
          }
        } else {
          warnings.push('Telegram chat discovery from updates did not return usable data.');
        }
      }
    } catch (error) {
      warnings.push(`Telegram chat discovery failed: ${error.message}`);
    }
  }

  // STEP 4: Enrich any remaining "Configured Chat" placeholders via getChat API
  if (telegramHandler) {
    for (const [chatId, chatData] of chatMap.entries()) {
      if (chatData.title !== 'Configured Chat') continue;

      // Check DB first (may have been enriched by startup sync)
      try {
        const dbChat = await getTelegramChat(chatId);
        if (dbChat && dbChat.title && dbChat.title !== '' && dbChat.title !== 'Configured Chat') {
          chatMap.set(chatId, {
            id: chatId,
            title: dbChat.title,
            type: (dbChat.type !== 'configured' && dbChat.type !== 'unknown') ? dbChat.type : chatData.type,
            username: dbChat.username || chatData.username,
            source: chatData.source
          });
          continue;
        }
      } catch (_) { /* ignore DB lookup failure */ }

      // Call getChat API to enrich
      try {
        const enriched = await enrichChatViaAPI(telegramHandler, chatId);
        if (enriched) {
          chatMap.set(chatId, {
            id: chatId,
            title: enriched.title || chatData.title,
            type: enriched.type || chatData.type,
            username: enriched.username || chatData.username,
            source: chatData.source
          });
        }
      } catch (_) { /* enrichment is best-effort */ }
    }
  }

  // Sort by type rank then title
  const typeRank = {
    channel: 1,
    supergroup: 2,
    group: 3,
    private: 4,
    configured: 5,
    unknown: 6
  };

  const chats = Array.from(chatMap.values()).sort((a, b) => {
    const rankDiff = (typeRank[a.type] || 99) - (typeRank[b.type] || 99);
    if (rankDiff !== 0) return rankDiff;
    return a.title.localeCompare(b.title);
  });

  const payload = {
    enabled: telegramEnabled,
    chats,
    warnings
  };

  telegramDiscoveryCache = {
    loadedAt: Date.now(),
    payload
  };

  return payload;
}

function createWebAdminApp(client, config) {
  const webAdminConfig = getWebAdminConfig(config);
  const app = express();

  if (webAdminConfig.trustProxy) {
    app.set('trust proxy', 1);
  }

  const sessionTtlMs = Math.max(1, webAdminConfig.sessionTtlHours) * 60 * 60 * 1000;

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use('/admin/static', express.static(path.join(__dirname, 'public')));
  app.use(session({
    name: 'proforwarder_admin',
    secret: webAdminConfig.sessionSecret || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: webAdminConfig.trustProxy,
      maxAge: sessionTtlMs
    }
  }));

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

    const state = crypto.randomBytes(20).toString('hex');
    req.session.oauthState = state;
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
      logError(`Web admin OAuth error: ${errorDescription || error}`);
      const localBypassAvailable = isLocalBypassRequestAllowed(req, webAdminConfig);
      res.status(400).send(renderLoginPage(webAdminConfig, 'OAuth login failed.', localBypassAvailable));
      return;
    }

    if (!code || !state || !req.session.oauthState || state !== req.session.oauthState) {
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

      req.session.webAdminAuth = {
        user: {
          id: user.id,
          username: user.username,
          global_name: user.global_name || '',
          avatar: user.avatar || ''
        },
        oauthGuilds: Array.isArray(guilds) ? guilds : [],
        loggedInAt: Date.now()
      };
      delete req.session.oauthState;

      res.redirect('/admin');
    } catch (oauthError) {
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

    res.status(200).send(renderDashboardPage(auth));
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
      res.json({
        user: auth.user,
        guilds
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
        const sourceContext = getSourceGuildContext(client, sourceMeta.id);
        if (!sourceContext || !sourceContext.guild) continue;

        sourceGuilds.push({
          id: sourceContext.guild.id,
          name: sourceContext.guild.name,
          sourceBot: sourceMeta.sourceBot,
          sourceChannels: mapGuildChannels(sourceContext.guild, sourceContext.botUser)
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

    try {
      const allowedGuilds = await getAuthorizedGuildSet(client, auth, webAdminConfig.allowedRoleIds);
      if (!allowedGuilds.has(guildId)) {
        res.status(403).json({ error: 'Forbidden for this guild' });
        return;
      }

      const sourceContext = getSourceGuildContext(client, guildId);
      if (!sourceContext || !sourceContext.guild) {
        res.status(400).json({ error: 'Source guild not found in bot cache' });
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
        const targetChatId = typeof req.body.targetChatId === 'string' ? req.body.targetChatId.trim() : '';
        if (!isTelegramChatId(targetChatId)) {
          res.status(400).json({ error: 'targetChatId must be a valid numeric Telegram chat ID' });
          return;
        }
        newConfig.targetChatId = targetChatId;
        newConfig.name = customName || `${sourceChannel.name} to Telegram`;
      }

      const configId = await addForwardConfig(newConfig);
      const created = await getForwardConfigById(configId);
      if (!created) {
        res.status(500).json({ error: 'Config created but could not be reloaded' });
        return;
      }
      clearTelegramDiscoveryCache();

      // Auto-register Telegram chat in tracking DB for future dropdown visibility
      if (newConfig.targetType === 'telegram' && newConfig.targetChatId) {
        (async () => {
          try {
            const TH = require('../handlers/telegramHandler');
            const th = new TH();
            const ok = await th.initialize();
            if (ok) await enrichChatViaAPI(th, newConfig.targetChatId);
          } catch (_) { /* best-effort enrichment */ }
        })();
      }

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

      const allowedGuilds = await getAuthorizedGuildSet(client, auth, webAdminConfig.allowedRoleIds);
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

      const allowedGuilds = await getAuthorizedGuildSet(client, auth, webAdminConfig.allowedRoleIds);
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

      const allowedGuilds = await getAuthorizedGuildSet(client, auth, webAdminConfig.allowedRoleIds);
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

    const chatId = typeof req.body.chatId === 'string' ? req.body.chatId.trim() : '';
    if (!/^-?\d+$/.test(chatId)) {
      res.status(400).json({ error: 'chatId must be a valid numeric Telegram chat ID' });
      return;
    }

    const runtimeConfig = require('../config/config');
    if (!runtimeConfig.telegram || runtimeConfig.telegram.enabled !== true) {
      res.status(400).json({ error: 'Telegram integration is disabled' });
      return;
    }

    try {
      const TelegramHandler = require('../handlers/telegramHandler');
      const telegramHandler = new TelegramHandler();
      const initialized = await telegramHandler.initialize();
      if (!initialized) {
        res.status(500).json({ error: 'Telegram handler initialization failed' });
        return;
      }

      const response = await telegramHandler.callTelegramAPI('getChat', { chat_id: chatId });
      if (!response || !response.ok || !response.result) {
        const desc = response ? response.description : 'Unknown error';
        res.status(400).json({ error: `Bot cannot access this chat: ${desc}` });
        return;
      }

      const chatInfo = response.result;
      const chatType = chatInfo.type || 'unknown';

      // Reject private chats
      if (chatType === 'private') {
        res.status(400).json({ error: 'Private user chats are not supported. Only groups, supergroups, and channels are allowed.' });
        return;
      }

      // Persist to database
      await dbUpsertTelegramChat({
        chatId: String(chatInfo.id),
        title: chatInfo.title || '',
        type: chatType,
        username: chatInfo.username || null,
        memberStatus: 'member',
        discoveredVia: 'manual_verify'
      });

      clearTelegramDiscoveryCache();

      res.json({
        success: true,
        chat: {
          id: String(chatInfo.id),
          title: chatInfo.title || `Chat ${chatInfo.id}`,
          type: chatType,
          username: chatInfo.username || null
        }
      });
    } catch (error) {
      logError(`Telegram chat verify failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to verify Telegram chat' });
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
      const allowedGuildIds = await getAuthorizedGuildSet(client, auth, webAdminConfig.allowedRoleIds);
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
      const allowedGuilds = await getAuthorizedGuildSet(client, auth, webAdminConfig.allowedRoleIds);
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

      if (!channel || channel.type !== 5) {
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
      const readerBotPermissions = '66560'; // ViewChannel, ReadMessageHistory

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
            result.readerBot.inviteUrl = `https://discord.com/oauth2/authorize?client_id=${readerBotId}&permissions=${readerBotPermissions}&scope=bot`;
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
  function mapGuilds(guildCache) {
    const guilds = Array.from(guildCache.values()).map(guild => {
      let ownerName = null;
      if (guild.ownerId) {
        const ownerMember = guild.members.cache.get(guild.ownerId);
        if (ownerMember) ownerName = ownerMember.user.username;
      }
      return {
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        joinedAt: guild.joinedAt ? guild.joinedAt.toISOString() : null,
        icon: guild.iconURL({ size: 64 }) || null,
        owner: ownerName,
        ownerId: guild.ownerId || null
      };
    });
    guilds.sort((a, b) => a.name.localeCompare(b.name));
    return guilds;
  }

  app.get('/api/guilds', async (req, res) => {
    const auth = getEffectiveAuth(req, client, webAdminConfig);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const result = {
        mainBot: { guilds: mapGuilds(client.guilds.cache) },
        readerBot: { enabled: false, online: false, guilds: [] }
      };

      try {
        const { readerBot } = require('../index');
        const runtimeConfig = require('../config/config');
        if (runtimeConfig.readerBot && runtimeConfig.readerBot.enabled) {
          result.readerBot.enabled = true;
          if (readerBot && readerBot.isReady && readerBot.client) {
            result.readerBot.online = true;
            result.readerBot.guilds = mapGuilds(readerBot.client.guilds.cache);
          }
        }
      } catch (_e) {
        // reader bot module not available
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
