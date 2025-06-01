const db = require("../database");
const logger = require("../logger");

/**
 * Enforces queue cooldown and replies to interaction if the user is too early.
 * Returns `true` if the cooldown check passed, `false` if the user was blocked.
 */
async function enforceQueueCooldown(playerId, interaction) {
  try {
    const lastExitTime = await new Promise((resolve, reject) => {
      db.get(
        `SELECT last_queue_exit_at FROM players WHERE id = ?`,
        [playerId],
        (err, row) => {
          if (err) {
            logger.errorWrapper("enforceQueueCooldown_DB", err, { playerId });
            return reject(err);
          }
          resolve(row?.last_queue_exit_at || 0);
        }
      );
    });

    const now = Date.now();
    const cooldown = 30 * 1000; // 30 seconds
    const remaining = cooldown - (now - lastExitTime);

    if (remaining > 0) {
      const seconds = Math.ceil(remaining / 1000);
      const message = `🚫 You must wait ${seconds} more second(s) before re-entering the queue.`;

      logger.info("🕒 Queue cooldown enforced", { playerId, seconds });

      if (interaction?.reply && !interaction.replied) {
        await interaction
          .reply({ content: message, flags: 64 })
          .catch(() => {});
      }

      return false; // Blocked
    }

    logger.debug(`✅ Cooldown check passed for player ${playerId}`);
    return true;
  } catch (err) {
    logger.errorWrapper("enforceQueueCooldown_outer", err, { playerId });
    if (interaction?.reply && !interaction.replied) {
      await interaction
        .reply({
          content: "❌ An error occurred while checking cooldown.",
          flags: 64,
        })
        .catch(() => {});
    }
    return false; // Fail safe: block if error
  }
}

module.exports = { enforceQueueCooldown };
