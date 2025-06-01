const { SlashCommandBuilder } = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const { hasModRole } = require("../utils/permissions");
const {
  safeSend,
  generateMatchTranscript,
  fetchAllMessages,
  getSystemMessageDescription,
} = require("../utils/matchmakingUtils/matchUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("delete")
    .setDescription(
      "Force-delete a match thread and its associated VC (use with caution)"
    ),

  async execute(interaction) {
    const thread = interaction.channel;

    if (!thread?.isThread()) {
      return interaction.reply({
        content: "❌ This command must be used in a match thread.",
        flags: 64,
      });
    }

    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "🚫 You do not have permission to use this command.",
        flags: 64,
      });
    }

    await interaction.deferReply({ flags: 64 });
    const guild = thread.guild;
    let voiceChannelId = null;

    try {
      const row = await db.getAsync(
        `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
        [thread.id]
      );
      voiceChannelId = row?.voiceChannelId || null;
    } catch (err) {
      logger.warn("⚠️ Failed to retrieve voiceChannelId from DB", {
        threadId: thread.id,
        error: err.message,
      });
    }

    // 📜 Try to generate transcript if one doesn't already exist
    try {
      const existingTranscript = await db.getAsync(
        `SELECT id FROM transcripts WHERE thread_id = ?`,
        [thread.id]
      );
      if (!existingTranscript) {
        await generateMatchTranscript(
          thread,
          interaction.user,
          "Force-deleted by mod",
          []
        );
      } else {
        logger.info("📝 Transcript already exists for this match thread.", {
          threadId: thread.id,
        });
      }
    } catch (err) {
      logger.warn("⚠️ Failed to generate or check for existing transcript", {
        threadId: thread.id,
        error: err.message,
      });
    }

    // 💬 Delete thread
    try {
      await thread.delete("Force-deleted by moderator");
      logger.info(`🧹 Thread deleted manually: ${thread.id}`);
    } catch (err) {
      logger.warn("⚠️ Failed to delete thread", {
        threadId: thread.id,
        error: err.message,
      });
    }

    // 🔊 Delete voice channel if exists
    if (voiceChannelId) {
      const vc = guild.channels.cache.get(voiceChannelId);
      if (vc) {
        try {
          for (const member of vc.members.values()) {
            await member.voice.disconnect().catch(() => {});
          }
          await vc.delete("Force-deleted by moderator");
          logger.info(`🎤 Voice channel deleted manually: ${vc.id}`);
        } catch (err) {
          logger.warn("⚠️ Failed to delete voice channel", {
            vcId: voiceChannelId,
            error: err.message,
          });
        }
      } else {
        logger.info("ℹ️ Voice channel ID provided but channel not found.");
      }
    }

    try {
      const playerIds = await db
        .allAsync(`SELECT playerId FROM match_players WHERE threadId = ?`, [
          thread.id,
        ])
        .then((rows) => rows.map((r) => r.playerId));

      if (playerIds.length > 0) {
        await db.runAsync(
          `UPDATE players SET status = 'left' WHERE id IN (${playerIds
            .map(() => "?")
            .join(",")})`,
          playerIds
        );
        logger.info(`♻️ Reset status for players: ${playerIds.join(", ")}`);
      }

      await db.runAsync(`DELETE FROM match_players WHERE threadId = ?`, [
        thread.id,
      ]);
      await db.runAsync(`DELETE FROM channels WHERE threadId = ?`, [thread.id]);
      // ⚠️ Do not delete from matches
      logger.info(
        `🗑️ DB remnants (except matches) cleared for thread: ${thread.id}`
      );
    } catch (err) {
      logger.warn("⚠️ Failed to clear DB remnants", {
        threadId: thread.id,
        error: err.message,
      });
    }

    return safeSend(interaction, {
      content:
        "✅ Thread and voice channel deleted. Player states reset successfully.",
    });
  },
};
