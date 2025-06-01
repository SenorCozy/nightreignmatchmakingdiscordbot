const db = require("../database");
const logger = require("../logger");

const {
  unlockStatThresholdAchievements,
  matchesPlayedAchievements,
} = require("../utils/achievementHelpers");

const {
  unlockAchievementIfNotEarned,
  unlockMatchDurationAchievementThreshold,
  checkPlatformDiversity,
} = require("./achievementHelpers");

async function incrementPlatformUsage(playerId, platform) {
  const columnMap = {
    pc: "platform_usage_pc",
    xbox: "platform_usage_xbox",
    playstation: "platform_usage_playstation",
  };

  const column = columnMap[platform?.toLowerCase()];
  if (!column) return;

  try {
    await db.runAsync(
      `UPDATE player_statistics SET ${column} = ${column} + 1 WHERE id = ?`,
      [playerId]
    );

    logger.info(`✅ Platform usage updated for ${playerId} on ${platform}`);

    // 🎯 Check for 'platforms_all' achievement
    await checkPlatformDiversity(playerId);
  } catch (err) {
    logger.errorWrapper("incrementPlatformUsage failed", err, {
      playerId,
      platform,
    });
  }
}

function ensurePlayerStatRow(playerId) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO player_statistics (
         id, queue_entries, queue_entries_solo, queue_entries_duo,
         matches_played, matches_completed, vc_time, messages_sent,
         failed_ready_checks, longest_match_time, total_match_time,
         platform_usage_pc, platform_usage_xbox, platform_usage_playstation
       ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
      [playerId],
      (err) => {
        if (err) {
          logger.errorWrapper("ensurePlayerStatRow", err, { playerId });
          return reject(err);
        }
        resolve();
      }
    );
  });
}

function fetchPlayerStatistics(playerId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM player_statistics WHERE id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          logger.errorWrapper("fetchPlayerStatistics", err, { playerId });
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
      `SELECT partner_id, pair_count FROM duo_partner_counts 
       WHERE player_id = ? 
       ORDER BY pair_count DESC LIMIT 1`,
      [playerId],
      (err, row) => {
        if (err) {
          logger.errorWrapper("fetchMostCommonDuoPartner", err, { playerId });
          return reject(err);
        }
        resolve(row || null);
      }
    );
  });
}

