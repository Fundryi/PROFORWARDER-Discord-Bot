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
  removeTelegramChat,
  get: dbGet,
  all: dbAll,
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
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function clearTelegramDiscoveryCache() {
  telegramDiscoveryCache = {
    loadedAt: 0,
    payload: null
  };
}

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

function renderDashboardPage(auth, webAdminConfig) {
  const tag = escapeHtml(auth.user.global_name || auth.user.username || auth.user.id);
  const debugEnabled = Boolean(webAdminConfig && webAdminConfig.debug);
  const debugNavButton = debugEnabled
    ? '<button id="tab-btn-debug" data-tab="debug" role="tab" aria-selected="false" aria-controls="tab-debug" tabindex="-1">Debug</button>'
    : '';
  const debugTabSection = debugEnabled
    ? `
    <!-- Debug Tab -->
    <section id="tab-debug" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-debug" aria-hidden="true">
      <div class="card">
        <div class="header-bar">
          <h2>Database Diagnostics</h2>
          <button id="debug-refresh" class="button secondary sm" type="button">Refresh</button>
        </div>
        <p class="muted-text">Read-only curated diagnostics. Raw SQL input is intentionally not exposed.</p>
        <div id="debug-db-summary" class="stat-grid">
          <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">Loading</div></div>
        </div>
      </div>

      <div class="card">
        <div class="header-bar">
          <h2>Message Drilldown</h2>
          <div class="row">
            <input id="debug-message-id" class="input" type="text" placeholder="Discord message ID">
            <button id="debug-message-search" class="button secondary sm" type="button">Search</button>
          </div>
        </div>
        <p class="muted-text">Search by original or forwarded message ID. Includes edit-handler success subset.</p>
        <p id="debug-message-meta" class="muted-text">Enter a message ID and click Search.</p>

        <h3>All Matches</h3>
        <div class="table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Time</th>
                <th>Status</th>
                <th>Config</th>
                <th>Original</th>
                <th>Forwarded</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="debug-message-all-body">
              <tr><td colspan="7" class="muted-text">Enter a message ID and click Search.</td></tr>
            </tbody>
          </table>
        </div>

        <h3>Edit Handler Matches (Original + Success)</h3>
        <div class="table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Time</th>
                <th>Status</th>
                <th>Config</th>
                <th>Original</th>
                <th>Forwarded</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="debug-message-edit-body">
              <tr><td colspan="7" class="muted-text">Enter a message ID and click Search.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Message Log Status Counts</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody id="debug-log-status-body">
              <tr><td colspan="2" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Telegram Discovery Sources</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>discoveredVia</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody id="debug-discovered-via-body">
              <tr><td colspan="2" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Recent Bot Setting Updates</h2>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody id="debug-settings-body">
              <tr><td colspan="2" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Recent Message Logs</h2>
        <div class="table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Time</th>
                <th>Status</th>
                <th>Config</th>
                <th>Original</th>
                <th>Forwarded</th>
              </tr>
            </thead>
            <tbody id="debug-recent-logs-body">
              <tr><td colspan="6" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Recent Failed Logs</h2>
        <div class="table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Time</th>
                <th>Config</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="debug-failed-logs-body">
              <tr><td colspan="4" class="muted-text">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>`
    : '';
  const debugScriptTag = debugEnabled
    ? '\n  <script src="/admin/static/debug.js"></script>'
    : '';
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
      <p id="status-message" class="muted-text" role="status" aria-live="polite">Ready.</p>
    </section>

    <nav class="tab-nav" role="tablist" aria-label="Admin Sections">
      <button id="tab-btn-dashboard" data-tab="dashboard" class="active" role="tab" aria-selected="true" aria-controls="tab-dashboard" tabindex="0">Dashboard</button>
      <button id="tab-btn-configs" data-tab="configs" role="tab" aria-selected="false" aria-controls="tab-configs" tabindex="-1">Configs</button>
      <button id="tab-btn-autopublish" data-tab="autopublish" role="tab" aria-selected="false" aria-controls="tab-autopublish" tabindex="-1">Auto Publish</button>
      <button id="tab-btn-guilds" data-tab="guilds" role="tab" aria-selected="false" aria-controls="tab-guilds" tabindex="-1">Guilds</button>
      <button id="tab-btn-logs" data-tab="logs" role="tab" aria-selected="false" aria-controls="tab-logs" tabindex="-1">Logs</button>
      <button id="tab-btn-settings" data-tab="settings" role="tab" aria-selected="false" aria-controls="tab-settings" tabindex="-1">Settings</button>
      ${debugNavButton}
    </nav>

    <!-- Dashboard Tab -->
    <section id="tab-dashboard" class="tab-panel active" role="tabpanel" aria-labelledby="tab-btn-dashboard" aria-hidden="false">
      <div class="card">
        <h2>Bot Status</h2>
        <div id="dashboard-stats" class="stat-grid">
          <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">Status</div></div>
        </div>
      </div>
      <div class="card">
        <div class="header-bar">
          <h2>Reader Diagnostics</h2>
          <button id="reader-diagnostics-refresh" class="button secondary sm" type="button">Refresh</button>
        </div>
        <div id="reader-diagnostics-panel" class="reader-diagnostics">
          <p class="muted-text">Loading reader diagnostics...</p>
        </div>
      </div>
    </section>

    <!-- Configs Tab -->
    <section id="tab-configs" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-configs" aria-hidden="true">
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
              <label>Source Bot
                <select id="discord-source-bot" class="input">
                  <option value="main">Main Bot</option>
                </select>
              </label>
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
              <label>Source Bot
                <select id="telegram-source-bot" class="input">
                  <option value="main">Main Bot</option>
                </select>
              </label>
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
              <label>Target Chat<input id="telegram-chat-id" class="input" required placeholder="Select above or enter Chat ID, @username, or t.me link"></label>
              <p id="telegram-chat-hint" class="muted-text">Enter Chat ID, @username, or t.me link. Bot access is verified automatically when creating the forward.</p>
              <label>Tracked Telegram Chats
                <input id="telegram-chat-search" class="input select-search" placeholder="Search tracked chats">
                <select id="telegram-chat-select" class="input">
                  <option value="">Select a tracked chat (optional)</option>
                </select>
              </label>
              <div class="row telegram-tracked-actions">
                <button type="button" id="telegram-chat-remove-btn" class="button secondary sm danger">Remove Selected Tracked Chat</button>
              </div>
              <p class="muted-text">Removing a tracked chat only removes it from this list. It does not remove the bot from Telegram.</p>
            </fieldset>
          </div>
          <label>Name (optional)<input id="telegram-name" class="input"></label>
          <button type="submit" class="button">Create Telegram Forward</button>
        </form>
      </div>
    </section>

    <!-- Auto Publish Tab -->
    <section id="tab-autopublish" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-autopublish" aria-hidden="true">
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
    <section id="tab-guilds" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-guilds" aria-hidden="true">
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
    <section id="tab-logs" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-logs" aria-hidden="true">
      <div class="card">
        <h2>Message Logs</h2>
        <div class="filter-bar">
          <select id="logs-config-filter" class="input">
            <option value="">All Configs</option>
          </select>
          <select id="logs-status-filter" class="input">
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
    <section id="tab-settings" class="tab-panel" role="tabpanel" aria-labelledby="tab-btn-settings" aria-hidden="true">
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
    ${debugTabSection}

    <div id="confirm-modal" class="modal-overlay" aria-hidden="true">
      <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title" aria-describedby="confirm-modal-body">
        <div id="confirm-modal-title" class="modal-title">Please Confirm</div>
        <div id="confirm-modal-body" class="modal-body"></div>
        <div class="modal-actions">
          <button id="confirm-modal-cancel" class="button secondary" type="button">Cancel</button>
          <button id="confirm-modal-ok" class="button danger" type="button">Confirm</button>
        </div>
      </div>
    </div>
  </main>

  <script src="/admin/static/app.js"></script>
  <script src="/admin/static/dashboard.js"></script>
  <script src="/admin/static/configs.js"></script>
  <script src="/admin/static/autopublish.js"></script>
  <script src="/admin/static/guilds.js"></script>
  <script src="/admin/static/logs.js"></script>
  <script src="/admin/static/settings.js"></script>${debugScriptTag}
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
    useReaderBot: configItem.useReaderBot === true,
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
  const guilds = await getManageableSourceGuilds(client, auth, allowedRoleIds);
  return new Set(guilds.map(guild => guild.id));
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

function buildReaderInviteUrlFromClient(readerClient) {
  if (!readerClient || !readerClient.user) return null;
  return `https://discord.com/oauth2/authorize?client_id=${readerClient.user.id}&permissions=66560&scope=bot`;
}

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

async function buildReaderStatusDiagnostics(mainClient, configs) {
  const runtimeConfig = require('../config/config');
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

async function verifyAndTrackTelegramChatAccess(chatId, options = {}) {
  const discoveredVia = typeof options.discoveredVia === 'string' && options.discoveredVia.trim()
    ? options.discoveredVia.trim()
    : 'manual_verify';

  const runtimeConfig = require('../config/config');
  if (!runtimeConfig.telegram || runtimeConfig.telegram.enabled !== true) {
    const error = new Error('Telegram integration is disabled');
    error.statusCode = 400;
    throw error;
  }

  const TelegramHandler = require('../handlers/telegramHandler');
  const telegramHandler = new TelegramHandler();
  const initialized = await telegramHandler.initialize();
  if (!initialized) {
    const error = new Error('Telegram handler initialization failed');
    error.statusCode = 500;
    throw error;
  }

  const response = await telegramHandler.callTelegramAPI('getChat', { chat_id: chatId });
  if (!response || !response.ok || !response.result) {
    const description = response && response.description ? response.description : 'Unknown error';
    const error = new Error(`Bot cannot access this chat: ${description}`);
    error.statusCode = 400;
    throw error;
  }

  const chatInfo = response.result;
  const chatType = chatInfo.type || 'unknown';

  if (chatType === 'private') {
    const error = new Error('Private user chats are not supported. Only groups, supergroups, and channels are allowed.');
    error.statusCode = 400;
    throw error;
  }

  await dbUpsertTelegramChat({
    chatId: String(chatInfo.id),
    title: chatInfo.title || '',
    type: chatType,
    username: chatInfo.username || null,
    memberStatus: 'member',
    discoveredVia
  });

  clearTelegramDiscoveryCache();

  return {
    id: String(chatInfo.id),
    title: chatInfo.title || `Chat ${chatInfo.id}`,
    type: chatType,
    username: chatInfo.username || null
  };
}

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

  app.use((req, _res, next) => {
    if (req.session && !req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    }
    next();
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
      res.json({
        user: auth.user,
        guilds,
        csrfToken: webAdminConfig.securityStrict
          ? (req.session && req.session.csrfToken ? req.session.csrfToken : null)
          : null
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
      const allowedGuilds = await getAuthorizedGuildSet(client, auth, webAdminConfig.allowedRoleIds);
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
      const allowedGuildIds = await getAuthorizedGuildSet(client, auth, webAdminConfig.allowedRoleIds);
      const isLocalBypass = Boolean(auth.localBypass);
      const allConfigs = await loadForwardConfigs();
      const scopedConfigs = (allConfigs || []).filter(configItem => {
        if (!configItem || configItem.sourceType !== 'discord') return false;
        if (configItem.enabled === false) return false;
        const sourceServerId = String(configItem.sourceServerId || '').trim();
        if (!sourceServerId) return isLocalBypass;
        return allowedGuildIds.has(sourceServerId);
      });

      const status = await buildReaderStatusDiagnostics(client, scopedConfigs);
      res.json(status);
    } catch (error) {
      logError(`Web admin /api/reader-status failed: ${error.message}`);
      res.status(500).json({ error: 'Failed to load reader diagnostics' });
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
