const { ChannelType } = require("discord.js");
const db = require("../database");
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
          console.error(
            `Failed to delete thread (${thread.name}):`,
            err.message
          )
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
          console.error(
            `Failed to delete voice channel (${voiceChannel.name}):`,
            err.message
          )
        );
    }

    console.info(
      "✅ All matchmaking-related threads and voice channels deleted."
    );
  } catch (error) {
    console.error(
      "❌ Error deleting matchmaking-related threads and voice channels:",
      error.message
    );
    throw new Error(
      "Failed to delete bot-created matchmaking threads and voice channels."
    );
  }
}

async function clearDatabaseTables() {
  const tablesToClear = [
    "players",
    "channels",
    "match_players",
    "match_events",
    "matches",
    "transcripts",
    "transcript_messages",
  ];

  try {
    for (const table of tablesToClear) {
      await new Promise((resolve, reject) => {
        db.run(`DELETE FROM ${table}`, (err) => {
          if (err) {
            console.error(`❌ Error clearing ${table} table:`, err.message);
            return reject(err);
          }
          resolve();
        });
      });
    }

    console.info("✅ All matchmaking-related data successfully cleared.");
  } catch (error) {
    console.error("❌ Error clearing database tables:", error.message);
    throw new Error("Failed to clear database tables.");
  }
}

module.exports = {
  deleteBotThreadsAndVoiceChannels,
  clearDatabaseTables,
};
