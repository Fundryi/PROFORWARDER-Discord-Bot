const { logInfo, logSuccess, logError } = require('../utils/logger');
const { getMessageLogs } = require('../utils/database');

// Handle reaction additions
async function handleReactionAdd(reaction, user, client) {
  try {
    // Skip bot reactions
    if (user.bot) return;
    
    // Skip partial reactions
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        logError('Failed to fetch partial reaction:', error);
        return;
      }
    }

    // Get message logs to find forwarded versions of this message
    const messageLogs = await getMessageLogs();
    const forwardedVersions = messageLogs.filter(log => 
      log.originalMessageId === reaction.message.id && log.status === 'success'
    );

    if (forwardedVersions.length === 0) return;

    logInfo(`Reaction added: forwarding to ${forwardedVersions.length} targets`);

    // Add reaction to each forwarded version
    for (const logEntry of forwardedVersions) {
      try {
        await addReactionToForwarded(reaction, logEntry, client);
      } catch (error) {
        logError(`Failed to add reaction to forwarded message ${logEntry.forwardedMessageId}:`, error);
      }
    }

  } catch (error) {
    logError('Error in handleReactionAdd:', error);
  }
}

// Handle reaction removals
async function handleReactionRemove(reaction, user, client) {
  try {
    // Skip bot reactions
    if (user.bot) return;
    
    // Skip partial reactions
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        logError('Failed to fetch partial reaction:', error);
        return;
      }
    }

    // Get message logs to find forwarded versions of this message
    const messageLogs = await getMessageLogs();
    const forwardedVersions = messageLogs.filter(log => 
      log.originalMessageId === reaction.message.id && log.status === 'success'
    );

    if (forwardedVersions.length === 0) return;

    logInfo(`Reaction removed: updating ${forwardedVersions.length} targets`);

    // Remove reaction from each forwarded version
    for (const logEntry of forwardedVersions) {
      try {
        await removeReactionFromForwarded(reaction, logEntry, client);
      } catch (error) {
        logError(`Failed to remove reaction from forwarded message ${logEntry.forwardedMessageId}:`, error);
      }
    }

  } catch (error) {
    logError('Error in handleReactionRemove:', error);
  }
}

// Handle all reactions being removed
async function handleReactionRemoveAll(message, reactions, client) {
  try {
    // Get message logs to find forwarded versions of this message
    const messageLogs = await getMessageLogs();
    const forwardedVersions = messageLogs.filter(log => 
      log.originalMessageId === message.id && log.status === 'success'
    );

    if (forwardedVersions.length === 0) return;

    logInfo(`All reactions removed: clearing ${forwardedVersions.length} targets`);

    // Remove all reactions from each forwarded version
    for (const logEntry of forwardedVersions) {
      try {
        await clearAllReactionsFromForwarded(logEntry, client);
      } catch (error) {
        logError(`Failed to clear reactions from forwarded message ${logEntry.forwardedMessageId}:`, error);
      }
    }

  } catch (error) {
    logError('Error in handleReactionRemoveAll:', error);
  }
}

// Add reaction to a specific forwarded message
async function addReactionToForwarded(reaction, logEntry, client) {
  try {
    // Get the target channel
    const targetChannel = await getTargetChannel(logEntry, client);
    if (!targetChannel) return;

    // Get the forwarded message
    const forwardedMessage = await targetChannel.messages.fetch(logEntry.forwardedMessageId);
    if (!forwardedMessage) {
      throw new Error(`Forwarded message ${logEntry.forwardedMessageId} not found`);
    }

    // Check if bot can add reactions
    const permissions = targetChannel.permissionsFor(client.user);
    if (!permissions || !permissions.has('AddReactions')) {
      logInfo(`Missing AddReactions permission in ${targetChannel.name}`);
      return;
    }

    // Check if reaction already exists on forwarded message
    const existingReaction = forwardedMessage.reactions.cache.find(r => 
      r.emoji.id === reaction.emoji.id || r.emoji.name === reaction.emoji.name
    );

    if (existingReaction) {
      // Reaction already exists, no need to add it again
      return;
    }

    // Add the reaction
    await forwardedMessage.react(reaction.emoji);
    logSuccess(`Added reaction ${reaction.emoji.name || reaction.emoji} to forwarded message`);

  } catch (error) {
    // Handle specific errors
    if (error.code === 10014) { // Unknown Emoji
      logInfo(`Cannot use emoji ${reaction.emoji.name} in target server`);
    } else if (error.code === 50013) { // Missing Permissions
      logInfo(`Missing permissions to add reactions in target channel`);
    } else {
      throw error;
    }
  }
}

