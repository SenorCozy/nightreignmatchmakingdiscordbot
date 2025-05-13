const { handleOrphanedDuos } = require("../duoUtils");
const { startMatch } = require("./startMatch");
const {
  isPlayerInServer,
  prioritizePlatformsByQueueTime,
} = require("../playerUtils");

let isMatchmakingRunning = false;

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

      const threadLimitReached =
        guild.channels.cache.filter((c) => c.isThread()).size >= 1000;
      if (threadLimitReached) {
        console.warn(
          `🚨 Cannot start new match for ${platform} – thread limit reached.`
        );
        continue;
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
