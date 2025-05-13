// utils/playerStats.js
const db = require("../database");
function fetchPlayerStatistics(playerId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM player_statistics WHERE id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          console.error("Error fetching player statistics:", err.message);
          return reject(err);
        }
        resolve(row || null);
      }
    );
  });
}

function fetchMostCommonDuoPartner(playerId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT partner_id, MAX(pair_count) as count 
         FROM duo_partner_counts 
         WHERE player_id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          console.error("Error fetching most common duo partner:", err.message);
          return reject(err);
        }
        resolve(row || null);
      }
    );
  });
}

function addToPlayerMatchTime(playerId, duration) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE player_statistics 
       SET total_match_time = total_match_time + ?
       WHERE id = ?`,
      [duration, playerId],
      (err) => {
        if (err) {
          console.error("Error adding match time:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

// utils/playerStats.js

function clearAllStatistics() {
  return new Promise(async (resolve, reject) => {
    try {
      await new Promise((res, rej) => {
        db.run(`DELETE FROM player_statistics`, (err) => {
          if (err) {
            console.error("Error clearing player statistics:", err.message);
            return rej(err);
          }
          console.info("Cleared all player statistics.");
          res();
        });
      });

      await new Promise((res, rej) => {
        db.run(`DELETE FROM duo_partner_counts`, (err) => {
          if (err) {
            console.error(
              "Error clearing duo partner statistics:",
              err.message
            );
            return rej(err);
          }
          console.info("Cleared all duo partner statistics.");
          res();
        });
      });

      resolve();
    } catch (error) {
      console.error("Error clearing all statistics:", error.message);
      reject(error);
    }
  });
}

function clearPlayerStatistics(playerId) {
  return new Promise(async (resolve, reject) => {
    try {
      await new Promise((res, rej) => {
        db.run(
          `DELETE FROM player_statistics WHERE id = ?`,
          [playerId],
          (err) => {
            if (err) {
              console.error(
                `Error clearing player statistics for ${playerId}:`,
                err.message
              );
              return rej(err);
            }
            console.info(
              `Cleared statistics for ${playerId} in player_statistics.`
            );
            res();
          }
        );
      });

      await new Promise((res, rej) => {
        db.run(
          `DELETE FROM duo_partner_counts WHERE player_id = ? OR partner_id = ?`,
          [playerId, playerId],
          (err) => {
            if (err) {
              console.error(
                `Error clearing duo stats for ${playerId}:`,
                err.message
              );
              return rej(err);
            }
            console.info(`Cleared duo partner stats for ${playerId}.`);
            res();
          }
        );
      });

      resolve();
    } catch (error) {
      console.error(
        `Error clearing stats for player ${playerId}:`,
        error.message
      );
      reject(error);
    }
  });
}
async function trackFailedReadyCheck(playerId) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO player_statistics (id, failed_ready_checks)
      VALUES (?, 1)
      ON CONFLICT(id) DO UPDATE SET failed_ready_checks = failed_ready_checks + 1
    `,
      [playerId],
      (err) => {
        if (err) {
          console.error("Error tracking failed ready check:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

async function trackLongestMatchTime(playerId, matchTime) {
  try {
    const current = await new Promise((resolve, reject) => {
      db.get(
        `SELECT longest_match_time FROM player_statistics WHERE id = ?`,
        [playerId],
        (err, row) => {
          if (err) {
            console.error(
              "Error fetching current longest match time:",
              err.message
            );
            return reject(err);
          }
          resolve(row?.longest_match_time || 0);
        }
      );
    });

    if (matchTime > current) {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE player_statistics SET longest_match_time = ? WHERE id = ?`,
          [matchTime, playerId],
          (err) => {
            if (err) {
              console.error("Error updating longest match time:", err.message);
              return reject(err);
            }
            resolve();
          }
        );
      });
    }
  } catch (error) {
    console.error("trackLongestMatchTime error:", error.message);
  }
}

function incrementMatchesPlayed(playerId) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO player_statistics (id, matches_played)
      VALUES (?, 1)
      ON CONFLICT(id) DO UPDATE SET matches_played = matches_played + 1
    `,
      [playerId],
      (err) => {
        if (err) {
          console.error("Error incrementing matches_played:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

function trackQueueLeaveTimestamp(playerId) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      UPDATE player_statistics 
      SET queue_left_at = ?
      WHERE id = ?
    `,
      [Date.now(), playerId],
      (err) => {
        if (err) {
          console.error("Error tracking queue leave:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

function trackQueueEnteredTimestamp(playerId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE player_statistics SET queue_entered_at = ? WHERE id = ?`,
      [Date.now(), playerId],
      (err) => {
        if (err) {
          console.error("Error tracking queue enter:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

function addToTotalMatchTime(duration) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO bot_statistics (stat_key, stat_value)
       VALUES ('total_match_time', ?)
       ON CONFLICT(stat_key) DO UPDATE SET stat_value = stat_value + ?`,
      [duration, duration],
      (err) => {
        if (err) {
          console.error("Error adding to total match time:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

// might be tracking elsewhere
function trackDuoPartnerCount(playerId, partnerId) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO duo_partner_counts (player_id, partner_id, pair_count)
       VALUES (?, ?, 1)
       ON CONFLICT(player_id, partner_id) DO UPDATE SET 
         pair_count = pair_count + 1`,
      [playerId, partnerId],
      (err) => {
        if (err) {
          console.error("Error updating duo partner count:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

async function fetchAverageMatchTimeForPlayer(playerId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT total_match_time, matches_played 
       FROM player_statistics WHERE id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          console.error("Error fetching player match stats:", err.message);
          return reject(err);
        }

        if (!row || row.matches_played === 0) return resolve(0);
        resolve(row.total_match_time / row.matches_played);
      }
    );
  });
}

module.exports = {
  fetchPlayerStatistics,
  fetchMostCommonDuoPartner,
  clearAllStatistics,
  clearPlayerStatistics,
  trackFailedReadyCheck,
  trackLongestMatchTime,
  incrementMatchesPlayed,
  trackQueueLeaveTimestamp,
  addToTotalMatchTime,
  trackQueueEnteredTimestamp,
  trackDuoPartnerCount,
  addToPlayerMatchTime,
  fetchAverageMatchTimeForPlayer,
};
