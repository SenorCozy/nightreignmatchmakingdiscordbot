const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../../database");
const logger = require("../../logger");
const { removePlayerFromMatch } = require("../../utils/playerUtils");
const {
  cleanupMatch,
  safeSend,
} = require("../../utils/matchmakingUtils/matchUtils");

module.exports = {
  customId: "leave_match",

  async execute(interaction) {
    const thread = interaction.channel;
    const userId = interaction.user.id;

    if (!thread?.isThread()) {
      return interaction
        .reply({
          content: "❌ This must be used inside a match thread.",
          flags: 64,
        })
        .catch(() => {});
    }

    await interaction.deferReply({ flags: 64 }).catch((err) =>
      logger.warn("⚠️ Failed to defer leave_match interaction", {
        userId,
        threadId: thread?.id,
        error: err.message,
      })
    );

    try {
      const matchData = await db.getAsync(
        `SELECT match_id, voiceChannelId, shared_nightlords FROM matches WHERE thread_id = ?`,
        [thread.id]
      );

      if (!matchData) {
        return interaction.editReply({
          content: "❌ This match no longer exists.",
          flags: 64,
        });
      }

      const { match_id, voiceChannelId, shared_nightlords } = matchData;

      const playerRow = await db.getAsync(
        `SELECT status, leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
        [match_id, userId]
      );

      if (!playerRow || playerRow.status !== "active") {
        return interaction.editReply({
          content: "❌ You are not part of this match.",
          flags: 64,
        });
      }

      if (playerRow.leave_in_progress === 1) {
        return interaction.editReply({
          content: "⚠️ You're already being removed from this match.",
          flags: 64,
        });
      }

      await db.runAsync(
        `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
        [match_id, userId]
      );

      await removePlayerFromMatch(userId, thread.id, "left_match");

      const remaining = await db.getAsync(
        `SELECT COUNT(*) AS count FROM match_players WHERE match_id = ? AND status = 'active'`,
        [match_id]
      );

      if ((remaining?.count || 0) === 0) {
        await cleanupMatch({ thread, voiceChannelId });
        return;
      }

      // Get remaining players for ping
      const updatedPlayerIds = await db
        .allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id]
        )
        .then((rows) => rows.map((r) => r.playerId));

      // Format shared Nightlord preferences
      let formattedPrefs = "_None currently set._";
      try {
        const parsed = shared_nightlords ? JSON.parse(shared_nightlords) : [];
        if (Array.isArray(parsed) && parsed.length) {
          formattedPrefs = parsed.map((p) => `• ${p}`).join("\n");
        }
      } catch (err) {
        logger.warn("⚠️ Failed to parse shared_nightlords", {
          match_id,
          error: err.message,
        });
      }

      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("update_shared_nightlords_button")
          .setLabel("Update Nightlord Preferences")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("find_replacement")
          .setLabel("Find Replacement from Queue")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("end_match_now")
          .setLabel("End Match Immediately")
          .setStyle(ButtonStyle.Danger)
      );

      await safeSend(thread, {
        content: `⚠️ <@${updatedPlayerIds.join(">, <@")}>
A player has left the match.

**Current Nightlord Preferences:**\n${formattedPrefs}

Would you like to update preferences before searching for a replacement or ending the match?`,
        components: [buttonRow],
      });

      return interaction.editReply({
        content: "✅ You have successfully left the match.",
        flags: 64,
      });
    } catch (error) {
      logger.errorWrapper("❌ Error handling leave_match", error, {
        userId,
        threadId: thread?.id,
      });

      return interaction.editReply({
        content: "❌ Something went wrong trying to leave the match.",
        flags: 64,
      });
    }
  },
};
