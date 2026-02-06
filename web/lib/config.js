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

function getWebAdminConfig(config) {
  const configWebAdmin = config.webAdmin || {};
  const commandUiAllowedRoleIds = parseStringArray(config.commandUi?.allowedRoleIds, []);
  const allowedRoleIds = parseStringArray(configWebAdmin.allowedRoleIds, commandUiAllowedRoleIds);

  const localBypassAllowedIps = parseStringArray(
    configWebAdmin.localBypassAllowedIps,
    ['127.0.0.1', '::1', '::ffff:127.0.0.1', '172.17.0.1', '::ffff:172.17.0.1']
  );

  const localBypassAllowedHosts = parseStringArray(
    configWebAdmin.localBypassAllowedHosts,
    ['localhost', '127.0.0.1', '::1']
  );

  return {
    enabled: parseBoolean(configWebAdmin.enabled, false),
    baseUrl: normalizeBaseUrl(configWebAdmin.baseUrl || ''),
    port: parseNumber(configWebAdmin.port, 3001),
    sessionTtlHours: parseNumber(configWebAdmin.sessionTtlHours, 24),
    trustProxy: parseBoolean(configWebAdmin.trustProxy, false),
    debug: parseBoolean(configWebAdmin.debug, false),
    sessionSecret: configWebAdmin.sessionSecret || '',
    oauthClientId: configWebAdmin.oauthClientId || '',
    oauthClientSecret: configWebAdmin.oauthClientSecret || '',
    oauthRedirectUri: configWebAdmin.oauthRedirectUri || '',
    oauthScopes: configWebAdmin.oauthScopes || 'identify guilds',
    localBypassAuth: parseBoolean(configWebAdmin.localBypassAuth, false),
    localBypassAllowedIps,
    localBypassAllowedHosts,
    allowedRoleIds
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

module.exports = {
  getWebAdminConfig,
  validateWebAdminConfig
};
