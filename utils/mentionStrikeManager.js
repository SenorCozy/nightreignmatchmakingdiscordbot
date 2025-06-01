const logger = require("../logger");

// In-memory map to track unauthorized mention strikes
const mentionStrikes = new Map(); // userId -> count

function incrementMentionStrike(userId) {
  const newCount = (mentionStrikes.get(userId) || 0) + 1;
  mentionStrikes.set(userId, newCount);
  return newCount;
}

function getMentionStrikeCount(userId) {
  return mentionStrikes.get(userId) || 0;
}

function clearMentionStrikes(userId, context = {}) {
  try {
    if (mentionStrikes.has(userId)) {
      mentionStrikes.delete(userId);
      logger.info("🧹 Cleared mention strikes", {
        userId,
        ...context,
      });
    }
  } catch (err) {
    logger.errorWrapper("clearMentionStrikes", err, {
      userId,
      ...context,
    });
  }
}

module.exports = {
  mentionStrikes,
  incrementMentionStrike,
  getMentionStrikeCount,
  clearMentionStrikes,
};
