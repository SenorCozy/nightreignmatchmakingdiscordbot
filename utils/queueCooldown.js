// utils/queueCooldown.js
const db = require("../database");

async function enforceQueueCooldown(playerId) {
  const lastQueueTime = await new Promise((resolve, reject) => {
    db.get(
      `SELECT queue_entered_at FROM players WHERE id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          console.error("Error checking last queue time:", err.message);
          return reject(err);
        }
        resolve(row?.queue_entered_at || 0);
      }
    );
  });

  const now = Date.now();
  const cooldown = 30 * 1000; // 30 seconds

  if (now - lastQueueTime < cooldown) {
    const remaining = Math.ceil((cooldown - (now - lastQueueTime)) / 1000);
    throw new Error(
      `🚫 You must wait ${remaining} more second(s) before re-entering the queue.`
    );
  }

  console.debug(`✅ Cooldown check passed for player ${playerId}`);
}

module.exports = { enforceQueueCooldown };
