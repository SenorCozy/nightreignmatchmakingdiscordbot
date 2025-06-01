const db = require("../database");
const logger = require("../logger");

function deletePlayer(playerId) {
  return new Promise(async (resolve, reject) => {
    try {
      logger.info(`🧹 Starting deletePlayer cleanup for ${playerId}...`);

      // Step 1: Remove from `players`
      await new Promise((res, rej) => {
        db.run(`DELETE FROM players WHERE id = ?`, [playerId], (err) => {
          if (err) {
            logger.errorWrapper("deletePlayer_removeFromPlayers", err, {
              playerId,
            });
            return rej(err);
          }
          res();
        });
      });

      // Step 2: Clear `duoPartner` references from others
      await new Promise((res, rej) => {
        db.run(
          `UPDATE players SET duoPartner = NULL WHERE duoPartner = ?`,
          [playerId],
          (err) => {
            if (err) {
              logger.errorWrapper(
                "deletePlayer_clearDuoPartnerReferences",
                err,
                { playerId }
              );
              return rej(err);
            }
            res();
          }
        );
      });

      // Step 3: Update `match_players` to removed + reset leave flag
      await new Promise((res, rej) => {
        db.run(
          `UPDATE match_players 
           SET status = 'removed', leave_in_progress = 0 
           WHERE playerId = ? AND status IN ('active', 'queued')`,
          [playerId],
          (err) => {
            if (err) {
              logger.errorWrapper("deletePlayer_updateMatchPlayers", err, {
                playerId,
              });
              return rej(err);
            }
            res();
          }
        );
      });

      // Step 4 (optional): Remove from `channels.playerIds` string field
      await new Promise((res, rej) => {
        db.all(
          `SELECT threadId, playerIds FROM channels WHERE playerIds LIKE ?`,
          [`%${playerId}%`],
          (err, rows) => {
            if (err) {
              logger.errorWrapper("deletePlayer_scanChannels", err, {
                playerId,
              });
              return rej(err);
            }

            for (const row of rows) {
              const ids = row.playerIds
                .split(",")
                .filter((id) => id !== playerId);
              db.run(
                `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
                [ids.join(","), row.threadId],
                (updateErr) => {
                  if (updateErr) {
                    logger.warn(
                      "⚠️ Failed to update channel after removing playerId",
                      {
                        playerId,
                        threadId: row.threadId,
                        error: updateErr.message,
                      }
                    );
                  }
                }
              );
            }

            res();
          }
        );
      });

      logger.info(
        `✅ Player ${playerId} fully cleared from matchmaking state.`
      );
      resolve();
    } catch (err) {
      logger.errorWrapper("deletePlayer_outer", err, { playerId });
      reject(err);
    }
  });
}

module.exports = { deletePlayer };
