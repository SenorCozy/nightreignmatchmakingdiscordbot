const { getPlayerById } = require("./playerUtils");
const sendQueueStatusPrompt = require("./sendQueueStatusPrompt");
const db = require("../database");
const logger = require("../logger");

async function handleOrphanedTrios(playerId, guild) {
  try {
    const player = await getPlayerById(playerId);
    if (!player) return;

    // Find active trio group containing this player
    const trio = await db.getAsync(
      `SELECT * FROM trio_partner_groups 
       WHERE active = 1 AND (player1_id = ? OR player2_id = ? OR player3_id = ?)`,
      [playerId, playerId, playerId]
    );

    if (!trio) return;

    const trioIds = [trio.player1_id, trio.player2_id, trio.player3_id];
    const remaining = trioIds.filter((id) => id !== playerId);
    // Skip if trio is about to be matched (one or more already marked active)
    const trioStatusRows = await db.allAsync(
      `SELECT id, status FROM players WHERE id IN (?, ?, ?)`,
      [trio.player1_id, trio.player2_id, trio.player3_id]
    );

    const allQueued = trioStatusRows.every((row) => row.status === "queued");
    if (!allQueued) {
      logger.debug(
        "⏩ Skipping orphaned trio handling – match may be forming",
        {
          trio_id: trio.trio_id,
          statuses: trioStatusRows,
        }
      );
      return;
    }

    // Check which remaining players are still queued
    const stillQueued = await db.allAsync(
      `SELECT id FROM players 
       WHERE status = 'queued' AND id IN (?, ?)`,
      [remaining[0], remaining[1]]
    );

    const activeRemaining = stillQueued.map((r) => r.id);

    if (activeRemaining.length === 2) {
      logger.info("🎯 Trio reduced to duo", { original: trioIds });

      // Link the remaining two as duo
      await Promise.all(
        activeRemaining.map((id) => {
          const partnerId = activeRemaining.find((x) => x !== id);
          return db.runAsync(`UPDATE players SET duoPartner = ? WHERE id = ?`, [
            partnerId,
            id,
          ]);
        })
      );

      await Promise.all(
        activeRemaining.map((id) => sendQueueStatusPrompt(guild, id, "trio"))
      );
    } else if (activeRemaining.length === 1) {
      logger.info("🎯 Trio reduced to solo", { original: trioIds });

      await db.runAsync(`UPDATE players SET duoPartner = NULL WHERE id = ?`, [
        activeRemaining[0],
      ]);

      await sendQueueStatusPrompt(guild, activeRemaining[0], "trio");
    } else {
      logger.info("🧹 Entire trio left or was not found queued", {
        trio: trioIds,
      });
    }

    // Mark trio group as inactive
    await db.runAsync(
      `UPDATE trio_partner_groups SET active = 0 WHERE trio_id = ?`,
      [trio.trio_id]
    );
  } catch (error) {
    logger.errorWrapper("handleOrphanedTrios", error, { playerId });
  }
}

module.exports = { handleOrphanedTrios };