async function getTopPlatformForPlayer(playerId) {
  try {
    const row = await new Promise((resolve, reject) => {
      db.get(
        `SELECT platform_usage_pc, platform_usage_xbox, platform_usage_playstation 
         FROM player_statistics WHERE id = ?`,
        [playerId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    if (!row) return "N/A";

    const entries = Object.entries(row);
    const [topPlatform] = entries.reduce(
      (max, curr) => (curr[1] > max[1] ? curr : max),
      ["none", 0]
    );

    return topPlatform.replace("platform_usage_", "") || "N/A";
  } catch (err) {
    logger.errorWrapper("getTopPlatformForPlayer", err, { playerId });
    return "N/A";
  }
}
async function updateDuoPartnerStatistics(player1, player2) {
  try {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO duo_partner_counts (player_id, partner_id, pair_count)
         VALUES (?, ?, 1), (?, ?, 1)
         ON CONFLICT(player_id, partner_id) DO UPDATE SET 
           pair_count = pair_count + 1`,
        [player1, player2, player2, player1],
        (err) => {
          if (err) {
            logger.error("Error updating duo partner statistics:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });
    logger.info(`🔗 Updated duo partner stats for ${player1} and ${player2}`);
  } catch (error) {
    logger.error("Error in updateDuoPartnerStatistics:", error.message);
  }
}

async function updateTrioPartnerStatistics(trioMemberIds) {
  try {
    for (const playerId of trioMemberIds) {
      const partners = trioMemberIds.filter((id) => id !== playerId);
      for (const partnerId of partners) {
        await db.runAsync(
          `INSERT INTO trio_partner_counts (player_id, partner_id, pair_count)
           VALUES (?, ?, 1)
           ON CONFLICT(player_id, partner_id) DO UPDATE SET 
             pair_count = pair_count + 1`,
          [playerId, partnerId]
        );
      }
    }
    logger.info(
      `🔗 Updated trio partner stats for trio: ${trioMemberIds.join(", ")}`
    );
  } catch (error) {
    logger.error("Error in updateTrioPartnerStatistics:", error.message);
  }
}

async function addToPlayerMatchTime(playerId, duration) {
  try {
    await ensurePlayerStatRow(playerId);

    logger.debug("🔍 addToPlayerMatchTime input", {
      playerId,
      duration,
      type: typeof duration,
      isNaN: isNaN(duration),
    });

    if (typeof duration !== "number" || isNaN(duration)) {
      throw new Error("Invalid duration passed to addToPlayerMatchTime");
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE player_statistics 
         SET total_match_time = COALESCE(total_match_time, 0) + ? 
         WHERE id = ?`,
        [duration, playerId],
        (err) => {
          if (err) {
            logger.errorWrapper("addToPlayerMatchTime", err, {
              playerId,
              duration,
            });
            return reject(err);
          }
          resolve();
        }
      );
    });
  } catch (err) {
    logger.warn("addToPlayerMatchTime failed", {
      playerId,
      duration,
      error: err.stack || err.message,
    });
  }
}

async function getMvpStatsForPlayer(playerId) {
  const [total, topGiver] = await Promise.all([
    new Promise((resolve, reject) =>
      db.get(
        `SELECT COUNT(*) as total FROM mvp_awards WHERE receiver_id = ?`,
        [playerId],
        (err, row) => (err ? reject(err) : resolve(row?.total || 0))
      )
    ),
    new Promise((resolve, reject) =>
      db.get(
        `SELECT giver_id, COUNT(*) as count
         FROM mvp_awards
         WHERE receiver_id = ?
         GROUP BY giver_id
         ORDER BY count DESC
         LIMIT 1`,
        [playerId],
        (err, row) => (err ? reject(err) : resolve(row))
      )
    ),
  ]);

  return {
    total,
    topGiverId: topGiver?.giver_id || null,
    topGiverCount: topGiver?.count || 0,
  };
}

module.exports = {
  getMvpStatsForPlayer,
  // ...other exports
};

function clearAllStatistics() {
  return new Promise(async (resolve, reject) => {
    try {
      await new Promise((res, rej) => {
        db.run(`DELETE FROM player_statistics`, (err) => {
          if (err) {
            logger.errorWrapper("clearAllStatistics_player", err);
            return rej(err);
          }
          logger.info("✅ Cleared all player statistics.");
          res();
        });
      });

      await new Promise((res, rej) => {
        db.run(`DELETE FROM duo_partner_counts`, (err) => {
          if (err) {
            logger.errorWrapper("clearAllStatistics_duo", err);
            return rej(err);
          }
          logger.info("✅ Cleared all duo partner statistics.");
          res();
        });
      });

      resolve();
    } catch (err) {
      logger.errorWrapper("clearAllStatistics_outer", err);
      reject(err);
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
              logger.errorWrapper("clearPlayerStatistics_main", err, {
                playerId,
              });
              return rej(err);
            }
            logger.info(`✅ Cleared statistics for player ${playerId}`);
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
              logger.errorWrapper("clearPlayerStatistics_duo", err, {
                playerId,
              });
              return rej(err);
            }
            logger.info(`✅ Cleared duo partner stats for player ${playerId}`);
            res();
          }
        );
      });

      resolve();
    } catch (err) {
      logger.errorWrapper("clearPlayerStatistics_outer", err, { playerId });
      reject(err);
    }
  });
}

