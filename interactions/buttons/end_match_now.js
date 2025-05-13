const db = require("../../database");
const { cleanupMatch } = require("../../utils/matchmakingUtils/matchUtils");

module.exports = {
  customId: "end_match_now",
  async execute(interaction) {
    const thread = interaction.channel;
    try {
      await interaction.deferReply({ flags: 64 }).catch(() => {});

      const stillExists = await thread.guild.channels
        .fetch(thread.id)
        .catch(() => null);
      if (!stillExists) return;

      const dbResult = await new Promise((resolve, reject) => {
        db.get(
          `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!dbResult) {
        return interaction.editReply({
          content: "❌ No active match found.",
        });
      }

      await cleanupMatch({
        thread,
        voiceChannelId: dbResult.voiceChannelId,
        closedByUserOrBot: interaction.user,
        closureReason: "Ended via End Match Now button",
      });
    } catch (error) {
      console.error("❌ Error handling end_match_now:", error.message);
      await interaction
        .editReply({ content: "❌ Error ending match." })
        .catch(() => {});
    }
  },
};
