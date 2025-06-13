// interactions/buttons/update_match_preferences.js
const { updateMatchPreferences } = require("../../commands/update");
const logger = require("../../logger");
const db = require("../../database");

module.exports = {
  customId: "update_match_preferences",

  async execute(interaction) {
    const thread = interaction.channel;
    const userId = interaction.user.id;

    if (!thread?.isThread()) {
      return interaction
        .reply({
          content: "❌ This must be used inside a match thread.",
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
      // Check if the user is an active player in this match
      const playerRow = await db.getAsync(
        `SELECT playerId FROM match_players WHERE threadId = ? AND playerId = ? AND status = 'active'`,
        [thread.id, userId]
      );

      if (!playerRow) {
        return interaction
          .reply({
            content: "❌ You're not an active participant in this match.",
            flags: 64,
          })
          .catch(() => {});
      }

      logger.info("🔧 User requested preference update", {
        threadId: thread.id,
        userId,
      });

      await interaction.deferReply({ ephemeral: true });

      // Use the shared update command logic
      await updateMatchPreferences(interaction, thread, userId);
    } catch (error) {
      logger.errorWrapper(
        "❌ Error in update_match_preferences button",
        error,
        {
          threadId: thread?.id,
          userId,
        }
      );

      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ Something went wrong while updating preferences.",
            flags: 64,
          })
          .catch(() => {});
      }
    }
  },
};
