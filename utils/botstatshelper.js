const db = require("../database");
const logger = require("../logger");

function fetchBotStatistics() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM bot_statistics`, [], (err, rows) => {
      if (err) {
        logger.errorWrapper("fetchBotStatistics", err);
        return reject(err);
      }
      resolve(rows || []);
    });
  });
}

function fetchTopPlayers(limit) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, matches_played, queue_entries_solo, queue_entries_duo
       FROM player_statistics
       ORDER BY matches_played DESC
       LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) {
          logger.errorWrapper("fetchTopPlayers", err, { limit });
          return reject(err);
        }
        resolve(rows || []);
      }
    );
  });
}

async function updateGlobalLongestMatch(matchTime) {
  try {
    const currentMax = await new Promise((resolve, reject) => {
      db.get(
        `SELECT stat_value FROM bot_statistics WHERE stat_key = 'longest_match_time'`,
        [],
        (err, row) => {
          if (err) {
            logger.errorWrapper("fetchLongestMatchTime", err);
            return reject(err);
          }
          resolve(row?.stat_value || 0);
        }
      );
    });

    if (matchTime > currentMax) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO bot_statistics (stat_key, stat_value)
           VALUES ('longest_match_time', ?)
           ON CONFLICT(stat_key) DO UPDATE SET stat_value = excluded.stat_value`,
          [matchTime],
          (err) => {
            if (err) {
              logger.errorWrapper("updateGlobalLongestMatch", err, {
                matchTime,
              });
              return reject(err);
            }
            logger.info(
              `✅ Updated global longest match time to ${matchTime}ms`
            );
            resolve();
          }
        );
      });
    }
  } catch (error) {
    logger.errorWrapper("updateGlobalLongestMatch_outer", error, { matchTime });
  }
}

function addToPlatformMatchTime(platform, duration) {
  const key = `total_match_time_${platform}`;
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO bot_statistics (stat_key, stat_value)
       VALUES (?, ?)
       ON CONFLICT(stat_key) DO UPDATE SET stat_value = stat_value + ?`,
      [key, duration, duration],
      (err) => {
        if (err) {
          logger.errorWrapper("addToPlatformMatchTime", err, {
            platform,
            duration,
          });
          return reject(err);
        }
        resolve();
      }
    );
  });
}

async function updatePlatformLongestMatchTime(platform, matchTime) {
  const key = `longest_match_time_${platform}`;
  try {
    const currentMax = await new Promise((resolve, reject) => {
      db.get(
        `SELECT stat_value FROM bot_statistics WHERE stat_key = ?`,
        [key],
        (err, row) => (err ? reject(err) : resolve(row?.stat_value || 0))
      );
    });

    if (matchTime > currentMax) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO bot_statistics (stat_key, stat_value)
           VALUES (?, ?)
           ON CONFLICT(stat_key) DO UPDATE SET stat_value = excluded.stat_value`,
          [key, matchTime],
          (err) => {
            if (err) {
              logger.errorWrapper("updatePlatformLongestMatchTime", err, {
                platform,
                matchTime,
              });
              return reject(err);
            }
            resolve();
          }
        );
      });
    }
  } catch (err) {
    logger.errorWrapper("updatePlatformLongestMatchTime_outer", err, {
      platform,
      matchTime,
    });
  }
}

async function fetchGlobalAverageMatchDuration() {
  try {
    const [matchTime, matchCount] = await Promise.all([
      new Promise((resolve, reject) => {
        db.get(
          `SELECT stat_value FROM bot_statistics WHERE stat_key = 'total_match_time'`,
          [],
          (err, row) =>
            err
              ? reject(logger.errorWrapper("fetchTotalMatchTime", err))
              : resolve(row?.stat_value || 0)
        );
      }),
      new Promise((resolve, reject) => {
        db.get(
          `SELECT stat_value FROM bot_statistics WHERE stat_key = 'matches_played'`,
          [],
          (err, row) =>
            err
              ? reject(logger.errorWrapper("fetchMatchesPlayed", err))
              : resolve(row?.stat_value || 0)
        );
      }),
    ]);

    if (matchCount === 0) return 0;

    return matchTime / matchCount;
  } catch (error) {
    logger.errorWrapper("fetchGlobalAverageMatchDuration", error);
    return 0;
  }
}

function fetchAverageQueueTimes() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT platform,
              CASE WHEN duoPartner IS NULL THEN 'solo' ELSE 'duo' END AS queue_type,
              AVG(queue_left_at - queue_entered_at) AS avg_time
       FROM queue_history
       WHERE queue_entered_at IS NOT NULL
         AND queue_left_at IS NOT NULL
         AND (queue_left_at - queue_entered_at) BETWEEN 60000 AND 1800000
       GROUP BY platform, queue_type`,
      [],
      (err, rows) => {
        if (err) {
          logger.errorWrapper("fetchAverageQueueTimes", err);
          return reject(err);
        }
        resolve(rows || []);
      }
    );
  });
}

async function getAverageMatchTime(platform) {
  const timeKey = `total_match_time_${platform}`;
  const countKey = `matches_created_${platform}`;

  const [time, count] = await Promise.all([
    db
      .getAsync(`SELECT stat_value FROM bot_statistics WHERE stat_key = ?`, [
        timeKey,
      ])
      .then((row) => row?.stat_value || 0),
    db
      .getAsync(`SELECT stat_value FROM bot_statistics WHERE stat_key = ?`, [
        countKey,
      ])
      .then((row) => row?.stat_value || 0),
  ]);

  return count > 0 ? Math.floor(time / count) : 0;
}

function incrementPlatformMatchCount(platform) {
  const key = `matches_played_${platform}`;
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO bot_statistics (stat_key, stat_value)
       VALUES (?, 1)
       ON CONFLICT(stat_key) DO UPDATE SET stat_value = stat_value + 1`,
      [key],
      (err) => {
        if (err) {
          logger.errorWrapper("incrementPlatformMatchCount", err, { platform });
          return reject(err);
        }
        resolve();
      }
    );
  });
}

async function fetchTopMvpRecipients(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT receiver_id AS id, COUNT(*) AS total
       FROM mvp_awards
       GROUP BY receiver_id
       ORDER BY total DESC
       LIMIT ?`,
      [limit],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

module.exports = {
  fetchBotStatistics,
  fetchTopPlayers,
  fetchAverageQueueTimes,
  updateGlobalLongestMatch,
  fetchGlobalAverageMatchDuration,
  addToPlatformMatchTime,
  updatePlatformLongestMatchTime,
  getAverageMatchTime,
  incrementPlatformMatchCount,
  fetchTopMvpRecipients,
};
