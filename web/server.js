const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { PermissionFlagsBits } = require('discord.js');
const { loadForwardConfigs } = require('../utils/configManager');
const { logInfo, logSuccess, logError } = require('../utils/logger');

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}

function parseNumber(value, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function parseCsv(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return '';
  return baseUrl.replace(/\/+$/, '');
}

function getWebAdminConfig(config) {
  const configWebAdmin = config.webAdmin || {};
  const commandUiAllowedRoleIds = Array.isArray(config.commandUi?.allowedRoleIds)
    ? config.commandUi.allowedRoleIds
    : [];

  const enabled = parseBoolean(
    configWebAdmin.enabled,
    parseBoolean(process.env.WEB_ADMIN_ENABLED, false)
  );
  const baseUrl = normalizeBaseUrl(configWebAdmin.baseUrl || process.env.WEB_ADMIN_BASE_URL || '');
  const port = parseNumber(configWebAdmin.port || process.env.WEB_ADMIN_PORT, 3001);
  const sessionTtlHours = parseNumber(
    configWebAdmin.sessionTtlHours || process.env.WEB_ADMIN_SESSION_TTL_HOURS,
    24
  );
  const trustProxy = parseBoolean(
    configWebAdmin.trustProxy,
    parseBoolean(process.env.WEB_ADMIN_TRUST_PROXY, false)
  );
  const sessionSecret = configWebAdmin.sessionSecret || process.env.WEB_ADMIN_SESSION_SECRET || '';
  const oauthClientId = configWebAdmin.oauthClientId || process.env.WEB_ADMIN_DISCORD_CLIENT_ID || '';
  const oauthClientSecret = configWebAdmin.oauthClientSecret || process.env.WEB_ADMIN_DISCORD_CLIENT_SECRET || '';
  const oauthRedirectUri = configWebAdmin.oauthRedirectUri || process.env.WEB_ADMIN_DISCORD_REDIRECT_URI || '';
  const oauthScopes = configWebAdmin.oauthScopes || process.env.WEB_ADMIN_DISCORD_SCOPES || 'identify guilds';
  const allowedRoleIds = Array.isArray(configWebAdmin.allowedRoleIds) && configWebAdmin.allowedRoleIds.length > 0
    ? configWebAdmin.allowedRoleIds
    : parseCsv(process.env.WEB_ADMIN_ALLOWED_ROLE_IDS || '');
  const finalAllowedRoleIds = allowedRoleIds.length > 0 ? allowedRoleIds : commandUiAllowedRoleIds;

  return {
    enabled,
    baseUrl,
    port,
    sessionTtlHours,
    trustProxy,
    sessionSecret,
    oauthClientId,
    oauthClientSecret,
    oauthRedirectUri,
    oauthScopes,
    allowedRoleIds: finalAllowedRoleIds
  };
}

function validateWebAdminConfig(webAdminConfig) {
  const required = [
    ['WEB_ADMIN_SESSION_SECRET', webAdminConfig.sessionSecret],
    ['WEB_ADMIN_DISCORD_CLIENT_ID', webAdminConfig.oauthClientId],
    ['WEB_ADMIN_DISCORD_CLIENT_SECRET', webAdminConfig.oauthClientSecret],
    ['WEB_ADMIN_DISCORD_REDIRECT_URI', webAdminConfig.oauthRedirectUri]
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  return {
    valid: missing.length === 0,
    missing
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

async function exchangeCodeForToken(webAdminConfig, code) {
  const body = new URLSearchParams({
    client_id: webAdminConfig.oauthClientId,
    client_secret: webAdminConfig.oauthClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: webAdminConfig.oauthRedirectUri
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

function renderLoginPage(webAdminConfig, errorMessage = '') {
  const errorBlock = errorMessage
    ? `<div class="card error">${errorMessage}</div>`
    : '';
  const loginUrl = '/admin/login';
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
    <section class="card">
      <h1>ProForwarder Admin</h1>
      <p>Login with Discord to access the web admin panel.</p>
      <a class="button" href="${loginUrl}">Login with Discord</a>
    </section>
    ${errorBlock}
    <section class="card muted">
      <p>Web admin base URL: ${webAdminConfig.baseUrl || '(not set)'}</p>
    </section>
  </main>
</body>
</html>`;
}

function renderAuthenticatedShell(auth) {
  const tag = auth.user.global_name || auth.user.username || auth.user.id;
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
      <h1>ProForwarder Admin</h1>
      <p>Authenticated as <strong>${tag}</strong></p>
      <p>Phase 1 is active. Phase 2 dashboard routes are enabled next.</p>
      <div class="row">
        <a class="button secondary" href="/admin/logout">Logout</a>
      </div>
    </section>
  </main>
</body>
</html>`;
}

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
      <h1>ProForwarder Admin</h1>
      <p>Signed in as <strong>${tag}</strong></p>
      <div class="row">
        <span class="badge">Phase 2: Read-only dashboard</span>
        <a class="button secondary" href="/admin/logout">Logout</a>
      </div>
    </section>

    <section class="card">
      <h2>Guild</h2>
      <select id="guild-select" class="input">
        <option value="">Loading guilds...</option>
      </select>
      <p id="guild-help" class="muted-text"></p>
    </section>

    <section class="card">
      <h2>Forward Configurations</h2>
      <div id="table-wrapper" class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Source</th>
              <th>Target</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="configs-body">
            <tr><td colspan="5" class="muted-text">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <script>
    const guildSelect = document.getElementById('guild-select');
    const guildHelp = document.getElementById('guild-help');
    const configsBody = document.getElementById('configs-body');

    async function fetchJson(url) {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Request failed');
      }
      return response.json();
    }

    function setConfigsMessage(message) {
      configsBody.innerHTML = '';
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'muted-text';
      cell.textContent = message;
      row.appendChild(cell);
      configsBody.appendChild(row);
    }

    function targetText(config) {
      if (config.targetType === 'telegram') {
        return 'Telegram ' + config.targetChatId;
      }
      if (config.targetServerId && config.targetChannelId) {
        return 'Discord ' + config.targetServerId + ':' + config.targetChannelId;
      }
      if (config.targetChannelId) {
        return 'Discord ' + config.targetChannelId;
      }
      return '-';
    }

    function renderConfigs(configs) {
      configsBody.innerHTML = '';
      if (!configs.length) {
        setConfigsMessage('No configurations found for this guild.');
        return;
      }
      for (const config of configs) {
        const row = document.createElement('tr');
        row.innerHTML = '<td>' + config.id + '</td>' +
          '<td>' + (config.name || 'Unnamed') + '</td>' +
          '<td>' + (config.sourceChannelId || '-') + '</td>' +
          '<td>' + targetText(config) + '</td>' +
          '<td>' + (config.enabled !== false ? 'Enabled' : 'Disabled') + '</td>';
        configsBody.appendChild(row);
      }
    }

    async function loadConfigs(guildId) {
      if (!guildId) {
        setConfigsMessage('Select a guild to view configurations.');
        return;
      }
      setConfigsMessage('Loading...');
      try {
        const payload = await fetchJson('/api/configs?guildId=' + encodeURIComponent(guildId));
        renderConfigs(payload.configs || []);
      } catch (error) {
        setConfigsMessage('Failed to load configurations.');
      }
    }

    async function loadMe() {
      try {
        const payload = await fetchJson('/api/me');
        const guilds = payload.guilds || [];

        guildSelect.innerHTML = '';
        if (!guilds.length) {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = 'No authorized guilds found';
          guildSelect.appendChild(option);
          guildHelp.textContent = 'Your account is logged in but has no admin/role access in bot guilds.';
          setConfigsMessage('No authorized guilds available.');
          return;
        }

        for (const guild of guilds) {
          const option = document.createElement('option');
          option.value = guild.id;
          option.textContent = guild.name + ' (' + guild.id + ')';
          guildSelect.appendChild(option);
        }

        guildHelp.textContent = 'Read-only view is active in Phase 2.';
        await loadConfigs(guildSelect.value);
      } catch (error) {
        guildHelp.textContent = 'Failed to load user context.';
        setConfigsMessage('Failed to load dashboard.');
      }
    }

    guildSelect.addEventListener('change', () => {
      loadConfigs(guildSelect.value);
    });

    loadMe();
  </script>
</body>
</html>`;
}

function getAuthFromSession(req) {
  return req.session && req.session.webAdminAuth ? req.session.webAdminAuth : null;
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

  app.get('/admin/login', (req, res) => {
    const state = crypto.randomBytes(20).toString('hex');
    req.session.oauthState = state;
    res.redirect(buildDiscordAuthorizeUrl(webAdminConfig, state));
  });

  app.get('/admin/callback', async (req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      logError(`Web admin OAuth error: ${errorDescription || error}`);
      res.status(400).send(renderLoginPage(webAdminConfig, 'OAuth login failed.'));
      return;
    }

    if (!code || !state || !req.session.oauthState || state !== req.session.oauthState) {
      res.status(400).send(renderLoginPage(webAdminConfig, 'Invalid OAuth state.'));
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
      res.status(500).send(renderLoginPage(webAdminConfig, 'OAuth callback failed. Check server logs.'));
    }
  });

  app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/admin');
    });
  });

  app.get('/admin', (req, res) => {
    const auth = getAuthFromSession(req);
    if (!auth) {
      res.status(200).send(renderLoginPage(webAdminConfig));
      return;
    }

    res.status(200).send(renderDashboardPage(auth));
  });

  app.get('/admin/shell', (req, res) => {
    const auth = getAuthFromSession(req);
    if (!auth) {
      res.status(401).send(renderLoginPage(webAdminConfig, 'Not authenticated.'));
      return;
    }
    res.status(200).send(renderAuthenticatedShell(auth));
  });

  app.get('/api/me', async (req, res) => {
    const auth = getAuthFromSession(req);
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
    const auth = getAuthFromSession(req);
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
        .map(configItem => ({
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
        }));

      res.json({
        guildId,
        configs: guildConfigs
      });
    } catch (error) {
      logError(`Web admin /api/configs failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load configs' });
    }
  });

  app.get('/admin/health', (req, res) => {
    const auth = getAuthFromSession(req);
    res.json({
      ok: true,
      loggedIn: Boolean(auth),
      botReady: Boolean(client && client.isReady && client.isReady())
    });
  });

  return { app, webAdminConfig };
}

function startWebAdminServer(client, config) {
  const webAdminConfig = getWebAdminConfig(config);
  if (!webAdminConfig.enabled) {
    logInfo('Web admin disabled');
    return null;
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
