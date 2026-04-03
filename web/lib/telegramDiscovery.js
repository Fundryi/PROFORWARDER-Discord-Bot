const {
  loadForwardConfigs
} = require('../../utils/configManager');
const {
  upsertTelegramChat: dbUpsertTelegramChat,
  getTelegramChats,
  getTelegramChat
} = require('../../utils/database');
const {
  normalizeTelegramChat: trackerNormalize,
  parseMyChatMemberUpdate,
  persistChatsFromUpdates,
  enrichChatViaAPI
} = require('../../utils/telegramChatTracker');

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

  const runtimeConfig = require('../../config/config');
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
      const TelegramHandler = require('../../handlers/telegramHandler');
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

  const runtimeConfig = require('../../config/config');
  if (!runtimeConfig.telegram || runtimeConfig.telegram.enabled !== true) {
    const error = new Error('Telegram integration is disabled');
    error.statusCode = 400;
    throw error;
  }

  const TelegramHandler = require('../../handlers/telegramHandler');
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

module.exports = {
  clearTelegramDiscoveryCache,
  collectTelegramChatOptions,
  verifyAndTrackTelegramChatAccess
};
