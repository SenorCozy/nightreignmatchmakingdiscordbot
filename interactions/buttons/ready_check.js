const { PermissionFlagsBits } = require("discord.js");
const { initiateReadyCheck } = require("../../utils/readyCheck");
const db = require("../../database");

module.exports = {
  customId: "ready_check",

  async execute(interaction) {
    await interaction.deferReply();
    const thread = interaction.channel;

    try {
      const matchData = await new Promise((resolve, reject) => {
        db.get(
          `SELECT match_id, lastReadyCheck FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!matchData) {
        return interaction.reply({
          content: "❌ This match is not in the database.",
          flags: 64,
        });
      }

      const { match_id, lastReadyCheck } = matchData;

      const activePlayers = await new Promise((resolve, reject) => {
        db.all(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id],
          (err, rows) =>
            err ? reject(err) : resolve(rows.map((r) => r.playerId))
        );
      });

      const players = activePlayers;
      const now = Date.now();
      const cooldown = 15 * 60 * 1000;

      const moderatorRoleIds = [
        process.env.TICKET_HANDLER_ROLE,
        process.env.ELDEN_MODERATOR_ROLE,
        process.env.ELDEN_ENFORCER_ROLE,
        process.env.BOT_ROLE,
      ].filter(Boolean);

      const isMod =
        interaction.member &&
        moderatorRoleIds.some((roleId) =>
          interaction.member.roles.cache.has(roleId)
        );

      // If cooldown is active and not bypassed by a moderator
      if (!isMod && now - lastReadyCheck < cooldown) {
        return interaction.reply({
          content:
            "⏳ A ready check was conducted recently. Please wait ~5 minutes before trying again.",
          flags: 64,
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
      console.error("Error handling ready_check button:", err.message);
      return interaction
        .editReply({ content: "❌ Failed to start ready check." })
        .catch(() => {});
    }
  },
};
