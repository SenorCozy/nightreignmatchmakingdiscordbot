const { PermissionFlagsBits } = require("discord.js");
const { initiateReadyCheck } = require("../../utils/readyCheck");
const db = require("../../database");

module.exports = {
  customId: "ready_check",

  async execute(interaction) {
    const thread = interaction.channel;

    try {
      await interaction.deferReply({ flags: 64 });

      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, lastReadyCheck FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!match) {
        return interaction.editReply({
          content: "❌ This match is not in the database.",
        });
      }

      const { playerIds, lastReadyCheck } = match;
      const players = playerIds.split(",");
      const now = Date.now();
      const cooldown = 15 * 60 * 1000;

      const isMod = interaction.member.permissions.has(
        PermissionFlagsBits.ManageChannels
      );

      if (!isMod && now - lastReadyCheck < cooldown) {
        return interaction.editReply({
          content:
            "A ready check was already recently started. Please wait a few minutes.",
        });
      }

      db.run(`UPDATE channels SET lastReadyCheck = ? WHERE threadId = ?`, [
        now,
        thread.id,
      ]);

      await initiateReadyCheck(thread, players);

      await interaction.editReply({
        content: "✅ Ready check initiated.",
      });
    } catch (err) {
      logger.error("Error handling ready_check button:", err.message);
      return interaction
        .editReply({ content: "❌ Failed to start ready check." })
        .catch(() => {});
    }
  },
};
