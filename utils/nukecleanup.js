// utils/nukeUtils.js
const { ChannelType } = require("discord.js");
const db = require("../database");
const logger = require("../logger");

async function deleteBotThreadsAndVoiceChannels(guild) {
  try {
    const allThreads = await guild.channels.fetchActiveThreads();
    const botThreads = allThreads.threads.filter(
      (thread) =>
        thread.name.startsWith("match-") &&
        thread.ownerId === guild.client.user.id
    );

    for (const thread of botThreads.values()) {
      try {
        await thread.delete("Nuke command executed");
        logger.info(`🧨 Deleted thread: ${thread.name}`);
      } catch (err) {
        logger.errorWrapper("deleteBotThread", err, {
          threadId: thread.id,
          threadName: thread.name,
        });
      }
    }

    const botVoiceChannels = guild.channels.cache.filter(
      (channel) =>
        channel.type === ChannelType.GuildVoice &&
        (channel.name.startsWith("match-voice-") ||
          channel.parent?.name?.toLowerCase().includes("matches"))
    );

    for (const voiceChannel of botVoiceChannels.values()) {
      try {
        await voiceChannel.delete("Nuke command executed");
        logger.info(`🔊 Deleted voice channel: ${voiceChannel.name}`);
      } catch (err) {
        logger.errorWrapper("deleteBotVoiceChannel", err, {
          channelId: voiceChannel.id,
          channelName: voiceChannel.name,
        });
      }
    }

    logger.info(
      "✅ All matchmaking-related threads and voice channels deleted."
    );
  } catch (err) {
    logger.errorWrapper("deleteBotThreadsAndVoiceChannels", err);
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
            logger.errorWrapper("clearDatabaseTable", err, { table });
            return reject(err);
          }
          logger.info(`🗑️ Cleared table: ${table}`);
          resolve();
        });
      });
    }

    logger.info("✅ All matchmaking-related database tables cleared.");
  } catch (err) {
    logger.errorWrapper("clearDatabaseTables", err);
    throw new Error("Failed to clear database tables.");
  }
}

module.exports = {
  deleteBotThreadsAndVoiceChannels,
  clearDatabaseTables,
};
