// utils/stats.js

function fetchBotStatistics() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM bot_statistics`, [], (err, rows) => {
      if (err) {
        logger.error("Error fetching bot statistics:", err.message);
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
          logger.error("Error fetching top players:", err.message);
          return reject(err);
        }
        resolve(rows || []);
      }
    );
  });
}

function fetchAverageQueueTimes() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT p.platform,
                CASE WHEN p.duoPartner IS NULL THEN 'solo' ELSE 'duo' END AS queue_type,
                AVG(ps.queue_left_at - ps.queue_entered_at) AS avg_time
         FROM players p
         JOIN player_statistics ps ON p.id = ps.id
         WHERE ps.queue_entered_at IS NOT NULL AND ps.queue_left_at IS NOT NULL
         GROUP BY p.platform, queue_type`,
      [],
      (err, rows) => {
        if (err) {
          logger.error("Error fetching average queue times:", err.message);
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
};
