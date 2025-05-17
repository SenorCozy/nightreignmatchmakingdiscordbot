const db = require("../../database");
const sendDuoLeavePrompt = require("../../utils/sendDuoLeavePrompt");

module.exports = {
  customIdRegex: /^leave_queue_\d+$/,

  async execute(interaction) {
    const partnerId = interaction.customId.replace("leave_queue_", "");

    if (interaction.user.id !== partnerId) {
      return interaction.reply({
        content: "❌ This button is not meant for you.",
        flags: 64,
      });
    }

    await interaction.deferUpdate(); // Acknowledge early to prevent timeout

    try {
      // Fetch the player
      const player = await new Promise((resolve, reject) => {
        db.get(
          `SELECT * FROM players WHERE id = ? AND status = 'queued'`,
          [partnerId],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!player) {
        return interaction.followUp({
          content: "⚠️ You're no longer in the queue — nothing to do.",
          flags: 64,
        });
      }

      // ✅ Clear duo if applicable
      if (player.duoPartner) {
        const duoPartnerId = player.duoPartner;

        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE players SET duoPartner = NULL WHERE id = ? OR id = ?`,
            [partnerId, duoPartnerId],
            (err) => (err ? reject(err) : resolve())
          );
        });

        console.info(
          `Duo partnership cleared for ${partnerId} and ${duoPartnerId}`
        );

        // ✅ Notify the former partner
        await sendDuoLeavePrompt(interaction.guild, duoPartnerId);
      }

      // ✅ Remove player from queue
      const removed = await new Promise((resolve, reject) => {
        db.run(
          `DELETE FROM players WHERE id = ? AND status = 'queued'`,
          [partnerId],
          function (err) {
            if (err) return reject(err);
            resolve(this.changes);
          }
        );
      });

      if (removed === 0) {
        return interaction.followUp({
          content:
            "⚠️ You were not removed. Please try again or contact a mod.",
          flags: 64,
        });
      }

      return interaction.followUp({
        content: "✅ You have successfully left the queue.",
        flags: 64,
      });
    } catch (error) {
      console.error("Error handling leave_queue_<id> button:", error.message);
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
