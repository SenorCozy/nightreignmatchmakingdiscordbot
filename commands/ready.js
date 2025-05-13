const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const db = require("../database");
const { initiateReadyCheck } = require("../utils/readyCheck");

let activeReadyChecks = new Map();
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
      const cooldown = 5 * 60 * 1000; // 5 min

      // If a ready check is already active, just mark the player as ready
      if (activeReadyChecks.has(thread.id)) {
        const readyCheck = activeReadyChecks.get(thread.id);
        readyCheck.readyPlayers.add(userId);

        return interaction.reply({
          content: "✅ You are marked as ready!",
          flags: 64,
        });
      }

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
      console.error(`Error executing /ready command: ${error.message}`);
      return interaction.reply({
        content: "❌ An error occurred while starting the ready check.",
        flags: 64,
      });
    }
  },
};
