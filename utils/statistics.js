const db = require("../database");
const logger = require("../logger");
const {
  unlockAchievementIfNotEarned,
  unlockStatThresholdAchievements,
  allQueueEntryAchievements,
  duoQueueAchievements,
  trioQueueAchievements,
} = require("../utils/achievementHelpers");

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

async function updateQueueStatistics(
  playerId,
  platform,
  formationType = "solo"
) {
  const soloIncrement = formationType === "solo" ? 1 : 0;
  const duoIncrement = formationType === "duo" ? 1 : 0;
  const trioIncrement = formationType === "trio" ? 1 : 0;
  const platformColumn = `platform_usage_${platform}`;

  try {
    await new Promise((resolve, reject) => {
      db.run(
        `
        INSERT INTO player_statistics (
          id, queue_entries, queue_entries_solo, queue_entries_duo, queue_entries_trio,
          ${platformColumn}
        ) VALUES (?, 1, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET 
          queue_entries = queue_entries + 1,
          queue_entries_solo = queue_entries_solo + ?,
          queue_entries_duo = queue_entries_duo + ?,
          queue_entries_trio = queue_entries_trio + ?,
          ${platformColumn} = ${platformColumn} + 1
        `,
        [
          playerId,
          soloIncrement,
          duoIncrement,
          trioIncrement,
          soloIncrement,
          duoIncrement,
          trioIncrement,
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    logger.info(
      `📊 Updated queue statistics for ${playerId} (${formationType})`
    );

    // 🔐 Safely delay unlocks by one tick to ensure visibility
    setImmediate(async () => {
      await unlockStatThresholdAchievements(
        playerId,
        "queue_entries",
        allQueueEntryAchievements
      );

      if (formationType === "duo") {
        await unlockStatThresholdAchievements(
          playerId,
          "queue_entries_duo",
          duoQueueAchievements
        );
      } else if (formationType === "trio") {
        await unlockStatThresholdAchievements(
          playerId,
          "queue_entries_trio",
          trioQueueAchievements
        );
      }
    });
  } catch (error) {
    logger.errorWrapper("UpdateQueueStatistics", error, { playerId });
  }
}

async function trackUniqueUser(userId) {
  try {
    const result = await db.runAsync(
      `INSERT OR IGNORE INTO player_statistics (id) VALUES (?)`,
      [userId]
    );

    // Check if the insert actually happened (SQLite returns changes: 1 if new row)
    if (result?.changes > 0) {
      await db.runAsync(
        `INSERT INTO bot_statistics (stat_key, stat_value)
         VALUES ('unique_users', 1)
         ON CONFLICT(stat_key) DO UPDATE SET stat_value = stat_value + 1`
      );

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
