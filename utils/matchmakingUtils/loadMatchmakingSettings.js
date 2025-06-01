const db = require("../../database");
const logger = require("../../logger");

async function loadMatchmakingSettings() {
  try {
    const matchmakingPaused = await new Promise((resolve, reject) => {
      db.get(
        `SELECT value FROM settings WHERE key = 'matchmaking_paused'`,
        [],
        (err, row) =>
          err ? reject(err) : resolve(row ? parseInt(row.value) === 1 : false)
      );
    });

    const matchmakingInterval = await new Promise((resolve, reject) => {
      db.get(
        `SELECT value FROM settings WHERE key = 'matchmaking_interval'`,
        [],
        (err, row) =>
          err ? reject(err) : resolve(row ? parseInt(row.value) : 10000)
      );
    });

    logger.info("✅ Matchmaking settings loaded", {
      matchmakingPaused,
      matchmakingInterval,
    });

    return { matchmakingPaused, matchmakingInterval };
  } catch (error) {
    logger.errorWrapper("❌ Error loading matchmaking settings", error);
    return { matchmakingPaused: false, matchmakingInterval: 10000 };
  }
}

module.exports = { loadMatchmakingSettings };
