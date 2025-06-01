const db = require("../database");
const logger = require("../logger");
const { evaluateEventProgress } = require("../utils/eventUtils");
const {
  unlockAchievementIfNotEarned,
  checkCurrencyAchievements,
} = require("./achievementHelpers");

// ✅ 1. Must be in same match and match must be active
async function areUsersInSameActiveMatch(giverId, receiverId) {
  try {
    return await new Promise((res, rej) => {
      db.get(
        `
        SELECT m.match_id
        FROM match_players p1
        JOIN match_players p2 ON p1.match_id = p2.match_id
        JOIN matches m ON m.match_id = p1.match_id
        WHERE p1.playerId = ? AND p2.playerId = ?
          AND p1.status = 'active'
          AND p2.status = 'active'
          AND m.closed_at IS NULL
        `,
        [giverId, receiverId],
        (err, row) => (err ? rej(err) : res(row?.match_id || null))
      );
    });
  } catch (err) {
    logger.errorWrapper("MVP_Check_SameActiveMatch", err, {
      giverId,
      receiverId,
    });
    return null;
  }
}

// ✅ 2. Match must be active for 15+ minutes
async function isMatchOldEnough(matchId) {
  try {
    const row = await db.getAsync(
      `SELECT created_at FROM matches WHERE match_id = ?`,
      [matchId]
    );
    if (!row?.created_at) return false;

    const fifteenMinutes = 15 * 60 * 1000;
    return Date.now() - row.created_at >= fifteenMinutes;
  } catch (err) {
    logger.errorWrapper("MVP_Check_MatchAge", err, { matchId });
    return false;
  }
}

// ✅ 3. Max 5 MVPs given per day
async function hasGivenTooManyToday(giverId) {
  try {
    const row = await db.getAsync(
      `SELECT COUNT(*) as count FROM mvp_awards WHERE giver_id = ? AND awarded_at > ?`,
      [giverId, Date.now() - 24 * 60 * 60 * 1000]
    );
    return row?.count >= 20;
  } catch (err) {
    logger.errorWrapper("MVP_Check_GiverLimit", err, { giverId });
    return true;
  }
}

// ✅ 4. Cooldown: can't MVP same user within 2 hours
async function hasCooldownActive(giverId, receiverId, matchId) {
  try {
    const row = await db.getAsync(
      `SELECT awarded_at FROM mvp_awards
         WHERE giver_id = ? AND receiver_id = ? AND match_id = ?
         ORDER BY awarded_at DESC LIMIT 1`,
      [giverId, receiverId, matchId]
    );
    if (!row?.awarded_at) return false;
    const cooldown = 30 * 60 * 1000;
    return Date.now() - row.awarded_at < cooldown;
  } catch (err) {
    logger.errorWrapper("MVP_Check_Cooldown", err, {
      giverId,
      receiverId,
      matchId,
    });
    return true;
  }
}

// ✅ 5. Max 10 MVPs received per day
async function hasReceivedTooManyToday(receiverId) {
  try {
    const row = await db.getAsync(
      `SELECT COUNT(*) as count FROM mvp_awards WHERE receiver_id = ? AND awarded_at > ?`,
      [receiverId, Date.now() - 24 * 60 * 60 * 1000]
    );
    return row?.count >= 10;
  } catch (err) {
    logger.errorWrapper("MVP_Check_ReceiverLimit", err, { receiverId });
    return true;
  }
}
// 6. per match limit
async function hasExceededPerMatchLimit(giverId, receiverId, matchId) {
  try {
    const row = await db.getAsync(
      `SELECT COUNT(*) as count FROM mvp_awards
         WHERE giver_id = ? AND receiver_id = ? AND match_id = ?`,
      [giverId, receiverId, matchId]
    );
    return row?.count >= 3;
  } catch (err) {
    logger.errorWrapper("MVP_Check_PerMatchLimit", err, {
      giverId,
      receiverId,
      matchId,
    });
    return true;
  }
}

async function applyMvpAward(giverId, receiverId, matchId) {
  const now = Date.now();

  try {
    await db.runAsync(
      `INSERT INTO mvp_awards (giver_id, receiver_id, match_id, awarded_at)
           VALUES (?, ?, ?, ?)`,
      [giverId, receiverId, matchId, now]
    );
  } catch (err) {
    logger.errorWrapper("MVP_Insert_Award", err, {
      giverId,
      receiverId,
      matchId,
    });
    return;
  }

  // 🏆 Check for MVP max daily achievement (10 MVPs in 24h)
  try {
    const row = await db.getAsync(
      `SELECT COUNT(*) as total FROM mvp_awards 
         WHERE receiver_id = ? AND awarded_at >= ?`,
      [receiverId, now - 24 * 60 * 60 * 1000]
    );

    if (row?.total === 10) {
      await unlockAchievementIfNotEarned(receiverId, "mvp_max_daily");
    }
  } catch (err) {
    logger.errorWrapper("MVP_MaxDailyAchievementCheck", err, { receiverId });
  }

  try {
    await db.runAsync(
      `INSERT INTO player_currency (player_id, balance)
           VALUES (?, 1)
           ON CONFLICT(player_id) DO UPDATE SET balance = balance + 1`,
      [receiverId]
    );
  } catch (err) {
    logger.errorWrapper("MVP_Update_Currency", err, { receiverId });
  }

  try {
    await db.runAsync(
      `INSERT INTO currency_audit
           (player_id, amount_changed, source, source_id, modified_by, modified_at, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        receiverId,
        1,
        "mvp",
        matchId,
        "system",
        now,
        `MVP award from ${giverId}`,
      ]
    );
  } catch (err) {
    logger.errorWrapper("MVP_Log_CurrencyAudit", err, {
      receiverId,
      matchId,
      giverId,
    });
  }

  await checkCurrencyAchievements(receiverId, db);

  try {
    await evaluateEventProgress(receiverId, "mvp_earned", 1, {
      matchId,
      awardedAt: now,
      awardedBy: giverId,
    });
  } catch (err) {
    logger.errorWrapper("MVP_Evaluate_Progress", err, {
      receiverId,
      matchId,
    });
  }

  logger.info(
    `💰 MVP awarded by ${giverId} to ${receiverId} in match ${matchId}`
  );
}

module.exports = {
  areUsersInSameActiveMatch,
  isMatchOldEnough,
  hasGivenTooManyToday,
  hasCooldownActive,
  hasReceivedTooManyToday,
  applyMvpAward,
  hasExceededPerMatchLimit,
};
