const { getPlayerById } = require("./playerUtils");
const sendQueueStatusPrompt = require("./sendQueueStatusPrompt");
const db = require("../database");
const logger = require("../logger");

async function handleOrphanedDuos(playerId, guild) {
  try {
    const player = await getPlayerById(playerId);
    if (!player?.duoPartner) return;

    const partnerId = player.duoPartner;

    const partnerStatus = await new Promise((resolve, reject) => {
      db.get(
        `SELECT status FROM players WHERE id = ?`,
        [partnerId],
        (err, row) => {
          if (err) {
            logger.errorWrapper("handleOrphanedDuos_checkPartner", err, {
              playerId,
              partnerId,
            });
            return reject(err);
          }
          resolve(row?.status || null);
        }
      );
    });

    if (partnerStatus !== "queued") {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE players SET duoPartner = NULL WHERE id = ?`,
          [playerId],
          (err) => {
            if (err) {
              logger.errorWrapper("handleOrphanedDuos_clearLink", err, {
                playerId,
              });
              return reject(err);
            }
            resolve();
          }
        );
      });

      logger.info("🧹 Orphaned duo partner removed", {
        playerId,
        orphanedPartnerId: partnerId,
      });

      // 📨 Notify the remaining partner
      await sendQueueStatusPrompt(guild, partnerId, "duo");
    } else {
      logger.debug("✅ Duo partner still queued — no action needed", {
        playerId,
        partnerId,
      });
    }
  } catch (err) {
    logger.errorWrapper("handleOrphanedDuos_outer", err, { playerId });
  }
}

module.exports = { handleOrphanedDuos };
