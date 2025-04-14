const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ready")
    .setDescription("Start a ready check or mark yourself as ready"),

  async execute(interaction) {
    try {
      const thread = interaction.channel;
      const userId = interaction.user.id;
      const isAdmin = interaction.member.permissions.has(
        PermissionFlagsBits.ManageChannels
      );

      if (!thread?.isThread()) {
        return interaction.reply({
          content: "❌ You can only use this command inside a match thread.",
          flags: 64,
        });
      }

      // Ensure global ready check state exists
      if (!global.activeReadyChecks) global.activeReadyChecks = new Map();

      // Fetch match data
      const dbResult = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, lastReadyCheck FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => {
            if (err) return reject(err);
            resolve(row);
          }
        );
      });

      if (!dbResult) {
        return interaction.reply({
          content: "❌ This match is not in the database.",
          flags: 64,
        });
      }

      const { playerIds, lastReadyCheck } = dbResult;
      const players = playerIds.split(",");
      const now = Date.now();
      const cooldown = 15 * 60 * 1000; // 15 min

      // If a ready check is already active, just mark the player as ready
      if (activeReadyChecks.has(thread.id)) {
        const readyCheck = activeReadyChecks.get(thread.id);
        readyCheck.readyPlayers.add(userId);

        return interaction.reply({
          content: "✅ You are marked as ready!",
          flags: 64,
        });
      }

      // If cooldown is active and not bypassed by admin
      if (!isAdmin && now - lastReadyCheck < cooldown) {
        return interaction.reply({
          content:
            "⏳ A ready check was conducted recently. Please wait before trying again.",
          flags: 64,
        });
      }

      // Update DB with new ready check timestamp
      db.run(`UPDATE channels SET lastReadyCheck = ? WHERE threadId = ?`, [
        now,
        thread.id,
      ]);

      // Start a new ready check
      activeReadyChecks.set(thread.id, {
        readyPlayers: new Set([userId]),
      });

      await interaction.reply(
        "📣 Ready check initiated! Type `/ready` to mark yourself ready."
      );

      await initiateReadyCheck(thread, players);
    } catch (error) {
      logger.error(`Error executing /ready command: ${error.message}`);
      return interaction.reply({
        content: "❌ An error occurred while starting the ready check.",
        flags: 64,
      });
    }
  },
};
