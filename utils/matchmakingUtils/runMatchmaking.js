const { handleOrphanedDuos } = require("../duoUtils");
const { handleOrphanedTrios } = require("../trioUtils");
const { startMatch } = require("./startMatch");
const {
  isPlayerInServer,
  prioritizePlatformsByQueueTime,
} = require("../playerUtils");
const logger = require("../../logger");

let isMatchmakingRunning = false;
let lastThreadLimitWarning = 0;

async function runMatchmaking(client, db) {
  logger.info("⏳ Starting matchmaking run...");

  if (isMatchmakingRunning) {
    logger.warn("🚨 Matchmaking already running. Skipping duplicate.");
    return;
  }

  isMatchmakingRunning = true;

  try {
    if (!client?.isReady?.()) {
      logger.warn("❌ Client not ready.");
      return;
    }

    const guild = client.guilds.cache.first();
    if (!guild) {
      logger.warn("❌ No guild found.");
      return;
    }

    const activeThreads = await guild.channels.fetchActiveThreads();
    const activeThreadCount = activeThreads?.threads?.size || 0;
    logger.info(`🔍 Active thread count: ${activeThreadCount}`);

    if (activeThreadCount >= 1000) {
      const now = Date.now();
      if (now - lastThreadLimitWarning > 60000) {
        logger.warn("🚨 Thread limit reached. Skipping matchmaking run.");
        lastThreadLimitWarning = now;
      }
      return;
    }

    const matchmakingPaused = await db
      .getAsync(`SELECT value FROM settings WHERE key = 'matchmaking_paused'`)
      .then((row) => row?.value === "1");

    if (matchmakingPaused) {
      logger.info("🚫 Matchmaking is paused.");
      return;
    }

    const totalQueuedPlayers = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) AS count FROM players WHERE status = 'queued'`,
        [],
        (err, row) => (err ? reject(err) : resolve(row?.count || 0))
      );
    });

    if (totalQueuedPlayers === 0) {
      logger.info("🚫 No players in queue.");
      return;
    }

    const prioritizedPlatforms = await prioritizePlatformsByQueueTime();

    for (const platform of prioritizedPlatforms) {
      const queuedPlayers = await db.allAsync(
        `SELECT id, duoPartner FROM players 
         WHERE platform = ? AND status = 'queued' 
         ORDER BY queue_entered_at ASC`,
        [platform]
      );

      if (!queuedPlayers.length) continue;

      const matchedPlayerIds = new Set();
      const solos = [];
      const duos = new Map();

      // Filter out users not in server + prep solo/duo lists
      for (const player of queuedPlayers) {
        const isMember = await isPlayerInServer(player.id, client);
        if (!isMember) continue;

        if (player.duoPartner) {
          duos.set(player.id, player.duoPartner);
        } else {
          solos.push(player.id);
        }
      }

      // 🧠 Match full trio groups first
      const activeTrios = await db.allAsync(
        `SELECT * FROM trio_partner_groups WHERE active = 1`
      );

      for (const trio of activeTrios) {
        const trioIds = [trio.player1_id, trio.player2_id, trio.player3_id];

        // Skip if any have already been matched
        if (trioIds.some((id) => matchedPlayerIds.has(id))) continue;

        const stillQueued = await db.allAsync(
          `SELECT id FROM players 
           WHERE status = 'queued' AND id IN (?, ?, ?)`,
          trioIds
        );

        if (stillQueued.length === 3) {
          trioIds.forEach((id) => matchedPlayerIds.add(id));
          for (const id of trioIds) {
            const index = solos.indexOf(id);
            if (index !== -1) solos.splice(index, 1);
          }

          trioIds.forEach((id) => duos.delete(id));

          try {
            await startMatch(client, platform, trioIds, "trio");
            logger.info("✅ Matched trio", { platform, players: trioIds });
            await db.runAsync(
              `UPDATE trio_partner_groups SET active = 0 WHERE trio_id = ?`,
              [trio.trio_id]
            );
          } catch (error) {
            logger.errorWrapper("❌ Failed to start trio match", error, {
              players: trioIds,
              trio_id: trio.trio_id,
            });
          }
        }
      }

      // 👤 Handle orphaned duos/trios for unmatched players
      for (const player of queuedPlayers) {
        if (!matchedPlayerIds.has(player.id)) {
          await handleOrphanedDuos(player.id, guild);
          await handleOrphanedTrios(player.id, guild);
        }
      }

      // 🧩 Match solo+duo or 3 solos
      while (solos.length >= 1 || duos.size > 0) {
        let match = [];
        let formationType = "unknown";

        if (duos.size > 0 && solos.length > 0) {
          const [duoId, partnerId] = duos.entries().next().value;
          const soloId = solos.shift();

          if (
            matchedPlayerIds.has(duoId) ||
            matchedPlayerIds.has(partnerId) ||
            matchedPlayerIds.has(soloId)
          ) {
            duos.delete(duoId);
            continue;
          }

          match = [soloId, duoId, partnerId];
          formationType = "duo+solo";
          duos.delete(duoId);
        } else if (solos.length >= 3) {
          match = solos.splice(0, 3);
          if (match.some((id) => matchedPlayerIds.has(id))) continue;
          formationType = "3 solos";
        } else {
          break;
        }

        if (!match.length) continue;

        const existing = await db.getAsync(
          `SELECT threadId FROM match_players WHERE playerId IN (${match
            .map(() => "?")
            .join(",")}) LIMIT 1`,
          match
        );
        if (existing) continue;

        const stillQueued = await db.allAsync(
          `SELECT id FROM players WHERE id IN (${match
            .map(() => "?")
            .join(",")}) AND status = 'queued'`,
          match
        );

        if (stillQueued.length !== match.length) continue;

        const updated = await db.runAsync(
          `UPDATE players SET status = 'active' WHERE id IN (${match
            .map(() => "?")
            .join(",")}) AND status = 'queued'`,
          match
        );

        try {
          await startMatch(client, platform, match, formationType);
          match.forEach((id) => matchedPlayerIds.add(id));
          logger.info(`✅ Match created on ${platform}`, {
            match,
            formationType,
          });
        } catch (err) {
          logger.errorWrapper("❌ Failed to start match", err, {
            match,
            formationType,
          });
        }
      }
    }
  } catch (error) {
    logger.errorWrapper("❌ Error in runMatchmaking", error);
  } finally {
    isMatchmakingRunning = false;
    logger.info("🏁 Matchmaking run completed");
  }
}

module.exports = { runMatchmaking };
