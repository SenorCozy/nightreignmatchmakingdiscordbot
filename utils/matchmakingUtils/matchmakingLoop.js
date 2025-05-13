const { runMatchmaking } = require("./runMatchmaking");

let matchmakingLoop = null;

function startMatchmakingLoop(client, db, interval = 10000) {
  console.log("⏱️ Starting matchmaking loop with interval:", interval);
  console.log("🔍 Initial client status:", {
    isReady: client?.isReady?.(),
    guilds: client?.guilds?.cache?.size,
  });

  if (matchmakingLoop) {
    console.log("🔄 Clearing existing matchmaking loop");
    clearInterval(matchmakingLoop);
  }

  matchmakingLoop = setInterval(async () => {
    console.log(
      "🔄 Running matchmaking iteration at:",
      new Date().toISOString()
    );
    try {
      await runMatchmaking(client, db);
    } catch (err) {
      console.error("❌ Error during matchmaking iteration:", err.message);
    }
  }, interval);

  console.log(`🚀 Matchmaking loop started with interval: ${interval}ms`);
}

function stopMatchmakingLoop() {
  if (matchmakingLoop) {
    clearInterval(matchmakingLoop);
    matchmakingLoop = null;
    console.info("🛑 Matchmaking loop stopped.");
  }
}

function restartMatchmakingLoop(client, db, newInterval) {
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
