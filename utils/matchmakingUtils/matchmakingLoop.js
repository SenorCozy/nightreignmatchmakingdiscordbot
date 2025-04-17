const { runMatchmaking } = require("./runMatchmaking");

let matchmakingLoop = null;

function startMatchmakingLoop(interval) {
  if (matchmakingLoop) clearInterval(matchmakingLoop);

  matchmakingLoop = setInterval(() => {
    runMatchmaking();
  }, interval);

  logger.info(`🚀 Matchmaking loop started with interval: ${interval}ms`);
}

function stopMatchmakingLoop() {
  if (matchmakingLoop) {
    clearInterval(matchmakingLoop);
    matchmakingLoop = null;
    logger.info("🛑 Matchmaking loop stopped.");
  }
}

module.exports = {
  startMatchmakingLoop,
  stopMatchmakingLoop,
  getCurrentMatchmakingInterval: () =>
    matchmakingLoop ? matchmakingLoop._idleTimeout : null,
};
