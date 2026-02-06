const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { PermissionFlagsBits } = require('discord.js');
const {
  loadForwardConfigs,
  getForwardConfigById,
  addForwardConfig,
  enableForwardConfig,
  disableForwardConfig,
  removeForwardConfig
} = require('../utils/configManager');
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
  const localBypassAuth = parseBoolean(
    configWebAdmin.localBypassAuth,
    parseBoolean(process.env.WEB_ADMIN_LOCAL_BYPASS_AUTH, false)
  );
  const localBypassAllowedIps = Array.isArray(configWebAdmin.localBypassAllowedIps)
    ? configWebAdmin.localBypassAllowedIps.map(ip => String(ip).trim()).filter(Boolean)
    : parseCsv(
      process.env.WEB_ADMIN_LOCAL_BYPASS_ALLOWED_IPS ||
      '127.0.0.1,::1,::ffff:127.0.0.1,172.17.0.1,::ffff:172.17.0.1'
    );
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
    localBypassAuth,
    localBypassAllowedIps,
    allowedRoleIds: finalAllowedRoleIds
  };
}

function validateWebAdminConfig(webAdminConfig) {
  const required = [
    ['WEB_ADMIN_SESSION_SECRET', webAdminConfig.sessionSecret]
  ];

  if (!webAdminConfig.localBypassAuth) {
    required.push(
      ['WEB_ADMIN_DISCORD_CLIENT_ID', webAdminConfig.oauthClientId],
      ['WEB_ADMIN_DISCORD_CLIENT_SECRET', webAdminConfig.oauthClientSecret],
      ['WEB_ADMIN_DISCORD_REDIRECT_URI', webAdminConfig.oauthRedirectUri]
    );
  }

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

function renderLoginPage(webAdminConfig, errorMessage = '', localBypassAvailable = false) {
  const errorBlock = errorMessage
    ? `<div class="card error">${errorMessage}</div>`
    : '';
  const loginUrl = '/admin/login';
  const localBypassBlock = localBypassAvailable
    ? `<section class="card">
      <h2>Local Test Mode</h2>
      <p>Local bypass is enabled for localhost-only testing.</p>
      <a class="button secondary" href="/admin/dev-login">Continue without OAuth</a>
    </section>`
    : '';
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
    ${localBypassBlock}
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
        <span class="badge">Phase 3: Safe mutations enabled</span>
        <a class="button secondary" href="/admin/logout">Logout</a>
      </div>
    </section>

    <section class="card">
      <h2>Status</h2>
      <p id="status-message" class="muted-text">Ready.</p>
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="configs-body">
            <tr><td colspan="6" class="muted-text">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>Create Discord Forward</h2>
      <form id="create-discord-form" class="form-grid">
        <label>Source Channel ID<input id="discord-source-channel" class="input" required></label>
        <label>Target Channel ID<input id="discord-target-channel" class="input" required></label>
        <label>Target Server ID (optional)<input id="discord-target-server" class="input"></label>
        <label>Name (optional)<input id="discord-name" class="input"></label>
        <button type="submit" class="button">Create Discord Forward</button>
      </form>
    </section>

    <section class="card">
      <h2>Create Telegram Forward</h2>
      <form id="create-telegram-form" class="form-grid">
        <label>Source Channel ID<input id="telegram-source-channel" class="input" required></label>
        <label>Telegram Chat ID<input id="telegram-chat-id" class="input" required></label>
        <label>Name (optional)<input id="telegram-name" class="input"></label>
        <button type="submit" class="button">Create Telegram Forward</button>
      </form>
    </section>
  </main>

  <script>
    const guildSelect = document.getElementById('guild-select');
    const guildHelp = document.getElementById('guild-help');
    const configsBody = document.getElementById('configs-body');
    const statusMessage = document.getElementById('status-message');
    const createDiscordForm = document.getElementById('create-discord-form');
    const createTelegramForm = document.getElementById('create-telegram-form');
    let currentGuildId = '';

    function setStatus(message, isError = false) {
      statusMessage.textContent = message;
      statusMessage.className = isError ? 'error-text' : 'muted-text';
    }

    async function fetchJson(url, options = {}) {
      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        },
        ...options
      });
      if (!response.ok) {
        let message = 'Request failed';
        try {
          const payload = await response.json();
          message = payload.error || message;
        } catch (jsonError) {
          const text = await response.text();
          if (text) message = text;
        }
        throw new Error(message);
      }
      return response.json();
    }

    function setConfigsMessage(message) {
      configsBody.innerHTML = '';
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
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

    function createCell(text) {
      const cell = document.createElement('td');
      cell.textContent = text;
      return cell;
    }

    function renderConfigs(configs) {
      configsBody.innerHTML = '';
      if (!configs.length) {
        setConfigsMessage('No configurations found for this guild.');
        return;
      }
      for (const config of configs) {
        const row = document.createElement('tr');
        row.appendChild(createCell(String(config.id)));
        row.appendChild(createCell(config.name || 'Unnamed'));
        row.appendChild(createCell(config.sourceChannelId || '-'));
        row.appendChild(createCell(targetText(config)));
        row.appendChild(createCell(config.enabled !== false ? 'Enabled' : 'Disabled'));

        const actionsCell = document.createElement('td');
        const toggleButton = document.createElement('button');
        toggleButton.className = 'button secondary';
        toggleButton.textContent = config.enabled !== false ? 'Disable' : 'Enable';
        toggleButton.addEventListener('click', async () => {
          try {
            setStatus('Updating config ' + config.id + '...');
            await fetchJson('/api/configs/' + config.id, {
              method: 'PATCH',
              body: JSON.stringify({ enabled: !(config.enabled !== false) })
            });
            setStatus('Config ' + config.id + ' updated.');
            await loadConfigs(currentGuildId);
          } catch (error) {
            setStatus('Update failed: ' + error.message, true);
          }
        });
        actionsCell.appendChild(toggleButton);

        const removeButton = document.createElement('button');
        removeButton.className = 'button secondary danger';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', async () => {
          const confirmed = confirm('Remove config ' + config.id + '?');
          if (!confirmed) return;
          try {
            setStatus('Removing config ' + config.id + '...');
            await fetchJson('/api/configs/' + config.id, { method: 'DELETE' });
            setStatus('Config ' + config.id + ' removed.');
            await loadConfigs(currentGuildId);
          } catch (error) {
            setStatus('Remove failed: ' + error.message, true);
          }
        });
        actionsCell.appendChild(removeButton);

        if (config.targetType === 'telegram') {
          const testButton = document.createElement('button');
          testButton.className = 'button secondary';
          testButton.textContent = 'Test Telegram';
          testButton.addEventListener('click', async () => {
            try {
              setStatus('Testing Telegram for config ' + config.id + '...');
              const result = await fetchJson('/api/configs/' + config.id + '/test-telegram', { method: 'POST' });
              setStatus('Telegram test success. Message ID: ' + (result.messageId || '-'));
            } catch (error) {
              setStatus('Telegram test failed: ' + error.message, true);
            }
          });
          actionsCell.appendChild(testButton);
        }

        row.appendChild(actionsCell);
        configsBody.appendChild(row);
      }
    }

    async function loadConfigs(guildId) {
      if (!guildId) {
        currentGuildId = '';
        setConfigsMessage('Select a guild to view configurations.');
        return;
      }
      currentGuildId = guildId;
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

        guildHelp.textContent = 'You can now create, enable/disable, remove, and test configs.';
        await loadConfigs(guildSelect.value);
      } catch (error) {
        guildHelp.textContent = 'Failed to load user context.';
        setConfigsMessage('Failed to load dashboard.');
      }
    }

    guildSelect.addEventListener('change', () => {
      loadConfigs(guildSelect.value);
    });

    createDiscordForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!currentGuildId) {
        setStatus('Select a guild first.', true);
        return;
      }

      const payload = {
        guildId: currentGuildId,
        targetType: 'discord',
        sourceChannelId: document.getElementById('discord-source-channel').value.trim(),
        targetChannelId: document.getElementById('discord-target-channel').value.trim(),
        targetServerId: document.getElementById('discord-target-server').value.trim(),
        name: document.getElementById('discord-name').value.trim()
      };

      try {
        setStatus('Creating Discord forward...');
        await fetchJson('/api/configs', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        createDiscordForm.reset();
        setStatus('Discord forward created.');
        await loadConfigs(currentGuildId);
      } catch (error) {
        setStatus('Create failed: ' + error.message, true);
      }
    });

    createTelegramForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!currentGuildId) {
        setStatus('Select a guild first.', true);
        return;
      }

      const payload = {
        guildId: currentGuildId,
        targetType: 'telegram',
        sourceChannelId: document.getElementById('telegram-source-channel').value.trim(),
        targetChatId: document.getElementById('telegram-chat-id').value.trim(),
        name: document.getElementById('telegram-name').value.trim()
      };

      try {
        setStatus('Creating Telegram forward...');
        await fetchJson('/api/configs', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        createTelegramForm.reset();
        setStatus('Telegram forward created.');
        await loadConfigs(currentGuildId);
      } catch (error) {
        setStatus('Create failed: ' + error.message, true);
      }
    });

    loadMe();
  </script>
