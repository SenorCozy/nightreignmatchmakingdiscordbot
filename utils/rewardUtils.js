const db = require("../database");
const logger = require("../logger");
const {
  unlockAchievementIfNotEarned,
  checkMatchCompletionPointAchievements,
} = require("./achievementHelpers");

async function awardMatchCompletionPoints(
  match_id,
  matchStart,
  isFinal = false,
  playerIdOverride = null,
  guild = null
) {
  try {
    const now = Date.now();
    const matchDurationMs = matchStart ? now - matchStart : 0;
    const matchDurationMin = Math.floor(matchDurationMs / (1000 * 60));

    let points = 0;

    if (matchDurationMin < 30) {
      logger.info(
        `⏱️ Match ${match_id} too short (${matchDurationMin}m), no completion points awarded.`
      );
      return;
    }

    if (isFinal) {
      if (matchDurationMin >= 180) points = 4;
      else if (matchDurationMin >= 90) points = 2;
      else points = 1;
    } else {
      points = 1; // Partial match but 30+ minutes
    }

    const playerIds = playerIdOverride
      ? [playerIdOverride]
      : await new Promise((res, rej) =>
          db.all(
            `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
            [match_id],
            (err, rows) => (err ? rej(err) : res(rows.map((r) => r.playerId)))
          )
        );

    for (const playerId of playerIds) {
      await db.runAsync(
        `INSERT OR IGNORE INTO match_completion_awards (match_id, player_id, awarded_at, points)
           VALUES (?, ?, ?, ?)`,
        [match_id, playerId, now, points]
      );

      await checkMatchCompletionPointAchievements(playerId, db);

      if (guild) {
        const member = await guild.members.fetch(playerId).catch(() => null);
        if (member) {
          await updateMatchCompletionRoles(member, guild);
        }
      }
    }

    logger.info(
      `🏅 Awarded +${points} point(s) to ${playerIds.length} player(s) for match ${match_id} (${matchDurationMin}m)`
    );
  } catch (err) {
    logger.errorWrapper("awardMatchCompletionPoints", err);
  }
}

async function getMatchCompletionPoints(playerId) {
  try {
    const row = await db.getAsync(
      `SELECT SUM(points) as total FROM match_completion_awards WHERE player_id = ?`,
      [playerId]
    );
    return row?.total || 0;
  } catch (error) {
    logger.error("❌ Failed to get match completion points", {
      playerId,
      error,
    });
    return 0; // Fallback to 0 if something goes wrong
  }
}

async function updateMatchCompletionRoles(member, guild) {
  try {
    const totalPoints = await getMatchCompletionPoints(member.id);
    const alertChannelId = process.env.QUEUE_ALERT_CHANNEL;
    const alertChannel = guild.channels.cache.get(alertChannelId);

    const roleThresholds = [
      {
        roleId: process.env.MATCH_TIER_1_ROLE_ID,
        points: 100,
        name: "Tier I Veteran",
      },
      {
        roleId: process.env.MATCH_TIER_2_ROLE_ID,
        points: 250,
        name: "Tier II Veteran",
      },
      {
        roleId: process.env.MATCH_TIER_3_ROLE_ID,
        points: 500,
        name: "Tier III Veteran",
      },
      {
        roleId: process.env.MATCH_TIER_4_ROLE_ID,
        points: 1000,
        name: "Tier IV Legend",
      },
    ];

    for (const { roleId, points, name } of roleThresholds) {
      try {
        if (!roleId) continue;

        const hasRole = member.roles.cache.has(roleId);
        if (totalPoints >= points && !hasRole) {
          await member.roles.add(roleId);

          logger.info(
            `🎖️ ${member.user.tag} earned new role: ${name} (${roleId}) at ${totalPoints} points`
          );

          if (alertChannel?.send) {
            alertChannel.send(
              `🎉 <@${member.id}> has earned **${name}** for reaching ${totalPoints} match completion points!`
            );
          }
        }
      } catch (roleError) {
        logger.error("❌ Failed to assign role during match completion check", {
          memberId: member.id,
          roleId,
          roleName: name,
          totalPoints,
          error: roleError,
        });
      }
    }
  } catch (err) {
    logger.error("❌ Unexpected error in updateMatchCompletionRoles", {
      memberId: member?.id,
      error: err,
    });
  }
}

module.exports = {
  awardMatchCompletionPoints,
  getMatchCompletionPoints,
  updateMatchCompletionRoles,
};
