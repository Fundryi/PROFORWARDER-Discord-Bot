const { upsertTelegramChat, getTelegramChats } = require('./database');
const { logInfo, logError, logSuccess } = require('./logger');

const ALLOWED_TYPES = new Set(['group', 'supergroup', 'channel']);

/**
 * Normalize a Telegram chat object to a standard shape.
 */
function normalizeTelegramChat(chat) {
  if (!chat || (chat.id === undefined || chat.id === null)) return null;
  const id = String(chat.id);
  const type = chat.type || 'unknown';
  const title = chat.title
    || `${chat.first_name || ''} ${chat.last_name || ''}`.trim()
    || `Chat ${id}`;
  return { id, title, type, username: chat.username || null };
}

/**
 * Check whether a chat should be included (group/supergroup/channel only).
 */
function shouldIncludeChat(chat) {
  if (!chat) return false;
  return ALLOWED_TYPES.has(String(chat.type || '').toLowerCase());
}

/**
 * Extract chat + memberStatus from a my_chat_member update.
 * Returns null if the update is not a my_chat_member event.
 */
function parseMyChatMemberUpdate(update) {
  if (!update || !update.my_chat_member) return null;
  const myChatMember = update.my_chat_member;
  const chat = myChatMember.chat;
  const newStatus = myChatMember.new_chat_member?.status || null;
  if (!chat || !newStatus) return null;
  return { chat, memberStatus: newStatus };
}

/**
 * Extract a chat object from any standard update type (message, channel_post, etc).
 */
function parseUpdateChat(update) {
  if (!update || typeof update !== 'object') return null;
  return update.message?.chat
    || update.edited_message?.chat
    || update.channel_post?.chat
    || update.edited_channel_post?.chat
    || null;
}

/**
 * Process an array of Telegram updates and persist discovered chats to the database.
 * Handles both regular message updates and my_chat_member events.
 */
async function persistChatsFromUpdates(updates) {
  if (!Array.isArray(updates)) return;

  for (const update of updates) {
    // Message-based chat discovery
    const rawChat = parseUpdateChat(update);
    if (rawChat) {
      const normalized = normalizeTelegramChat(rawChat);
      if (normalized && shouldIncludeChat(normalized)) {
        try {
          await upsertTelegramChat({
            chatId: normalized.id,
            title: normalized.title,
            type: normalized.type,
            username: normalized.username,
            memberStatus: 'unknown',
            discoveredVia: 'updates'
          });
        } catch (err) {
          logError(`Failed to persist Telegram chat ${normalized.id}: ${err.message}`);
        }
      }
    }

    // my_chat_member event (bot added/removed)
    const memberEvent = parseMyChatMemberUpdate(update);
    if (memberEvent) {
      const normalized = normalizeTelegramChat(memberEvent.chat);
      if (normalized) {
        try {
          await upsertTelegramChat({
            chatId: normalized.id,
            title: normalized.title,
            type: normalized.type,
            username: normalized.username,
            memberStatus: memberEvent.memberStatus,
            discoveredVia: 'my_chat_member'
          });
        } catch (err) {
          logError(`Failed to persist my_chat_member for ${normalized.id}: ${err.message}`);
        }
      }
    }
  }
}

/**
 * Call Telegram getChat API to enrich a chat ID with real metadata.
 * Persists the result to the database. Returns the normalized chat or null.
 */
async function enrichChatViaAPI(telegramHandler, chatId) {
  try {
    const response = await telegramHandler.callTelegramAPI('getChat', { chat_id: chatId });
    if (response && response.ok && response.result) {
      const normalized = normalizeTelegramChat(response.result);
      if (normalized) {
        await upsertTelegramChat({
          chatId: normalized.id,
          title: normalized.title,
          type: normalized.type,
          username: normalized.username,
          memberStatus: 'member',
          discoveredVia: 'config_create'
        });
        return normalized;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Check whether a Telegram API error indicates the bot was removed from a chat.
 */
function isBotRemovedError(error) {
  const msg = String(error && (error.description || error.message) || '').toLowerCase();
  return msg.includes('forbidden')
    || msg.includes('bot was kicked')
    || msg.includes('bot was blocked')
    || msg.includes('chat not found')
    || msg.includes('not a member');
}

/**
 * Startup routine: process any pending Telegram updates and verify existing tracked chats.
 * Should be called once after bot startup when Telegram is enabled.
 */
async function runStartupSync(telegramHandler) {
  // 1. Process pending updates to discover new chats / catch missed my_chat_member events
  try {
    const updates = await telegramHandler.callTelegramAPI('getUpdates', {
      limit: 100,
      timeout: 0,
      allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post', 'my_chat_member']
    });
    if (updates && updates.ok && Array.isArray(updates.result)) {
      await persistChatsFromUpdates(updates.result);
      logInfo(`Telegram startup sync: processed ${updates.result.length} pending updates`);
    }
  } catch (error) {
    logError(`Telegram startup sync: failed to process updates: ${error.message}`);
  }

  // 2. Verify all tracked chats are still accessible via getChat
  let activeCount = 0;
  let removedCount = 0;
  try {
    const trackedChats = await getTelegramChats({ includeLeft: false });
    for (const chat of trackedChats) {
      try {
        const response = await telegramHandler.callTelegramAPI('getChat', { chat_id: chat.chatId });
        if (response && response.ok && response.result) {
          // Chat is accessible - update metadata
          const normalized = normalizeTelegramChat(response.result);
          if (normalized) {
            await upsertTelegramChat({
              chatId: normalized.id,
              title: normalized.title,
              type: normalized.type,
              username: normalized.username,
              memberStatus: chat.memberStatus !== 'unknown' ? chat.memberStatus : 'member',
              discoveredVia: chat.discoveredVia
            });
            activeCount++;
          }
        } else if (response && !response.ok) {
          // API returned an error (e.g. Forbidden, chat not found) - bot may have been removed
          if (isBotRemovedError({ description: response.description || '' })) {
            await upsertTelegramChat({
              chatId: chat.chatId,
              title: chat.title,
              type: chat.type,
              username: chat.username,
              memberStatus: 'left',
              discoveredVia: chat.discoveredVia
            });
            removedCount++;
            logInfo(`Telegram startup sync: bot no longer in chat ${chat.chatId} (${chat.title})`);
          }
        }
      } catch (err) {
        // Network error - keep current status (inconclusive)
        logError(`Telegram startup sync: could not verify chat ${chat.chatId}: ${err.message}`);
      }
    }
  } catch (error) {
    logError(`Telegram startup sync: failed to verify tracked chats: ${error.message}`);
  }

  logSuccess(`Telegram startup sync complete: ${activeCount} active, ${removedCount} removed`);
}

module.exports = {
  normalizeTelegramChat,
  shouldIncludeChat,
  parseUpdateChat,
  parseMyChatMemberUpdate,
  persistChatsFromUpdates,
  enrichChatViaAPI,
  isBotRemovedError,
  runStartupSync
};