</body>
</html>`;
}

function getAuthFromSession(req) {
  return req.session && req.session.webAdminAuth ? req.session.webAdminAuth : null;
}

function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  return ip.trim().toLowerCase();
}

function normalizeHost(hostHeader) {
  if (!hostHeader || typeof hostHeader !== 'string') return '';
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith('[')) {
    const closingBracket = host.indexOf(']');
    if (closingBracket > 1) {
      const inner = host.slice(1, closingBracket);
      return inner;
    }
  }
  return host.split(':')[0];
}

function isLocalBypassRequestAllowed(req, webAdminConfig) {
  if (!webAdminConfig.localBypassAuth) return false;
  if (webAdminConfig.trustProxy) return false;

  const host = normalizeHost(req.get('host') || '');
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localHosts.has(host)) return false;

  const remoteIp = normalizeIp(req.socket?.remoteAddress || req.ip || '');
  const allowedIps = new Set((webAdminConfig.localBypassAllowedIps || []).map(normalizeIp));
  return allowedIps.has(remoteIp);
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

  app.get('/admin/login', (req, res) => {
    if (!webAdminConfig.oauthClientId || !webAdminConfig.oauthClientSecret || !webAdminConfig.oauthRedirectUri) {
      const localBypassAvailable = isLocalBypassRequestAllowed(req, webAdminConfig);
      res.status(400).send(renderLoginPage(
        webAdminConfig,
        'OAuth is not configured. Set Discord OAuth env values or use local bypass.',
        localBypassAvailable
      ));
      return;
    }

    const state = crypto.randomBytes(20).toString('hex');
    req.session.oauthState = state;
    res.redirect(buildDiscordAuthorizeUrl(webAdminConfig, state));
  });

  app.get('/admin/dev-login', (req, res) => {
    if (!isLocalBypassRequestAllowed(req, webAdminConfig)) {
      res.status(403).send(renderLoginPage(
        webAdminConfig,
        'Local bypass is not allowed for this request origin.',
        false
      ));
      return;
    }

    req.session.webAdminAuth = buildLocalBypassAuth(client);
    delete req.session.oauthState;
    res.redirect('/admin');
  });

  app.get('/admin/callback', async (req, res) => {
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
    const auth = getAuthFromSession(req);
    if (!auth) {
      const localBypassAvailable = isLocalBypassRequestAllowed(req, webAdminConfig);
      res.status(200).send(renderLoginPage(webAdminConfig, '', localBypassAvailable));
      return;
    }

    res.status(200).send(renderDashboardPage(auth));
  });

  app.get('/admin/shell', (req, res) => {
    const auth = getAuthFromSession(req);
    if (!auth) {
      const localBypassAvailable = isLocalBypassRequestAllowed(req, webAdminConfig);
      res.status(401).send(renderLoginPage(webAdminConfig, 'Not authenticated.', localBypassAvailable));
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
    const auth = getAuthFromSession(req);
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
    const auth = getAuthFromSession(req);
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
    const auth = getAuthFromSession(req);
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
    const auth = getAuthFromSession(req);
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

      const runtimeConfig = require('../config/env');
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

  if (webAdminConfig.localBypassAuth) {
    logInfo('Web admin local bypass auth is enabled (localhost-only checks active)');
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
