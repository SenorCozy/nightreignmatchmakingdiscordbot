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
          content: "You are no longer in the queue.",
          flags: 64,
        });
      }

      await new Promise((resolve, reject) => {
        db.run(
          `DELETE FROM players WHERE id = ? AND status = 'queued'`,
          [partnerId],
          (err) => (err ? reject(err) : resolve())
        );
      });

      return interaction.reply({
        content: "✅ You have successfully left the queue.",
        flags: 64,
      });
    } catch (error) {
      logger.error("Error handling leave_queue_X button:", error.message);
      return interaction.reply({
        content: "❌ An error occurred while leaving the queue.",
        flags: 64,
      });
    }
  },
};
