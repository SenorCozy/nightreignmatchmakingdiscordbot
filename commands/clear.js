const { SlashCommandBuilder } = require("discord.js");
const { hasModRole } = require("../utils/permissions");
const { getPlayerById, deletePlayer } = require("../utils/deleteplayer");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Force-clear a user's match/queue status from the database")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User to clear").setRequired(true)
    ),

  async execute(interaction) {
    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "🚫 You do not have permission to use this command.",
        flags: 64,
      });
    }

    const member = interaction.options.getUser("user");
    const playerId = member.id;

    try {
      const player = await getPlayerById(playerId);
      if (!player) {
        return interaction.reply({
          content: `ℹ️ <@${playerId}> is not currently in the matchmaking database.`,
          flags: 64,
        });
      }

      await deletePlayer(playerId);

      return interaction.reply({
        content: `✅ <@${playerId}> has been force-cleared from the database.\nThey can now queue or be added to a match.`,
        flags: 64,
      });
    } catch (error) {
      logger.error("❌ Error executing /clear:", error);
      return interaction.reply({
        content:
          "❌ An error occurred while attempting to clear the user. Please check logs.",
        flags: 64,
      });
    }
  },
};
