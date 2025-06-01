// commands/ready.js
const { SlashCommandBuilder } = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const { initiateReadyCheck } = require("../utils/readyCheck");
const { handleReadyConfirmation } = require("../utils/handleReadyConfirmation");
const {
  isReadyCheckActive,
  startReadyCheck,
} = require("../utils/readyCheckState");
const { safeSend } = require("../utils/matchmakingUtils/matchUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ready")
    .setDescription("Start a ready check or mark yourself as ready"),

  async execute(interaction) {
    const thread = interaction.channel;
    const userId = interaction.user.id;

    if (!thread?.isThread()) {
      return interaction.reply({
        content: "❌ You can only use this command inside a match thread.",
        flags: 64,
      });
    }

    try {
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

      const matchData = await db.getAsync(
        `SELECT match_id, lastReadyCheck FROM channels WHERE threadId = ?`,
        [thread.id]
      );

      if (!matchData) {
        return interaction.reply({
          content: "❌ This match is not in the database.",
          flags: 64,
        });
      }

      const { match_id, lastReadyCheck } = matchData;
      const now = Date.now();
      const cooldown = 5 * 60 * 1000;

      if (isReadyCheckActive(thread.id)) {
        return await handleReadyConfirmation(
          thread,
          userId,
          "slash",
          interaction
        );
      }

      if (!isMod && now - lastReadyCheck < cooldown) {
        return interaction.reply({
          content:
            "⏳ A ready check was conducted recently. Please wait ~5 minutes before trying again.",
          flags: 64,
        });
      }

      const players = await db
        .allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id]
        )
        .then((rows) => rows.map((r) => r.playerId));

      if (!players.includes(userId)) {
        return interaction.reply({
          content: "❌ You are not an active player in this match.",
          flags: 64,
        });
      }
      if (players.length <= 1) {
        return interaction.reply({
          content:
            "❌ You need at least 2 active players to initiate a ready check.",
          flags: 64,
        });
      }

      await db.runAsync(
        `UPDATE channels SET lastReadyCheck = ? WHERE threadId = ?`,
        [now, thread.id]
      );

      startReadyCheck(thread.id, userId);

      await interaction.reply({
        content:
          "📣 Ready check initiated! Type `/ready` again or press the button to confirm.",
      });

      await safeSend(thread, "⏳ Ready check is now active.");
      await initiateReadyCheck(thread, players);
    } catch (err) {
      logger.errorWrapper("❌ Error executing /ready command", err, {
        userId,
        threadId: thread?.id,
      });

      const errorMsg = {
        content: "❌ An error occurred while starting the ready check.",
        flags: 64,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMsg).catch(() => {});
      } else {
        await interaction.reply(errorMsg).catch(() => {});
      }
    }
  },
};
