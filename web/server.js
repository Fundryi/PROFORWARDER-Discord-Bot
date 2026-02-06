const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
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
    allowedRoleIds
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

function getAuthFromSession(req) {
  return req.session && req.session.webAdminAuth ? req.session.webAdminAuth : null;
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

    res.status(200).send(renderAuthenticatedShell(auth));
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
