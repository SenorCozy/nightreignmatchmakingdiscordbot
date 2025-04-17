// utils/player.js
const db = require("../database");
function deletePlayer(playerId) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM players WHERE id = ?`, [playerId], (err) => {
      if (err) {
        logger.error("Error deleting player from database:", err.message);
        return reject(err);
      }
      logger.info(`✅ Player ${playerId} has been removed from the database.`);
      resolve();
    });
  });
}

function getPlayerById(playerId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM players WHERE id = ?`, [playerId], (err, row) =>
      err ? reject(err) : resolve(row)
    );
  });
}

module.exports = {
  deletePlayer,
  getPlayerById,
};
