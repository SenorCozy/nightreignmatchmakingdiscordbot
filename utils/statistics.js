const db = require("../database");
const logger = require("../logger");

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
            logger.errorWrapper("IncrementBotStat_DB", err, { statKey });
            return reject(err);
          }
          resolve();
        }
      );
    });
    logger.info(`📈 Incremented statistic: ${statKey} by ${incrementBy}`);
  } catch (error) {
    logger.errorWrapper("IncrementBotStatistic", error, { statKey });
  }
}

async function updateQueueStatistics(playerId, platform, isSolo) {
  const soloIncrement = isSolo ? 1 : 0;
  const duoIncrement = isSolo ? 0 : 1;

  try {
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
            logger.errorWrapper("UpdateQueueStats_DB", err, {
              playerId,
              platform,
            });
            return reject(err);
          }
          resolve();
        }
      );
    });

    logger.info(`📊 Updated queue statistics for ${playerId}`);
  } catch (error) {
    logger.errorWrapper("UpdateQueueStatistics", error, { playerId });
  }
}

async function trackUniqueUser(userId) {
  try {
    const isTracked = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM player_statistics WHERE id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            logger.errorWrapper("TrackUser_Check", err, { userId });
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
              logger.errorWrapper("TrackUser_Insert", err, { userId });
              return reject(err);
            }
            resolve();
          }
        );
      });

      logger.info(`🧍 Tracked new unique user: ${userId}`);
    }
  } catch (error) {
    logger.errorWrapper("TrackUniqueUser", error, { userId });
  }
}

module.exports = {
  incrementBotStatistic,
  updateQueueStatistics,
  trackUniqueUser,
};
