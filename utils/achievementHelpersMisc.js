function repeatPartnerAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    goal_type: "repeat_partner",
    threshold,
  };
}

function eventCompletionAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    threshold,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM event_progress WHERE player_id = ? AND completed = 1`,
        [playerId]
      );
      return row?.count >= threshold;
    },
  };
}

function uniquePartnersAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(DISTINCT partner_id) AS count FROM player_partners WHERE player_id = ?`,
        [playerId]
      );
      return row?.count >= threshold;
    },
  };
}

function mvpGivenAchievement({ id, name, description, reward, threshold = 1 }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM mvp_awards WHERE giver_id = ?`,
        [playerId]
      );
      return (row?.count || 0) >= threshold;
    },
  };
}

function mvpReceivedAchievement({
  id,
  name,
  description,
  reward,
  threshold = 1,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM mvp_awards WHERE receiver_id = ?`,
        [playerId]
      );
      return (row?.count || 0) >= threshold;
    },
  };
}

function matchCompletionPointAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT SUM(points) AS total FROM match_completion_awards WHERE player_id = ?`,
        [playerId]
      );
      return row?.total >= threshold;
    },
  };
}

function matchCompletionStreakAchievement({
  id,
  name,
  description,
  reward,
  statKey,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    goal_type: "matches_completed_streak_24h",
    statKey,
    threshold,
  };
}

function dailyMatchStreakAchievement({ id, name, description, reward, days }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const results = await db.allAsync(
        `SELECT DISTINCT DATE(timestamp / 1000.0, 'unixepoch', 'localtime') AS play_date
             FROM match_completion_awards
             WHERE player_id = ?
             ORDER BY play_date DESC
             LIMIT ?`,
        [playerId, days]
      );

      const today = new Date();
      for (let i = 0; i < days; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() - i);
        const iso = checkDate.toISOString().slice(0, 10);

        if (!results.some((r) => r.play_date === iso)) {
          return false;
        }
      }

      return true;
    },
  };
}

function matchDurationAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT longest_match_time FROM player_statistics WHERE id = ?`,
        [playerId]
      );
      return row?.longest_match_time >= threshold;
    },
  };
}

function achievementCountAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM player_achievements WHERE player_id = ?`,
        [playerId]
      );
      return row?.count >= threshold;
    },
  };
}

function currencyThresholdAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT balance FROM player_currency WHERE player_id = ?`,
        [playerId]
      );
      return (row?.balance || 0) >= threshold;
    },
  };
}

module.exports = {
  uniquePartnersAchievement,
  repeatPartnerAchievement,
  mvpGivenAchievement,
  mvpReceivedAchievement,
  eventCompletionAchievement,
  matchCompletionPointAchievement,
  matchCompletionStreakAchievement,
  dailyMatchStreakAchievement,
  matchDurationAchievement,
  achievementCountAchievement,
  currencyThresholdAchievement,
};
