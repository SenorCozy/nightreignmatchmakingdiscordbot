// utils/matchmaking/runMatchmaking.js
const { handleOrphanedDuos } = require("../duoUtils");
const { startMatch } = require("./startMatch");
const {
  isPlayerInServer,
  prioritizePlatformsByQueueTime,
} = require("../playerUtils");
const db = require("../../database");
let isMatchmakingRunning = false;

async function runMatchmaking(client, db, logger) {
  if (isMatchmakingRunning) {
    logger.warn("🚨 Matchmaking is already running. Skipping duplicate.");
    return;
  }

  isMatchmakingRunning = true;

  try {
    const matchmakingPaused = await new Promise((resolve, reject) => {
      db.get(
        `SELECT value FROM settings WHERE key = 'matchmaking_paused'`,
        [],
        (err, row) =>
          err ? reject(err) : resolve(row ? parseInt(row.value) === 1 : false)
      );
    });

    if (matchmakingPaused) {
      logger.info("🚫 Matchmaking is paused.");
      return;
    }

    const guild = client.guilds.cache.first();
    const totalQueuedPlayers = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) AS count FROM players WHERE status = 'queued'`,
        [],
        (err, row) => (err ? reject(err) : resolve(row?.count || 0))
      );
    });

    if (totalQueuedPlayers === 0) {
      logger.info("🚫 No players in queue. Waiting...");
      return;
    }

    const prioritizedPlatforms = await prioritizePlatformsByQueueTime();

    for (const platform of prioritizedPlatforms) {
      const queuedPlayers = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id, duoPartner FROM players WHERE platform = ? AND status = 'queued' ORDER BY queue_entered_at ASC`,
          [platform],
          (err, rows) => (err ? reject(err) : resolve(rows))
        );
      });

      if (!queuedPlayers.length) continue;

      for (const p of queuedPlayers) {
        await handleOrphanedDuos(p.id);
      }

      const threadLimitReached =
        guild.channels.cache.filter((c) => c.isThread()).size >= 1000;
      if (threadLimitReached) {
        logger.warn(
          `🚨 Cannot start new match for ${platform} - thread limit reached.`
        );
        continue;
      }

      const solos = [];
      const duos = new Map();

      for (const player of queuedPlayers) {
        const isMember = await isPlayerInServer(player.id, guild);
        if (!isMember) continue;

        if (player.duoPartner) {
          duos.set(player.id, player.duoPartner);
        } else {
          solos.push(player.id);
        }
      }

      while (solos.length >= 1 || duos.size > 0) {
        let match = [];

        if (duos.size > 0 && solos.length > 0) {
          const [duoId, partnerId] = duos.entries().next().value;
          const soloId = solos.shift();
          duos.delete(duoId);
          match = [soloId, duoId, partnerId];
        } else if (solos.length >= 3) {
          match = solos.splice(0, 3);
        } else {
          break;
        }

        if (!match.length) continue;

        const existingMatch = await new Promise((resolve, reject) => {
          db.get(
            `SELECT threadId FROM channels 
             WHERE (playerIds LIKE ? OR playerIds LIKE ? OR playerIds LIKE ?) 
             AND threadId IS NOT NULL LIMIT 1`,
            [`%${match[0]}%`, `%${match[1]}%`, `%${match[2]}%`],
            (err, row) => (err ? reject(err) : resolve(row?.threadId))
          );
        });

        if (existingMatch) {
          logger.warn(`⚠️ Duplicate match prevented: ${match.join(", ")}`);
          continue;
        }

        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE players SET status = 'active' WHERE id IN (${match
              .map(() => "?")
              .join(",")})`,
            match,
            (err) => (err ? reject(err) : resolve())
          );
        });

        try {
          await startMatch(platform, match);
          logger.info(`✅ Match created on ${platform}: ${match.join(", ")}`);
        } catch (error) {
          logger.error(`❌ Failed to start match: ${error.message}`);
        }
      }
    }
  } catch (error) {
    logger.error("❌ Error in runMatchmaking:", error.message);
  } finally {
    isMatchmakingRunning = false;
  }
}

module.exports = { runMatchmaking };
