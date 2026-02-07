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

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return '';
  return baseUrl.replace(/\/+$/, '');
}

function parseStringArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value
      .map(entry => String(entry).trim())
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean);
  }

  return fallback;
}

function resolveAuthMode(configWebAdmin) {
  const raw = typeof configWebAdmin.authMode === 'string'
    ? configWebAdmin.authMode.trim().toLowerCase()
    : '';

  if (raw === 'local' || raw === 'oauth') {
    return raw;
  }

  return 'local';
}

function getWebAdminConfig(config) {
  const configWebAdmin = config.webAdmin || {};
  const commandUiAllowedRoleIds = parseStringArray(config.commandUi?.allowedRoleIds, []);
  const allowedRoleIds = parseStringArray(configWebAdmin.allowedRoleIds, commandUiAllowedRoleIds);
  const authMode = resolveAuthMode(configWebAdmin);

  const localAllowedHosts = parseStringArray(
    configWebAdmin.localAllowedHosts,
    ['localhost', '127.0.0.1', '::1']
  );

  const localAllowedIps = parseStringArray(
    configWebAdmin.localAllowedIps,
    []
  );

  return {
    enabled: parseBoolean(configWebAdmin.enabled, false),
    baseUrl: normalizeBaseUrl(configWebAdmin.baseUrl || ''),
    port: parseNumber(configWebAdmin.port, 3001),
    sessionTtlHours: parseNumber(configWebAdmin.sessionTtlHours, 24),
    trustProxy: parseBoolean(configWebAdmin.trustProxy, false),
    debug: parseBoolean(configWebAdmin.debug, false),
    authMode,
    sessionSecret: configWebAdmin.sessionSecret || '',
    oauthClientId: configWebAdmin.oauthClientId || '',
    oauthClientSecret: configWebAdmin.oauthClientSecret || '',
    oauthRedirectUri: configWebAdmin.oauthRedirectUri || '',
    oauthScopes: configWebAdmin.oauthScopes || 'identify guilds',
    botInviteRedirectUri: configWebAdmin.botInviteRedirectUri || '',
    securityStrict: parseBoolean(configWebAdmin.securityStrict, false),
    authRateLimitWindowMs: parseNumber(configWebAdmin.authRateLimitWindowMs, 5 * 60 * 1000),
    authRateLimitMax: parseNumber(configWebAdmin.authRateLimitMax, 60),
    mutationRateLimitWindowMs: parseNumber(configWebAdmin.mutationRateLimitWindowMs, 60 * 1000),
    mutationRateLimitMax: parseNumber(configWebAdmin.mutationRateLimitMax, 180),
    localAllowedHosts,
    localAllowedIps,
    allowedRoleIds
  };
}

function validateWebAdminConfig(webAdminConfig) {
  const required = [];

  if (webAdminConfig.authMode === 'oauth') {
    required.push(
      ['WEB_ADMIN_SESSION_SECRET', webAdminConfig.sessionSecret],
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

module.exports = {
  getWebAdminConfig,
  validateWebAdminConfig
};
