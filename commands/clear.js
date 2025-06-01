const { SlashCommandBuilder } = require("discord.js");
const { hasModRole } = require("../utils/permissions");
const { deletePlayer } = require("../utils/deleteplayer");
const { getPlayerById } = require("../utils/playerUtils");
const db = require("../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription(
      "Force-clear a user's match/queue/leave in progress status from the database"
    )
    .addUserOption((option) =>
      option.setName("user").setDescription("User to clear").setRequired(true)
    ),

  async execute(interaction) {
    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "🚫 You do not have permission to use this command.",
        flags: 64,
      });
    }

    const targetUser = interaction.options.getUser("user");
    const playerId = targetUser.id;

    try {
      const player = await getPlayerById(playerId);

      if (!player) {
        return interaction.reply({
          content: `ℹ️ <@${playerId}> is not currently in the matchmaking system.`,
          flags: 64,
        });
      }

      // ✅ Reset leave_in_progress just in case
      await db.runAsync(
        `UPDATE match_players SET leave_in_progress = 0 WHERE playerId = ?`,
        [playerId]
      );

      // ✅ Clear player status
      await deletePlayer(playerId);

      console.info(`✅ Cleared player ${playerId} (${targetUser.tag}) from DB`);

      return interaction.reply({
        content: `✅ Successfully cleared <@${playerId}> from the database.\nThey may now requeue or be manually added to a match.`,
        flags: 64,
      });
    } catch (err) {
      console.error(`❌ Error clearing player ${playerId}:`, err);
      return interaction.reply({
        content:
          "❌ An error occurred while clearing the player. Please try again or check logs.",
        flags: 64,
      });
    }
  },
};
