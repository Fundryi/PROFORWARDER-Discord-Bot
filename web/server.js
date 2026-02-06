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
  enableForwardConfig,
  disableForwardConfig,
  removeForwardConfig,
  getConfigStats
} = require('../utils/configManager');
const {
  getMessageLogs,
  getMessageLogsFiltered,
  getFailedMessages,
  getAllBotSettings,
  getBotSetting,
  setBotSetting,
  get: dbGet,
  run: dbRun
} = require('../utils/database');
const { logInfo, logSuccess, logError } = require('../utils/logger');

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
        <form id="create-discord-form" class="form-grid">
          <label>Source Channel ID<input id="discord-source-channel" class="input" required></label>
          <label>Target Channel ID<input id="discord-target-channel" class="input" required></label>
          <label>Target Server ID (optional)<input id="discord-target-server" class="input"></label>
          <label>Name (optional)<input id="discord-name" class="input"></label>
          <button type="submit" class="button">Create Discord Forward</button>
        </form>
      </div>

      <div class="card">
        <h2>Create Telegram Forward</h2>
        <form id="create-telegram-form" class="form-grid">
          <label>Source Channel ID<input id="telegram-source-channel" class="input" required></label>
          <label>Telegram Chat ID<input id="telegram-chat-id" class="input" required></label>
          <label>Name (optional)<input id="telegram-name" class="input"></label>
          <button type="submit" class="button">Create Telegram Forward</button>
        </form>
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
                <th style="width:32px"></th>
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
                <th style="width:32px"></th>
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
          <button id="logs-refresh" class="button secondary sm">Refresh</button>
        </div>
        <div class="table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Config</th>
                <th>Original</th>
                <th>Forwarded</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="logs-body">
              <tr><td colspan="6" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <button id="logs-load-more" class="button secondary sm" style="display:none">Load More</button>
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
        <p class="muted-text">Key-value settings stored in the database. These can be edited live.</p>
        <div id="bot-settings" class="settings-section"></div>
        <div style="margin-top:14px">
          <h3 style="margin:0 0 8px;font-size:14px;color:var(--text-muted)">Add Setting</h3>
          <form id="add-setting-form" class="add-setting-form">
            <label>Key<input id="new-setting-key" class="input" required></label>
            <label>Value<input id="new-setting-value" class="input" required></label>
            <button type="submit" class="button sm">Add</button>
          </form>
        </div>
      </div>
    </section>
  </main>

  <script src="/admin/static/app.js"></script>
  <script src="/admin/static/dashboard.js"></script>
  <script src="/admin/static/configs.js"></script>
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

function buildLocalBypassAuth(client) {
  const oauthGuilds = Array.from(client.guilds.cache.values()).map(guild => ({
    id: guild.id,
    name: guild.name,
    permissions: String(PermissionFlagsBits.Administrator)
  }));

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

async function getAuthorizedGuildSet(client, auth, allowedRoleIds) {
  const guilds = await getManageableGuilds(client, auth, allowedRoleIds);
  return new Set(guilds.map(guild => guild.id));
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
      const guilds = await getManageableGuilds(client, auth, webAdminConfig.allowedRoleIds);
      res.json({
        user: auth.user,
        guilds
      });
    } catch (error) {
      logError(`Web admin /api/me failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load user context' });
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
      const guilds = await getManageableGuilds(client, auth, webAdminConfig.allowedRoleIds);
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

      const sourceGuild = client.guilds.cache.get(guildId);
      if (!sourceGuild) {
        res.status(400).json({ error: 'Source guild not found in bot cache' });
        return;
      }

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
      res.json({ success: true, removedConfigId: configId });
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
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const beforeId = req.query.beforeId ? parseInt(req.query.beforeId, 10) : null;

      const logs = await getMessageLogsFiltered({ configId, status, limit, beforeId });

      res.json({
        logs,
        hasMore: logs.length === limit,
        nextBeforeId: logs.length > 0 ? logs[logs.length - 1].id : null
      });
    } catch (error) {
      logError(`Web admin /api/logs failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load message logs' });
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

      const configPath = require.resolve('../config/config');
      delete require.cache[configPath];
      const runtimeConfig = require('../config/config');

      res.json({
        settings,
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
      await setBotSetting(key.trim(), String(value));
      res.json({ success: true, key: key.trim(), value: String(value) });
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

    try {
      await dbRun('DELETE FROM bot_settings WHERE key = ?', [req.params.key]);
      res.json({ success: true });
    } catch (error) {
      logError(`Web admin DELETE /api/settings/${req.params.key} failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to delete setting' });
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
