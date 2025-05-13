const db = require("../../database");

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

    try {
      const stillQueued = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
          [partnerId],
          (err, row) => (err ? reject(err) : resolve(!!row))
        );
      });

      if (!stillQueued) {
        return interaction.reply({
          content: "⚠️ You're no longer in the queue — nothing to do.",
          flags: 64,
        });
      }

      // ✅ Delete from queue
      const removed = await new Promise((resolve, reject) => {
        db.run(
          `DELETE FROM players WHERE id = ? AND status = 'queued'`,
          [partnerId],
          function (err) {
            if (err) return reject(err);
            resolve(this.changes); // returns number of rows affected
          }
        );
      });

      if (removed === 0) {
        return interaction.reply({
          content:
            "⚠️ You were not removed. Please try again or contact a mod.",
          flags: 64,
        });
      }

      return interaction.reply({
        content: "✅ You have successfully left the queue.",
        flags: 64,
      });
    } catch (error) {
      console.error("Error handling leave_queue_X button:", error.message);
      return interaction.reply({
        content: "❌ An error occurred while leaving the queue.",
        flags: 64,
      });
    }
  },
};
