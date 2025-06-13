// utils/playerUtils.js
const db = require("../database");
const logger = require("../logger");
const {
  addToPlayerMatchTime,
  trackLongestMatchTime,
  addToTotalMatchTime,
} = require("../utils/playerstatshelper");
const { clearMentionStrikes } = require("../utils/mentionStrikeManager");
const { updateGlobalLongestMatch } = require("./botstatshelper");
const { awardMatchCompletionPoints } = require("./rewardUtils");
const {
  isReadyCheckActive,
  getReadyPlayers,
} = require("../utils/readyCheckState");

async function getVoiceId(threadId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
      [threadId],
      (err, row) => (err ? reject(err) : resolve(row?.voiceChannelId || null))
    );
  });
}

async function getDiscordThread(threadId) {
  const client = global.client;
  if (!client) {
    logger.warn("⚠️ global.client is not set");
    return null;
  }

  const guild = client.guilds.cache.first();
  if (!guild) {
    logger.warn("⚠️ No guild found in global.client");
    return null;
  }

  let thread = guild.channels.cache.get(threadId);

  if (!thread) {
    logger.debug(`🔍 Thread ${threadId} not found in cache, trying fetch...`);
    try {
      thread = await guild.channels.fetch(threadId);
      logger.debug(`✅ Successfully fetched thread ${threadId}`);
    } catch (err) {
      logger.warn("⚠️ Failed to fetch thread from Discord", {
        threadId,
        error: err.message,
      });
      return null;
    }
  }

  return thread;
}