async function trackFailedReadyCheck(playerId) {
  try {
    await db.runAsync(
      `INSERT INTO player_statistics (id, failed_ready_checks)
       VALUES (?, 1)
       ON CONFLICT(id) DO UPDATE SET failed_ready_checks = failed_ready_checks + 1`,
      [playerId]
    );

    // Check and unlock achievement if applicable
    const row = await db.getAsync(
      `SELECT failed_ready_checks FROM player_statistics WHERE id = ?`,
      [playerId]
    );

    if (row?.failed_ready_checks === 1) {
      await unlockAchievementIfNotEarned(playerId, "readycheck_fail_1");
    }
  } catch (err) {
    logger.errorWrapper("trackFailedReadyCheck", err, { playerId });
  }
}

async function trackLongestMatchTime(playerId, matchTime) {
  try {
    const current = await new Promise((resolve, reject) => {
      db.get(
        `SELECT longest_match_time FROM player_statistics WHERE id = ?`,
        [playerId],
        (err, row) => {
          if (err) {
            logger.errorWrapper("trackLongestMatchTime_fetch", err, {
              playerId,
            });
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
              logger.errorWrapper("trackLongestMatchTime_update", err, {
                playerId,
                matchTime,
              });
              return reject(err);
            }
            resolve();
          }
        );
      });

      // 🎯 Only trigger achievement check when it's a new longest
      await unlockMatchDurationAchievementThreshold(playerId, matchTime, db);
    }
  } catch (err) {
    logger.errorWrapper("trackLongestMatchTime_outer", err, {
      playerId,
      matchTime,
    });
  }
}

async function incrementMatchesPlayed(playerId) {
  try {
    await db.runAsync(
      `UPDATE player_statistics SET matches_played = matches_played + 1 WHERE id = ?`,
      [playerId]
    );

    // 🏆 Achievement unlocks for matches played
    await unlockStatThresholdAchievements(
      playerId,
      "matches_played",
      matchesPlayedAchievements
    );

    logger.info(`📈 Incremented matches played for ${playerId}`);
  } catch (err) {
    logger.errorWrapper("IncrementMatchesPlayed", err, { playerId });
  }
}

function trackQueueLeaveTimestamp(playerId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE player_statistics SET queue_left_at = ? WHERE id = ?`,
      [Date.now(), playerId],
      (err) => {
        if (err) {
          logger.errorWrapper("trackQueueLeaveTimestamp", err, { playerId });
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
          logger.errorWrapper("trackQueueEnteredTimestamp", err, { playerId });
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
          logger.errorWrapper("addToTotalMatchTime", err, { duration });
          return reject(err);
        }
        resolve();
      }
    );
  });
}

function trackDuoPartnerCount(playerId, partnerId) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO duo_partner_counts (player_id, partner_id, pair_count)
       VALUES (?, ?, 1)
       ON CONFLICT(player_id, partner_id) DO UPDATE SET pair_count = pair_count + 1`,
      [playerId, partnerId],
      (err) => {
        if (err) {
          logger.errorWrapper("trackDuoPartnerCount", err, {
            playerId,
            partnerId,
          });
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
      `SELECT total_match_time, matches_played FROM player_statistics WHERE id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          logger.errorWrapper("fetchAverageMatchTimeForPlayer", err, {
            playerId,
          });
          return reject(err);
        }
        if (!row || row.matches_played === 0) return resolve(0);
        resolve(row.total_match_time / row.matches_played);
      }
    );
  });
}

/**
 * Increments match completion points for a player.
 * If `overridePoints` is provided, it bypasses duration thresholds and awards that exact amount.
 */
async function incrementMatchesCompleted(playerId) {
  try {
    await db.runAsync(
      `UPDATE player_statistics SET matches_completed = matches_completed + 1 WHERE id = ?`,
      [playerId]
    );
  } catch (err) {
    logger.errorWrapper("incrementMatchesCompletedCount", err, { playerId });
  }
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
  getTopPlatformForPlayer,
  updateDuoPartnerStatistics,
  incrementMatchesCompleted,
  ensurePlayerStatRow,
  getMvpStatsForPlayer,
  updateTrioPartnerStatistics,
  incrementPlatformUsage,
};
