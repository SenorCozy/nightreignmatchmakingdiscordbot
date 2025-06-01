const db = require("../../database");
const {
  cleanupMatch,
  safeSend,
} = require("../../utils/matchmakingUtils/matchUtils");
const logger = require("../../logger");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

module.exports = {
  customId: "end_match_now",

  async execute(interaction) {
    const thread = interaction.channel;
    const userId = interaction.user.id;

    try {
      await interaction.deferReply({ flags: 64 }).catch(() => {});

      // ✅ Disable both buttons in the original message
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

      await interaction.message
        .edit({
          components: [disabledRow],
        })
        .catch((err) => {
          logger.warn("⚠️ Failed to disable match decision buttons", {
            threadId: thread.id,
            error: err.message,
          });
        });

      // ✅ Ensure thread still exists
      const stillExists = await thread.guild.channels
        .fetch(thread.id)
        .catch(() => null);

      if (!stillExists) {
        logger.warn("⚠️ end_match_now triggered but thread no longer exists", {
          threadId: thread.id,
          userId,
        });
        return;
      }

      // ✅ Retrieve match info from DB
      const dbResult = await new Promise((resolve, reject) => {
        db.get(
          `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!dbResult) {
        logger.warn("⚠️ No match found for thread during end_match_now", {
          threadId: thread.id,
          userId,
        });
        await safeSend(thread, {
          content: "❌ No active match found.",
        });
        return;
      }

      // ✅ Proceed with match cleanup
      logger.info("🛑 Match force-ended via button", {
        threadId: thread.id,
        userId,
        reason: "Ended via End Match Now button",
      });

      await cleanupMatch({
        thread,
        voiceChannelId: dbResult.voiceChannelId,
        closedByUserOrBot: interaction.user,
        closureReason: "Ended via End Match Now button",
      });
    } catch (error) {
      logger.errorWrapper("❌ Error handling end_match_now", error, {
        threadId: thread?.id,
        userId,
      });

      await safeSend(thread, {
        content: "❌ Error ending match.",
      });
    }
  },
};
