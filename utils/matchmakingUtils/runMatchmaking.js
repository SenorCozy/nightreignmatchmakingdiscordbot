const { handleOrphanedDuos } = require("../duoUtils");
const { startMatch } = require("./startMatch");
const {
  isPlayerInServer,
  prioritizePlatformsByQueueTime,
} = require("../playerUtils");

let isMatchmakingRunning = false;
let lastThreadLimitWarning = 0; // ⏱️ Track last thread limit log time

async function runMatchmaking(client, db) {
  console.log("⏳ Starting matchmaking run...");

  if (isMatchmakingRunning) {
    console.warn("🚨 Matchmaking is already running. Skipping duplicate.");
    return;
  }

  isMatchmakingRunning = true;

  try {
    if (!client?.isReady?.()) {
      console.warn("❌ Client not ready or undefined.");
      return;
    }

    const guild = client.guilds.cache.first();
    if (!guild) {
      console.warn("❌ No guilds available.");
      return;
    }

    // 🔍 Fetch full list of channels to ensure up-to-date count and make sure not at 1000 thread limit
    const fetchedChannels = await guild.channels.fetch();
    const activeThreads = fetchedChannels.filter((c) => c.isThread()).size;
    console.log(`🔍 Active thread #: ${activeThreads}`);

    if (activeThreads >= 1000) {
      const now = Date.now();
      if (now - lastThreadLimitWarning > 60000) {
        console.warn(
          "🚨 Thread limit reached (1000). Skipping matchmaking run."
        );
        lastThreadLimitWarning = now;
      } else {
        console.debug("⏳ Thread limit still reached. Suppressing repeat log.");
      }
      return;
    }

    const matchmakingPaused = await new Promise((resolve, reject) => {
      db.get(
        `SELECT value FROM settings WHERE key = 'matchmaking_paused'`,
        [],
        (err, row) =>
          err ? reject(err) : resolve(row ? parseInt(row.value) === 1 : false)
      );
    });

    if (matchmakingPaused) {
      console.info("🚫 Matchmaking is paused.");
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
      console.info("🚫 No players in queue.");
      return;
    }

    const prioritizedPlatforms = await prioritizePlatformsByQueueTime();

    for (const platform of prioritizedPlatforms) {
      const queuedPlayers = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id, duoPartner FROM players 
           WHERE platform = ? AND status = 'queued' 
           ORDER BY queue_entered_at ASC`,
          [platform],
          (err, rows) => (err ? reject(err) : resolve(rows))
        );
      });

      if (!queuedPlayers.length) continue;

      for (const p of queuedPlayers) {
        await handleOrphanedDuos(p.id);
      }

      const solos = [];
      const duos = new Map();

      for (const player of queuedPlayers) {
        const isMember = await isPlayerInServer(player.id, client);
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
            `SELECT threadId FROM match_players 
             WHERE playerId IN (?, ?, ?) 
             LIMIT 1`,
            [match[0], match[1], match[2]],
            (err, row) => (err ? reject(err) : resolve(row?.threadId))
          );
        });

        if (existingMatch) {
          console.warn(`⚠️ Duplicate match prevented: ${match.join(", ")}`);
          continue;
        }

        const placeholders = match.map(() => "?").join(", ");
        const updatedCount = await new Promise((resolve, reject) => {
          db.run(
            `UPDATE players SET status = 'active' 
     WHERE id IN (${placeholders}) AND status = 'queued'`,
            match,
            function (err) {
              if (err) return reject(err);
              resolve(this.changes); // Number of rows affected
            }
          );
        });

        // ⚠️ If not all players were atomically marked active, skip match
        if (updatedCount < match.length) {
          console.warn(
            `❌ Skipping match due to stale player state: ${match.join(", ")}`
          );
          // Optionally: reset any already changed back to queued
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE players SET status = 'queued' 
       WHERE id IN (${placeholders})`,
              match,
              (err) => (err ? reject(err) : resolve())
            );
          });
          continue;
        }

        try {
          await startMatch(client, platform, match);
          console.log(`✅ Match created on ${platform}: ${match.join(", ")}`);
        } catch (error) {
          console.log(`❌ Failed to start match: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.error("❌ Error in runMatchmaking:", {
      message: error.message,
      stack: error.stack,
    });
  } finally {
    isMatchmakingRunning = false;
    console.log("🏁 Matchmaking run completed");
  }
}

module.exports = { runMatchmaking };