// Remove reaction from a specific forwarded message
async function removeReactionFromForwarded(reaction, logEntry, client) {
  try {
    // Get the target channel
    const targetChannel = await getTargetChannel(logEntry, client);
    if (!targetChannel) return;

    // Get the forwarded message
    const forwardedMessage = await targetChannel.messages.fetch(logEntry.forwardedMessageId);
    if (!forwardedMessage) {
      throw new Error(`Forwarded message ${logEntry.forwardedMessageId} not found`);
    }

    // Find the matching reaction on forwarded message
    const existingReaction = forwardedMessage.reactions.cache.find(r => 
      r.emoji.id === reaction.emoji.id || r.emoji.name === reaction.emoji.name
    );

    if (!existingReaction) {
      // Reaction doesn't exist, nothing to remove
      return;
    }

    // Check if original reaction is completely gone
    if (reaction.count === 0) {
      // Remove bot's reaction
      await existingReaction.users.remove(client.user.id);
      logSuccess(`Removed reaction ${reaction.emoji.name || reaction.emoji} from forwarded message`);
    }

  } catch (error) {
    if (error.code === 50013) { // Missing Permissions
      logInfo(`Missing permissions to remove reactions in target channel`);
    } else {
      throw error;
    }
  }
}

// Clear all reactions from a specific forwarded message
async function clearAllReactionsFromForwarded(logEntry, client) {
  try {
    // Get the target channel
    const targetChannel = await getTargetChannel(logEntry, client);
    if (!targetChannel) return;

    // Get the forwarded message
    const forwardedMessage = await targetChannel.messages.fetch(logEntry.forwardedMessageId);
    if (!forwardedMessage) {
      throw new Error(`Forwarded message ${logEntry.forwardedMessageId} not found`);
    }

    // Check permissions
    const permissions = targetChannel.permissionsFor(client.user);
    if (!permissions || !permissions.has('ManageMessages')) {
      // If can't manage messages, remove bot's reactions individually
      for (const reaction of forwardedMessage.reactions.cache.values()) {
        try {
          await reaction.users.remove(client.user.id);
        } catch (error) {
          logError(`Failed to remove bot reaction:`, error);
        }
      }
    } else {
      // Can manage messages, clear all reactions at once
      await forwardedMessage.reactions.removeAll();
    }

    logSuccess(`Cleared all reactions from forwarded message`);

  } catch (error) {
    if (error.code === 50013) { // Missing Permissions
      logInfo(`Missing permissions to clear reactions in target channel`);
    } else {
      throw error;
    }
  }
}

// Helper function to get target channel from log entry
async function getTargetChannel(logEntry, client) {
  try {
    let targetChannel;
    
    if (logEntry.forwardedServerId) {
      const targetGuild = client.guilds.cache.get(logEntry.forwardedServerId);
      if (!targetGuild) {
        throw new Error(`Target guild ${logEntry.forwardedServerId} not found`);
      }
      targetChannel = targetGuild.channels.cache.get(logEntry.forwardedChannelId);
    } else {
      // Same server - find the guild
      const sourceGuild = client.guilds.cache.find(guild => 
        guild.channels.cache.has(logEntry.originalChannelId)
      );
      targetChannel = sourceGuild?.channels.cache.get(logEntry.forwardedChannelId);
    }

    return targetChannel;
  } catch (error) {
    logError('Error getting target channel for reaction:', error);
    return null;
  }
}

module.exports = {
  handleReactionAdd,
  handleReactionRemove,
  handleReactionRemoveAll
};