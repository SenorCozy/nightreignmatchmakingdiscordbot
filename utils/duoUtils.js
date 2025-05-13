// utils/duoUtils.js
const { getPlayerById } = require("./playerUtils");
const db = require("../database");
async function handleOrphanedDuos(playerId) {
  const player = await getPlayerById(playerId);
  if (!player || !player.duoPartner) return;

  const partnerStillQueued = await new Promise((resolve, reject) => {
    db.get(
      `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
      [player.duoPartner],
      (err, row) => {
        if (err) {
          console.error("Error checking duo partner status:", err.message);
          return reject(err);
        }
        resolve(!!row);
      }
    );
  });

  if (!partnerStillQueued) {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE players SET duoPartner = NULL WHERE id = ?`,
        [playerId],
        (err) => {
          if (err) {
            console.error("Error clearing orphaned duo partner:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });

    console.info(
      `✅ Duo partner removed for ${playerId} (partner no longer queued)`
    );
  }
}

module.exports = { handleOrphanedDuos };
