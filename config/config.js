require('dotenv').config({ path: './config/.env' });

module.exports = {
  // ─── Bot Core ────────────────────────────────────────────────────
  botToken: process.env.BOT_TOKEN,
  debugMode: process.env.DEBUG_MODE === 'true',
  forwardBotMessages: process.env.FORWARD_BOT_MESSAGES !== 'false', // default: true

  // ─── Format Converters ──────────────────────────────────────────
  useSliceFormatConverter: process.env.USE_SLICE_FORMAT_CONVERTER !== 'false', // default: true (PRIMARY)
  useAIFormatConverter: process.env.USE_AI_FORMAT_CONVERTER === 'true', // default: false (FALLBACK)

  // ─── Startup Log Maintenance ────────────────────────────────────
  // Background validation/cleanup of message_logs on startup
  startupLogMaintenance: {
    enabled: process.env.STARTUP_LOG_MAINTENANCE !== 'false', // default: true
    batchSize: 200,
    maxRuntimeMs: 2 * 60 * 1000, // 2 minutes max per startup run
    delayBetweenBatchesMs: 250,
    retentionDays: parseInt(process.env.LOG_RETENTION_DAYS || '180', 10), // 6 months
    retentionAction: process.env.LOG_RETENTION_ACTION || 'skip' // 'skip' | 'delete'
  },

  // ─── Command UI ─────────────────────────────────────────────────
  commandUi: {
    enabled: process.env.COMMAND_UI_ENABLED !== 'false', // default: true
    allowedRoleIds: (process.env.COMMAND_UI_ALLOWED_ROLE_IDS || '')
      .split(',')
      .map(roleId => roleId.trim())
      .filter(Boolean)
  },

  // ─── Reader Bot (Optional) ─────────────────────────────────────
  readerBot: {
    enabled: process.env.READER_BOT_ENABLED === 'true',
    token: process.env.READER_BOT_TOKEN
  },

  // ─── Telegram Integration (Optional) ───────────────────────────
  telegram: {
    enabled: process.env.TELEGRAM_ENABLED === 'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    apiUrl: process.env.TELEGRAM_API_URL || 'https://api.telegram.org',
    hideSourceHeader: process.env.TELEGRAM_HIDE_SOURCE_HEADER === 'true', // default: false
    smartLinkPreviews: process.env.TELEGRAM_SMART_LINK_PREVIEWS !== 'false', // default: true

    // Smart Caption Length Management
    captionLengthLimit: 900,
    textLengthLimit: 4000,
    splitIndicator: '...(continued)',
    captionSplitStrategy: 'separate' // 'smart' | 'separate'
  },

  // ─── AI Integration ─────────────────────────────────────────────
  ai: {
    enabled: true,

    providers: {
      // Google Gemini (primary)
      gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
        maxTokens: 2048,
        temperature: 0
      },
      // Google Translate (fallback)
      google: {
        apiKey: process.env.GOOGLE_TRANSLATE_API_KEY,
        projectId: process.env.GOOGLE_PROJECT_ID
      }
    },

    translation: {
      enabled: true,
      defaultProvider: process.env.AI_TRANSLATION_PROVIDER || 'gemini',
      cacheTranslations: true,
      maxCacheAge: 24 * 60 * 60 * 1000, // 24 hours
      fallbackProvider: 'google'
    },

    optimization: {
      defaultLevel: 'enhanced', // 'basic' | 'enhanced' | 'custom'
      preserveEmojis: true,
      preserveMentions: true,
      preserveLinks: true,
      maxOptimizationLength: 2000
    }
  },

  // ─── Web Admin Panel ────────────────────────────────────────────
  webAdmin: {
    // Common
    enabled: process.env.WEB_ADMIN_ENABLED === 'true',
    port: parseInt(process.env.WEB_ADMIN_PORT || '3001', 10),
    authMode: (process.env.WEB_ADMIN_AUTH_MODE || 'local')
      .toLowerCase(),
    sessionSecret: process.env.WEB_ADMIN_SESSION_SECRET || '',
    sessionTtlHours: parseInt(process.env.WEB_ADMIN_SESSION_TTL_HOURS || '24', 10),
    debug: process.env.WEB_ADMIN_DEBUG === 'true',

    // Local Mode
    localAllowedHosts: (process.env.WEB_ADMIN_LOCAL_ALLOWED_HOSTS || 'localhost,127.0.0.1,::1')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(Boolean),
    localAllowedIps: (process.env.WEB_ADMIN_LOCAL_ALLOWED_IPS || '')
      .split(',')
      .map(ip => ip.trim())
      .filter(Boolean),

    // Production / OAuth Mode
    baseUrl: process.env.WEB_ADMIN_BASE_URL || '',
    trustProxy: process.env.WEB_ADMIN_TRUST_PROXY === 'true',
    oauthClientId: process.env.WEB_ADMIN_DISCORD_CLIENT_ID || '',
    oauthClientSecret: process.env.WEB_ADMIN_DISCORD_CLIENT_SECRET || '',
    oauthRedirectUri: process.env.WEB_ADMIN_DISCORD_REDIRECT_URI || '',
    oauthScopes: process.env.WEB_ADMIN_DISCORD_SCOPES || 'identify guilds',
    securityStrict: process.env.WEB_ADMIN_SECURITY_STRICT === 'true',
    authRateLimitWindowMs: parseInt(process.env.WEB_ADMIN_AUTH_RATE_LIMIT_WINDOW_MS || String(5 * 60 * 1000), 10),
    authRateLimitMax: parseInt(process.env.WEB_ADMIN_AUTH_RATE_LIMIT_MAX || '60', 10),
    mutationRateLimitWindowMs: parseInt(process.env.WEB_ADMIN_MUTATION_RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10),
    mutationRateLimitMax: parseInt(process.env.WEB_ADMIN_MUTATION_RATE_LIMIT_MAX || '180', 10),
    allowedRoleIds: (process.env.WEB_ADMIN_ALLOWED_ROLE_IDS || '')
      .split(',')
      .map(roleId => roleId.trim())
      .filter(Boolean),

    // Bot Invite (code grant flow)
    botInviteRedirectUri: process.env.BOT_INVITE_REDIRECT_URI || ''
  }
};
