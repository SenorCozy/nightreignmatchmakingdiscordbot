const { runMatchmaking } = require("./runMatchmaking");
const logger = require("../../logger");

let matchmakingLoop = null;
let currentInterval = null;

function startMatchmakingLoop(client, db, interval = 10000) {
  logger.info("⏱️ Starting matchmaking loop", { interval });

  logger.info("🔍 Initial client status", {
    isReady: client?.isReady?.(),
    guildCount: client?.guilds?.cache?.size,
  });

  if (matchmakingLoop) {
    logger.info("🔄 Clearing existing matchmaking loop");
    clearInterval(matchmakingLoop);
  }

  matchmakingLoop = setInterval(async () => {
    logger.info("🔄 Running matchmaking iteration", {
      timestamp: new Date().toISOString(),
    });

    try {
      await runMatchmaking(client, db);
    } catch (err) {
      logger.errorWrapper("❌ Error during matchmaking iteration", err);
    }
  }, interval);

  currentInterval = interval;
  logger.info("🚀 Matchmaking loop started", { intervalMs: interval });
}

function stopMatchmakingLoop() {
  if (matchmakingLoop) {
    clearInterval(matchmakingLoop);
    matchmakingLoop = null;
    logger.info("🛑 Matchmaking loop stopped.");
  }
}

function restartMatchmakingLoop(client, db, newInterval) {
  logger.info("🔁 Restarting matchmaking loop", { newInterval });
  stopMatchmakingLoop();
  startMatchmakingLoop(client, db, newInterval);
}

function getCurrentMatchmakingInterval() {
  return currentInterval;
}

module.exports = {
  startMatchmakingLoop,
  stopMatchmakingLoop,
  restartMatchmakingLoop,
  getCurrentMatchmakingInterval,
};
