const { getPlayerById } = require("../../utils/playerUtils");
const sendDuoLeavePrompt = require("../../utils/sendDuoLeavePrompt");
const db = require("../../database");

module.exports = {
  customId: "remove_from_queue",
  async execute(interaction) {
    const playerId = interaction.user.id;

    try {
      const player = await getPlayerById(playerId);
      if (!player) {
        return interaction.reply({
          content: "You're not currently in the matchmaking queue.",
          flags: 64,
        });
      }

      if (player.status === "active") {
        return interaction.reply({
          content: "You are in an active match and cannot leave the queue.",
          flags: 64,
        });
      }

      // Acknowledge the interaction early
      await interaction.deferUpdate();

      // ✅ Duo unlink logic
      if (player.duoPartner) {
        const partnerId = player.duoPartner;

        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE players SET duoPartner = NULL WHERE id = ? OR id = ?`,
            [playerId, partnerId],
            (err) => (err ? reject(err) : resolve())
          );
        });

        console.info(
          `Duo partnership cleared for ${playerId} and ${partnerId}`
        );

        // ✅ Use shared utility for DM + fallback
        await sendDuoLeavePrompt(interaction.guild, partnerId);
      }

      // ✅ Delete from players table
      const result = await new Promise((resolve, reject) => {
        db.run(
          `DELETE FROM players WHERE id = ? AND status = ?`,
          [playerId, "queued"],
          function (err) {
            if (err) return reject(err);
            resolve(this.changes);
          }
        );
      });

      if (result === 0) {
        return interaction.followUp({
          content: "❌ You were not in the queue or have already been removed.",
          flags: 64,
        });
      }

      return interaction.followUp({
        content: "✅ You've been removed from the matchmaking queue.",
        flags: 64,
      });
    } catch (error) {
      console.error("Error handling remove_from_queue:", error.message);
      try {
        return interaction.followUp({
          content: "❌ An error occurred while leaving the queue.",
          flags: 64,
        });
      } catch (fallbackErr) {
        console.error("❌ Failed to send followUp:", fallbackErr.message);
      }
    }
  },
};