async function removePlayerFromMatch(
  playerId,
  threadId,
  finalStatus = "removed"
) {
  let matchId;

  try {
    logger.info(`🚨 Beginning removal for ${playerId} from thread ${threadId}`);

    const thread = await getDiscordThread(threadId); // ✅ Move this to top

    // 🔍 Match metadata
    const matchRow = await db.getAsync(
      `SELECT match_id, match_start_time FROM matches WHERE thread_id = ?`,
      [threadId]
    );

    matchId = matchRow?.match_id;
    const matchStartTime = matchRow?.match_start_time;

    if (!matchId) {
      // Fallback to channels table for match_id
      const fallbackRow = await db.getAsync(
        `SELECT match_id FROM channels WHERE threadId = ?`,
        [threadId]
      );

      if (fallbackRow?.match_id) {
        matchId = fallbackRow.match_id;
        logger.warn("⚠️ match_id recovered from channels fallback", {
          threadId,
          matchId,
        });
      } else {
        throw new Error(`Missing match_id for thread ${threadId}`);
      }
    }

    if (!matchStartTime) {
      logger.warn(
        "⚠️ match_start_time missing — duration-based stats skipped",
        {
          threadId,
          matchId,
        }
      );
    }

    // 🧹 Cleanup ready check
    if (isReadyCheckActive(threadId)) {
      const readyPlayers = getReadyPlayers(threadId);
      readyPlayers.delete(playerId);
      logger.info(`🗑️ Removed ${playerId} from active ready check`);
    }

    // 🔄 Remove player from channels.playerIds
    const channelRow = await db.getAsync(
      `SELECT playerIds FROM channels WHERE threadId = ?`,
      [threadId]
    );

    const updatedPlayerIds =
      channelRow?.playerIds
        ?.split(",")
        .filter((id) => id !== playerId)
        .join(",") || "";

    await db.runAsync(`UPDATE channels SET playerIds = ? WHERE threadId = ?`, [
      updatedPlayerIds,
      threadId,
    ]);

    // 🔄 Set player status to inactive
    await db.runAsync(
      `UPDATE players SET status = 'inactive', platform = 'unknown', duoPartner = NULL, queue_entered_at = NULL WHERE id = ?`,
      [playerId]
    );

    // ✅ Only update match_players if currently active
    const statusRow = await db.getAsync(
      `SELECT status FROM match_players WHERE match_id = ? AND playerId = ?`,
      [matchId, playerId]
    );

    if (statusRow?.status === "active") {
      await db.runAsync(
        `UPDATE match_players SET status = ? WHERE match_id = ? AND playerId = ?`,
        [finalStatus, matchId, playerId]
      );

      if (matchStartTime) {
        const duration = Math.floor((Date.now() - matchStartTime) / 1000);
        await addToPlayerMatchTime(playerId, duration);
        await trackLongestMatchTime(playerId, duration);
        await addToTotalMatchTime(duration);
        await updateGlobalLongestMatch(duration);

        // 🏅 Early completion point (30+ minutes)
        await awardMatchCompletionPoints(
          matchId,
          matchStartTime,
          false,
          playerId,
          thread?.guild
        );
      }
    }

    // 📝 Log event
    await db.runAsync(
      `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        matchId,
        threadId,
        playerId,
        finalStatus,
        Date.now(),
        "removePlayerFromMatch",
        finalStatus,
      ]
    );

    clearMentionStrikes(playerId, { threadId });

    // 🎯 Remove from thread + VC
    if (thread?.isThread() && !thread.archived) {
      try {
        const member = await thread.members.fetch(playerId).catch(() => null);
        if (member) {
          await thread.members.remove(playerId);
          logger.info(`🚪 Removed ${playerId} from thread ${threadId}`);
        }

        const voiceChannelId = await db
          .getAsync(`SELECT voiceChannelId FROM channels WHERE threadId = ?`, [
            threadId,
          ])
          .then((row) => row?.voiceChannelId);

        const vc = thread.guild.channels.cache.get(voiceChannelId);
        if (vc) {
          await vc.permissionOverwrites
            .edit(playerId, {
              ViewChannel: false,
              Connect: false,
              Speak: false,
            })
            .catch((err) =>
              logger.warn("⚠️ VC permission overwrite failed", {
                playerId,
                voiceChannelId,
                error: err.message,
              })
            );

          const vcMember = vc.members.get(playerId);
          if (vcMember?.voice?.disconnect) {
            await vcMember.voice.disconnect().catch((err) =>
              logger.warn("⚠️ VC disconnect failed", {
                playerId,
                voiceChannelId,
                error: err.message,
              })
            );
          }
        }
      } catch (err) {
        logger.warn("⚠️ Failed to remove from thread or VC", {
          threadId,
          playerId,
          error: err.message,
        });
      }
    }

    logger.info(
      `✅ Removed ${playerId} from match ${matchId} as ${finalStatus}`
    );
  } catch (err) {
    logger.errorWrapper("removePlayerFromMatch", err, { playerId, threadId });
    throw err;
  } finally {
    if (matchId) {
      await db.runAsync(
        `UPDATE match_players SET leave_in_progress = 0 WHERE match_id = ? AND playerId = ?`,
        [matchId, playerId]
      );
    }
  }
}

async function getPlayerById(playerId, fields = "*") {
  try {
    if (fields !== "*" && typeof fields !== "string") {
      throw new Error("Invalid field selection for getPlayerById");
    }

    return await new Promise((resolve, reject) => {
      db.get(
        `SELECT ${fields} FROM players WHERE id = ?`,
        [playerId],
        (err, row) => {
          if (err) {
            logger.errorWrapper("getPlayerById", err, { playerId, fields });
            return reject(err);
          }

          if (!row) {
            logger.debug(`ℹ️ No player found with ID ${playerId}`);
            return resolve(null);
          }

          resolve(row);
        }
      );
    });
  } catch (err) {
    logger.errorWrapper("getPlayerById_outer", err, { playerId });
    throw new Error("Failed to fetch player data from the database.");
  }
}

async function getQueuePosition(playerId, platform) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, queue_entered_at FROM players WHERE platform = ? AND status = 'queued' ORDER BY queue_entered_at`,
      [platform],
      (err, queue) => {
        if (err) {
          logger.errorWrapper("getQueuePosition", err, { platform });
          return reject(err);
        }

        if (!queue || queue.length === 0) return resolve(1);

        const normalizedPlayerId = String(playerId);
        const playerIndex = queue.findIndex(
          (player) => String(player.id) === normalizedPlayerId
        );

        return resolve(playerIndex === -1 ? 1 : playerIndex + 1);
      }
    );
  });
}

