const { ChannelType } = require("discord.js");

async function deleteBotThreadsAndVoiceChannels(guild) {
  try {
    const allThreads = await guild.channels.fetchActiveThreads();
    const botThreads = allThreads.threads.filter(
      (thread) =>
        thread.name.startsWith("match-") &&
        thread.ownerId === guild.client.user.id
    );

    for (const thread of botThreads.values()) {
      await thread
        .delete("Nuke command executed")
        .catch((err) =>
          logger.error(`Failed to delete thread (${thread.name}):`, err.message)
        );
    }

    const botVoiceChannels = guild.channels.cache.filter(
      (channel) =>
        channel.type === ChannelType.GuildVoice &&
        (channel.name.startsWith("match-voice-") ||
          channel.parent?.name?.toLowerCase().includes("matches"))
    );

    for (const voiceChannel of botVoiceChannels.values()) {
      await voiceChannel
        .delete("Nuke command executed")
        .catch((err) =>
          logger.error(
            `Failed to delete voice channel (${voiceChannel.name}):`,
            err.message
          )
        );
    }

    logger.info(
      "✅ All matchmaking-related threads and voice channels deleted."
    );
  } catch (error) {
    logger.error(
      "❌ Error deleting matchmaking-related threads and voice channels:",
      error.message
    );
    throw new Error(
      "Failed to delete bot-created matchmaking threads and voice channels."
    );
  }
}

async function clearDatabaseTables() {
  try {
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM players`, (err) => {
        if (err) {
          logger.error("❌ Error clearing players table:", err.message);
          return reject(err);
        }
        resolve();
      });
    });

    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM channels`, (err) => {
        if (err) {
          logger.error("❌ Error clearing channels table:", err.message);
          return reject(err);
        }
        resolve();
      });
    });

    logger.info("✅ Queue and match data successfully cleared.");
  } catch (error) {
    logger.error("❌ Error clearing database tables:", error.message);
    throw new Error("Failed to clear database tables.");
  }
}

module.exports = {
  deleteBotThreadsAndVoiceChannels,
  clearDatabaseTables,
};
