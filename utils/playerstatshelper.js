// utils/playerStats.js

function fetchPlayerStatistics(playerId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM player_statistics WHERE id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          logger.error("Error fetching player statistics:", err.message);
          return reject(err);
        }
        resolve(row || null);
      }
    );
  });
}

function fetchMostCommonDuoPartner(playerId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT partner_id, MAX(pair_count) as count 
         FROM duo_partner_counts 
         WHERE player_id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          logger.error("Error fetching most common duo partner:", err.message);
          return reject(err);
        }
        resolve(row || null);
      }
    );
  });
}

// utils/playerStats.js

function clearAllStatistics() {
  return new Promise(async (resolve, reject) => {
    try {
      await new Promise((res, rej) => {
        db.run(`DELETE FROM player_statistics`, (err) => {
          if (err) {
            logger.error("Error clearing player statistics:", err.message);
            return rej(err);
          }
          logger.info("Cleared all player statistics.");
          res();
        });
      });

      await new Promise((res, rej) => {
        db.run(`DELETE FROM duo_partner_counts`, (err) => {
          if (err) {
            logger.error("Error clearing duo partner statistics:", err.message);
            return rej(err);
          }
          logger.info("Cleared all duo partner statistics.");
          res();
        });
      });

      resolve();
    } catch (error) {
      logger.error("Error clearing all statistics:", error.message);
      reject(error);
    }
  });
}

function clearPlayerStatistics(playerId) {
  return new Promise(async (resolve, reject) => {
    try {
      await new Promise((res, rej) => {
        db.run(
          `DELETE FROM player_statistics WHERE id = ?`,
          [playerId],
          (err) => {
            if (err) {
              logger.error(
                `Error clearing player statistics for ${playerId}:`,
                err.message
              );
              return rej(err);
            }
            logger.info(
              `Cleared statistics for ${playerId} in player_statistics.`
            );
            res();
          }
        );
      });

      await new Promise((res, rej) => {
        db.run(
          `DELETE FROM duo_partner_counts WHERE player_id = ? OR partner_id = ?`,
          [playerId, playerId],
          (err) => {
            if (err) {
              logger.error(
                `Error clearing duo stats for ${playerId}:`,
                err.message
              );
              return rej(err);
            }
            logger.info(`Cleared duo partner stats for ${playerId}.`);
            res();
          }
        );
      });

      resolve();
    } catch (error) {
      logger.error(
        `Error clearing stats for player ${playerId}:`,
        error.message
      );
      reject(error);
    }
  });
}

module.exports = {
  fetchPlayerStatistics,
  fetchMostCommonDuoPartner,
  clearAllStatistics,
  clearPlayerStatistics,
};
