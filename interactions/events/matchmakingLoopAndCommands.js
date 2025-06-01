const {
  loadMatchmakingSettings,
} = require("../../utils/matchmakingUtils/loadMatchmakingSettings");
const {
  startMatchmakingLoop,
} = require("../../utils/matchmakingUtils/matchmakingLoop");
const logger = require("../../logger");
const db = require("../../database");

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    logger.info(`✅ Logged in as: ${client.user.tag}`);
    logger.info(`📡 Connected to ${client.guilds.cache.size} guild(s).`);

    try {
      const { matchmakingInterval } = await loadMatchmakingSettings();
      client.matchmakingInterval = matchmakingInterval;
      startMatchmakingLoop(
        client,
        require("../../database"),
        matchmakingInterval
      );
      logger.info(`🔁 Started matchmaking loop at ${matchmakingInterval}ms`);
    } catch (err) {
      logger.errorWrapper("Ready_Matchmaking", err);
    }

    try {
      const commandDataArray = Array.from(client.commands.values()).map(
        (cmd) => cmd.data
      );
      const guild = client.guilds.cache.first();
      await guild.commands.set(commandDataArray);
      logger.info(`📦 Registered ${commandDataArray.length} slash commands.`);
    } catch (err) {
      logger.errorWrapper("RegisterCommands", err);
    }
  },
};
