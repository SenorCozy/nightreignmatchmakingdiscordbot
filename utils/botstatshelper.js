// utils/botstatshelper.js
const db = require("../database");

function fetchBotStatistics() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM bot_statistics`, [], (err, rows) => {
      if (err) {
        console.error("Error fetching bot statistics:", err.message);
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
          console.error("Error fetching top players:", err.message);
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
            console.error("Error fetching longest match time:", err.message);
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
              console.error(
                "Error updating global longest match time:",
                err.message
              );
              return reject(err);
            }
            console.info(
              `✅ Updated global longest match time to ${matchTime}ms`
            );
            resolve();
          }
        );
      });
    }
  } catch (error) {
    console.error("Error in updateGlobalLongestMatch:", error.message);
  }
}
async function fetchGlobalAverageMatchDuration() {
  try {
    const [matchTime, matchCount] = await Promise.all([
      new Promise((resolve, reject) => {
        db.get(
          `SELECT stat_value FROM bot_statistics WHERE stat_key = 'total_match_time'`,
          [],
          (err, row) => (err ? reject(err) : resolve(row?.stat_value || 0))
        );
      }),
      new Promise((resolve, reject) => {
        db.get(
          `SELECT stat_value FROM bot_statistics WHERE stat_key = 'matches_played'`,
          [],
          (err, row) => (err ? reject(err) : resolve(row?.stat_value || 0))
        );
      }),
    ]);

    if (matchCount === 0) return 0;

    return matchTime / matchCount;
  } catch (error) {
    console.error(
      "Error fetching global average match duration:",
      error.message
    );
    return 0;
  }
}

function fetchAverageQueueTimes() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT platform,
              CASE WHEN duoPartner IS NULL THEN 'solo' ELSE 'duo' END AS queue_type,
              AVG(queue_left_at - queue_entered_at) AS avg_time
       FROM player_statistics
       WHERE queue_entered_at IS NOT NULL 
         AND queue_left_at IS NOT NULL
         AND status = 'completed'
       GROUP BY platform, queue_type`,
      [],
      (err, rows) => {
        if (err) {
          console.error("Error fetching average queue times:", err.message);
          return reject(err);
        }
        resolve(rows || []);
      }
    );
  });
}

module.exports = {
  fetchBotStatistics,
  fetchTopPlayers,
  fetchAverageQueueTimes,
  updateGlobalLongestMatch,
  fetchGlobalAverageMatchDuration,
};