async function calculateAverageQueueTime(platform, queueType = "solo") {
  const soloClause =
    "duoPartner IS NULL AND trioPartner1 IS NULL AND trioPartner2 IS NULL";
  const duoClause = "duoPartner IS NOT NULL";
  const whereClause = queueType === "solo" ? soloClause : duoClause;

  return new Promise((resolve, reject) => {
    db.all(
      `SELECT (queue_left_at - queue_entered_at) AS wait_time
       FROM queue_history
       WHERE platform = ?
         AND queue_entered_at IS NOT NULL
         AND queue_left_at IS NOT NULL
         AND ${whereClause}
         AND (queue_left_at - queue_entered_at) > 60000
         AND (queue_left_at - queue_entered_at) < 1800000
       ORDER BY queue_left_at DESC
       LIMIT 20`,
      [platform],
      (err, rows) => {
        if (err) return reject(err);
        if (!rows.length) return resolve(0);

        const totalTime = rows.reduce((sum, row) => sum + row.wait_time, 0);
        resolve(totalTime / rows.length);
      }
    );
  });
}

async function isPlayerInServer(playerId, client) {
  try {
    if (!client?.guilds?.cache) {
      logger.warn("isPlayerInServer: Client or guilds cache unavailable", {
        playerId,
      });
      return false;
    }

    const guild = client.guilds.cache.first();
    if (!guild) {
      logger.warn("isPlayerInServer: No guilds available", { playerId });
      return false;
    }

    await guild.members.fetch();
    return guild.members.cache.has(playerId);
  } catch (err) {
    logger.errorWrapper("isPlayerInServer", err, {
      playerId,
      clientStatus: {
        isReady: client?.isReady?.(),
        guilds: client?.guilds?.cache?.size,
      },
    });
    return false;
  }
}

async function prioritizePlatformsByQueueTime() {
  const platforms = ["pc", "xbox", "playstation"];
  const platformWaitTimes = {};

  for (const platform of platforms) {
    try {
      const avg = await calculateAverageQueueTime(platform, "solo");
      platformWaitTimes[platform] = avg;
    } catch (err) {
      logger.errorWrapper("prioritizePlatformsByQueueTime", err, { platform });
      platformWaitTimes[platform] = 0;
    }
  }

  // Sort platforms with highest average wait time first
  platforms.sort((a, b) => platformWaitTimes[b] - platformWaitTimes[a]);

  logger.info("📊 Platform wait times (ms):", platformWaitTimes);
  return platforms;
}

/**
 * Ensures the user has the required role. If not, attempts to add it.
 * Prevents further action if assignment fails.
 *
 * @param {GuildMember} member - The Discord guild member
 * @param {CommandInteraction|ButtonInteraction} interaction - The interaction object
 * @param {string} roleId - The required role ID
 * @returns {Promise<boolean>} Whether the role is present or successfully added
 */
async function ensureRequiredRole(member, interaction, roleId) {
  if (member.roles.cache.has(roleId)) return true;

  try {
    await member.roles.add(roleId);
    logger.info("🔐 Assigned required role for queue access", {
      playerId: member.id,
      roleId,
    });
    return true;
  } catch (err) {
    logger.errorWrapper("❌ Failed to assign required queue role", err, {
      playerId: member.id,
      roleId,
    });

    // Avoid double replies
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content:
            "❌ I couldn’t assign the required matchmaking role. Please contact a moderator.",
          flags: 64,
        })
        .catch(() => {});
    }

    return false;
  }
}

module.exports = {
  removePlayerFromMatch,
  calculateAverageQueueTime,
  getQueuePosition,
  getPlayerById,
  isPlayerInServer,
  prioritizePlatformsByQueueTime,
  ensureRequiredRole,
};
