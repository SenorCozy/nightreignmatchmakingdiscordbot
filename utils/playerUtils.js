// utils/playerUtils.js
const db = require("../database");
const {
  addToPlayerMatchTime,
  trackLongestMatchTime,
} = require("../utils/playerstatshelper");

async function removePlayerFromMatch(
  playerId,
  threadId,
  finalStatus = "removed"
) {
  try {
    // Step 1: Get match_id and created_at
    const matchRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT match_id, created_at FROM matches WHERE thread_id = ?`,
        [threadId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    const matchId = matchRow?.match_id;
    const createdAt = matchRow?.created_at;
    if (!matchId) throw new Error("Match ID not found");

    const matchDuration = createdAt
      ? Date.now() - new Date(createdAt).getTime()
      : null;

    // Step 2: Update channels.playerIds
    const channelRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT playerIds FROM channels WHERE threadId = ?`,
        [threadId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    const updatedPlayerIds =
      channelRow?.playerIds
        ?.split(",")
        .filter((id) => id !== playerId)
        .join(",") || "";

    await db.runAsync(`UPDATE channels SET playerIds = ? WHERE threadId = ?`, [
      updatedPlayerIds,
      threadId,
    ]);

    // Step 3: Reset player queue status
    await db.runAsync(
      `UPDATE players 
       SET status = 'inactive', platform = 'unknown', duoPartner = NULL, queue_entered_at = NULL 
       WHERE id = ?`,
      [playerId]
    );

    // Step 4: Update match_players if still active
    const existingStatusRow = await db.getAsync(
      `SELECT status FROM match_players WHERE match_id = ? AND playerId = ?`,
      [matchId, playerId]
    );

    if (existingStatusRow?.status === "active") {
      await db.runAsync(
        `UPDATE match_players SET status = ? WHERE match_id = ? AND playerId = ?`,
        [finalStatus, matchId, playerId]
      );
    }

    // Step 5: Log match_event
    await db.runAsync(
      `INSERT INTO match_events 
       (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
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

    // Step 6: Update stats
    if (matchDuration && matchDuration > 60000) {
      await Promise.all([
        addToPlayerMatchTime(playerId, matchDuration),
        trackLongestMatchTime(playerId, matchDuration),
      ]);
    }

    console.info(
      `✅ Removed player ${playerId} from match ${matchId} as ${finalStatus}`
    );
  } catch (err) {
    console.error(
      `❌ Error in removePlayerFromMatch(${playerId}):`,
      err.message
    );
    throw err;
  }
}

async function getPlayerById(playerId, fields = "*") {
  try {
    return await new Promise((resolve, reject) => {
      db.get(
        `SELECT ${fields} FROM players WHERE id = ?`,
        [playerId],
        (err, row) => {
          if (err) {
            console.error(
              `Error fetching player ${playerId} from database:`,
              err.message
            );
            return reject(err);
          }
          resolve(row || null); // Return null if no player is found
        }
      );
    });
  } catch (error) {
    console.error(
      `Unexpected error in getPlayerById(${playerId}):`,
      error.message
    );
    throw new Error("Failed to fetch player data from the database.");
  }
}

module.exports = {
  getPlayerById,
  // include other player-related utils here
};

async function getQueuePosition(playerId, platform) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, queue_entered_at FROM players WHERE platform = ? AND status = 'queued' ORDER BY queue_entered_at`,
      [platform],
      (err, queue) => {
        if (err) {
          console.error("❌ SQL error fetching queue position:", err.message);
          return reject(err);
        }

        if (!queue || queue.length === 0) return resolve(1);

        const normalizedPlayerId = String(playerId);
        const playerIndex = queue.findIndex(
          (player) => String(player.id) === normalizedPlayerId
        );

        if (playerIndex === -1) return resolve(1);

        return resolve(playerIndex + 1);
      }
    );
  });
}

async function calculateAverageQueueTime(platform, queueType) {
  return new Promise((resolve, reject) => {
    db.all(
      `
      SELECT (queue_left_at - queue_entered_at) AS wait_time
      FROM player_statistics
      WHERE platform = ? 
      AND queue_entered_at IS NOT NULL 
      AND queue_left_at IS NOT NULL 
      AND status = 'completed'
      AND duoPartner IS ${queueType === "solo" ? "NULL" : "NOT NULL"}
      AND (queue_left_at - queue_entered_at) > 60000
      AND (queue_left_at - queue_entered_at) < 1800000
      ORDER BY queue_left_at DESC
      LIMIT 20
      `,
      [platform],
      (err, rows) => {
        if (err) {
          console.error("Error calculating average queue time:", err.message);
          return reject(err);
        }

        if (rows.length === 0) {
          return resolve(0);
        }

        const totalTime = rows.reduce((sum, row) => sum + row.wait_time, 0);
        const avgTime = totalTime / rows.length;
        resolve(avgTime);
      }
    );
  });
}

async function isPlayerInServer(playerId, client) {
  try {
    if (!client || !client.guilds?.cache) {
      console.error("❌ Client or guilds cache not available");
      return false;
    }

    const guild = client.guilds.cache.first();
    if (!guild) {
      console.warn("❌ No guilds available");
      return false;
    }

    await guild.members.fetch(); // Refresh cache
    return guild.members.cache.has(playerId);
  } catch (error) {
    console.error("❌ Error checking server membership:", {
      message: error.message,
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
      platformWaitTimes[platform] = await calculateAverageQueueTime(
        platform,
        "solo"
      );
    } catch (err) {
      console.error(
        `Error calculating wait time for ${platform}:`,
        err.message
      );
      platformWaitTimes[platform] = 0;
    }
  }

  // Sort platforms descending by wait time
  platforms.sort((a, b) => platformWaitTimes[b] - platformWaitTimes[a]);

  return platforms;
}

module.exports = {
  removePlayerFromMatch,
  calculateAverageQueueTime,
  getQueuePosition,
  getPlayerById,
  isPlayerInServer,
  prioritizePlatformsByQueueTime,
};
