const db = require("../database");
const logger = require("../logger");

/**
 * Logs a currency adjustment to the audit table.
 *
 * @param {Object} options
 * @param {string} options.playerId - Discord user ID
 * @param {number} options.amount - Positive or negative currency change
 * @param {string} options.source - 'event' | 'mvp' | 'achievement' | 'manual' | etc.
 * @param {string|null} [options.source_id] - ID of related event/achievement/etc.
 * @param {string} options.modified_by - 'system', moderator ID, or Discord user ID
 * @param {string} [options.reason] - Optional explanation
 */
async function logCurrencyChange({
  playerId,
  amount,
  source,
  source_id = null,
  modified_by,
  reason = null,
}) {
  try {
    await db.runAsync(
      `INSERT INTO currency_audit 
        (player_id, amount_changed, source, source_id, modified_by, modified_at, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [playerId, amount, source, source_id, modified_by, Date.now(), reason]
    );
  } catch (error) {
    logger.error("❌ Failed to log currency change", {
      error,
      playerId,
      amount,
      source,
      source_id,
      modified_by,
      reason,
    });
  }
}

module.exports = { logCurrencyChange };
