// utils/statistics.js
const db = require("../database");
async function incrementBotStatistic(statKey, incrementBy = 1) {
  try {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO bot_statistics (stat_key, stat_value)
           VALUES (?, ?)
           ON CONFLICT(stat_key) DO UPDATE SET 
             stat_value = stat_value + ?`,
        [statKey, incrementBy, incrementBy],
        (err) => {
          if (err) {
            console.error("Error incrementing bot statistic:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });
    console.info(`📈 Incremented statistic: ${statKey} by ${incrementBy}`);
  } catch (error) {
    console.error("❌ Error in incrementBotStatistic:", error.message);
  }
}

async function updateQueueStatistics(playerId, platform, isSolo) {
  const soloIncrement = isSolo ? 1 : 0;
  const duoIncrement = isSolo ? 0 : 1;

  await new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO player_statistics (id, queue_entries, queue_entries_solo, queue_entries_duo, top_platform)
         VALUES (?, 1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET 
           queue_entries = queue_entries + 1,
           queue_entries_solo = queue_entries_solo + ?,
           queue_entries_duo = queue_entries_duo + ?,
           top_platform = CASE 
             WHEN top_platform = ? THEN top_platform
             ELSE ?
           END`,
      [
        playerId,
        soloIncrement,
        duoIncrement,
        platform,
        soloIncrement,
        duoIncrement,
        platform,
        platform,
      ],
      (err) => {
        if (err) {
          console.error("❌ Error updating queue statistics:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });

  console.info(`📊 Updated queue statistics for ${playerId}`);
}

async function trackUniqueUser(userId) {
  try {
    const isTracked = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM player_statistics WHERE id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            console.error("Error checking if user is unique:", err.message);
            return reject(err);
          }
          resolve(!!row); // true if exists
        }
      );
    });

    if (!isTracked) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO bot_statistics (stat_key, stat_value)
             VALUES ('unique_users', 1)
             ON CONFLICT(stat_key) DO UPDATE SET 
               stat_value = stat_value + 1`,
          [],
          (err) => {
            if (err) {
              console.error(
                "Error incrementing unique_users statistic:",
                err.message
              );
              return reject(err);
            }
            resolve();
          }
        );
      });

      console.info(`🧍 Tracked new unique user: ${userId}`);
    }
  } catch (error) {
    console.error("Error in trackUniqueUser:", error.message);
  }
}

module.exports = {
  incrementBotStatistic,
  updateQueueStatistics,
  trackUniqueUser,
};
