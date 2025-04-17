// utils/playerUtils.js
const db = require("../database");
const logger = require("../logger");

async function removePlayerFromMatch(playerId, threadId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT playerIds FROM channels WHERE threadId = ?`,
      [threadId],
      (err, row) => {
        if (err) {
          logger.error("Error fetching match data:", err.message);
          return reject(err);
        }
        if (!row) {
          logger.warn("Match not found in database, skipping removal.");
          return resolve();
        }

        const updatedPlayerIds = row.playerIds
          .split(",")
          .filter((id) => id !== playerId)
          .join(",");

        db.run(
          `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
          [updatedPlayerIds, threadId],
          (err) => {
            if (err) {
              logger.error("Error updating match players:", err.message);
              return reject(err);
            }

            db.run(
              `UPDATE players SET status = NULL, platform = 'unknown', duoPartner = NULL, queue_entered_at = NULL WHERE id = ?`,
              [playerId],
              (err) => {
                if (err) {
                  logger.error("Error updating player status:", err.message);
                  return reject(err);
                }
                resolve();
              }
            );
          }
        );
      }
    );
  });
}

async function getPlayerById(playerId, fields = "*") {
  try {
    return await new Promise((resolve, reject) => {
      db.get(
        `SELECT ${fields} FROM players WHERE id = ?`,
        [playerId],
        (err, row) => {
          if (err) {
            logger.error(
              `Error fetching player ${playerId} from database:`,
              err.message
            );
            return reject(err);
          }
          resolve(row || null); // Return null if no player is found
        }
      );
    });
  } catch (error) {
    logger.error(
      `Unexpected error in getPlayerById(${playerId}):`,
      error.message
    );
    throw new Error("Failed to fetch player data from the database.");
  }
}

module.exports = {
  getPlayerById,
  // include other player-related utils here
};

async function getQueuePosition(playerId, platform) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, queue_entered_at FROM players WHERE platform = ? AND status = 'queued' ORDER BY queue_entered_at`,
      [platform],
      (err, queue) => {
        if (err) {
          logger.error("❌ SQL error fetching queue position:", err.message);
          return reject(err);
        }

        if (!queue || queue.length === 0) return resolve(1);

        const normalizedPlayerId = String(playerId);
        const playerIndex = queue.findIndex(
          (player) => String(player.id) === normalizedPlayerId
        );

        if (playerIndex === -1) return resolve(1);

        return resolve(playerIndex + 1);
      }
    );
  });
}

async function calculateAverageQueueTime(platform, queueType) {
  return new Promise((resolve, reject) => {
    db.all(
      `
      SELECT (queue_left_at - queue_entered_at) AS wait_time
      FROM player_statistics
      WHERE platform = ? 
      AND queue_entered_at IS NOT NULL 
      AND queue_left_at IS NOT NULL 
      AND status = 'completed'
      AND duoPartner IS ${queueType === "solo" ? "NULL" : "NOT NULL"}
      AND (queue_left_at - queue_entered_at) > 60000
      AND (queue_left_at - queue_entered_at) < 1800000
      ORDER BY queue_left_at DESC
      LIMIT 20
      `,
      [platform],
      (err, rows) => {
        if (err) {
          logger.error("Error calculating average queue time:", err.message);
          return reject(err);
        }

        if (rows.length === 0) {
          return resolve(0);
        }

        const totalTime = rows.reduce((sum, row) => sum + row.wait_time, 0);
        const avgTime = totalTime / rows.length;
        resolve(avgTime);
      }
    );
  });
}

async function isPlayerInServer(playerId, client) {
  const guild = client.guilds.cache.first();
  if (!guild) return false;

  try {
    await guild.members.fetch(); // Refresh cache
    return guild.members.cache.has(playerId);
  } catch (error) {
    logger.error("❌ Error checking server membership:", error.message);
    return false;
  }
}

async function prioritizePlatformsByQueueTime() {
  const platforms = ["pc", "xbox", "playstation"];
  const platformWaitTimes = {};

  for (const platform of platforms) {
    try {
      platformWaitTimes[platform] = await calculateAverageQueueTime(
        platform,
        "solo"
      );
    } catch (err) {
      logger.error(`Error calculating wait time for ${platform}:`, err.message);
      platformWaitTimes[platform] = 0;
    }
  }

  // Sort platforms descending by wait time
  platforms.sort((a, b) => platformWaitTimes[b] - platformWaitTimes[a]);

  return platforms;
}

module.exports = {
  prioritizePlatformsByQueueTime,
};

module.exports = {
  isPlayerInServer,
};

module.exports = {
  removePlayerFromMatch,
  calculateAverageQueueTime,
  getQueuePosition,
  getPlayerById,
  isPlayerInServer,
  prioritizePlatformsByQueueTime,
};
