const { searchForPlayers } = require("../commands/search");
const db = require("../../database");

module.exports = {
  customId: "find_replacement",
  async execute(interaction) {
    try {
      const thread = interaction.channel;
      if (!thread?.isThread()) {
        return interaction.reply({
          content: "❌ This command must be used in a match thread.",
          flags: 64,
        });
      }

      // Fetch match data
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!match) {
        return interaction.reply({
          content: "❌ This match no longer exists.",
          flags: 64,
        });
      }

      const playerIds = match.playerIds.split(",").filter(Boolean);
      const missingCount = 3 - playerIds.length;

      if (missingCount <= 0) {
        return interaction.reply({
          content: "⚠️ This match already has 3 players.",
          flags: 64,
        });
      }

      await interaction.reply({
        content: `🔍 Attempting to find ${missingCount} replacement player(s)...`,
        flags: 64,
      });

      await searchForPlayers(thread, missingCount);
    } catch (error) {
      logger.error("❌ Error handling find_replacement button:", error.message);
      await interaction
        .reply({
          content: "❌ An error occurred while finding replacements.",
          flags: 64,
        })
        .catch(() => {});
    }
  },
};
