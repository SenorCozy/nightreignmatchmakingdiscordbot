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
        threadId: thread.id,
        error: err.message,
      })
    );

    try {
      const matchData = await db.getAsync(
        `SELECT match_id, voiceChannelId FROM channels WHERE threadId = ?`,
        [thread.id]
      );

      if (!matchData) {
        return interaction.editReply({
          content: "❌ This match no longer exists.",
        });
      }

      const { match_id, voiceChannelId } = matchData;

      const playerRow = await db.getAsync(
        `SELECT status, leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
        [match_id, userId]
      );

      if (!playerRow || playerRow.status !== "active") {
        return interaction.editReply({
          content: "❌ You are not part of this match.",
        });
      }

      if (playerRow.leave_in_progress === 1) {
        return interaction.editReply({
          content: "⚠️ You're already being removed from this match.",
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

      const updatedPlayerIds = await db
        .allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id]
        )
        .then((rows) => rows.map((r) => r.playerId));

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("end_match_now")
          .setLabel("End Match Immediately")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("find_replacement")
          .setLabel("Find Replacement from Queue")
          .setStyle(ButtonStyle.Primary)
      );

      await safeSend(thread, {
        content: `⚠️ <@${updatedPlayerIds.join(">, <@")}>
A player has left the match. Would you like to end the match or search for a replacement?`,
        components: [row],
      });

      return interaction.editReply({
        content: "✅ You have successfully left the match.",
      });
    } catch (error) {
      logger.errorWrapper("❌ Error handling leave_match", error, {
        userId,
        threadId: interaction.channel?.id,
      });

      return interaction.editReply({
        content: "❌ Something went wrong trying to leave the match.",
      });
    }
  },
};
