const { searchForPlayers } = require("../../commands/search");
const db = require("../../database");
const logger = require("../../logger");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { safeSend } = require("../../utils/matchmakingUtils/matchUtils");

module.exports = {
  customId: "find_replacement",

  async execute(interaction) {
    const thread = interaction.channel;
    const userId = interaction.user.id;

    if (!thread?.isThread()) {
      return interaction
        .reply({
          content: "❌ This command must be used in a match thread.",
          flags: 64,
        })
        .catch((err) =>
          logger.warn("⚠️ Failed to reply to non-thread interaction", {
            userId,
            error: err.message,
          })
        );
    }

    try {
      // Disable buttons
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("end_match_now")
          .setLabel("End Match Immediately")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("find_replacement")
          .setLabel("Find Replacement from Queue")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true)
      );

      await interaction.message.edit({
        components: [disabledRow],
      });

      const match = await db.getAsync(
        `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
        [thread.id]
      );

      if (!match) {
        return interaction
          .reply({
            content: "❌ This match no longer exists.",
            flags: 64,
          })
          .catch((err) =>
            logger.warn("⚠️ Failed to reply to missing match", {
              threadId: thread.id,
              error: err.message,
            })
          );
      }

      const activePlayerIds = await db
        .allAsync(
          `SELECT playerId FROM match_players WHERE threadId = ? AND status = 'active'`,
          [thread.id]
        )
        .then((rows) => rows.map((r) => r.playerId));

      const missingCount = 3 - activePlayerIds.length;

      if (missingCount <= 0) {
        logger.info("⚠️ Replacement request denied — match full", {
          threadId: thread.id,
          userId,
        });
        return interaction
          .reply({
            content: "⚠️ This match already has 3 players.",
            flags: 64,
          })
          .catch(() => {});
      }

      logger.info("🔍 Searching for replacement(s)", {
        threadId: thread.id,
        requestedBy: userId,
        missingCount,
      });

      await interaction.reply({
        content: `🔍 Attempting to find ${missingCount} replacement player(s)...`,
        flags: 64,
      });

      await searchForPlayers(thread, missingCount);
    } catch (error) {
      logger.errorWrapper("❌ Error handling find_replacement", error, {
        threadId: thread?.id,
        userId,
      });

      await safeSend(thread, {
        content: "❌ An error occurred while finding replacements.",
      });
    }
  },
};
