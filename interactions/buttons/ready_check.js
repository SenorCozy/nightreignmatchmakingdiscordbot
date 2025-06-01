const { initiateReadyCheck } = require("../../utils/readyCheck");
const {
  isReadyCheckActive,
  startReadyCheck,
} = require("../../utils/readyCheckState");
const db = require("../../database");
const logger = require("../../logger");
const { safeSend } = require("../../utils/matchmakingUtils/matchUtils");

module.exports = {
  customId: "ready_check",

  async execute(interaction) {
    const thread = interaction.channel;
    const userId = interaction.user.id;

    await interaction.deferReply().catch((err) =>
      logger.warn("⚠️ Failed to defer ready_check interaction", {
        threadId: thread?.id,
        error: err.message,
      })
    );

    try {
      if (!thread?.isThread()) {
        return interaction.editReply({
          content: "❌ This must be used inside a match thread.",
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

      const matchData = await db.getAsync(
        `SELECT match_id, lastReadyCheck FROM channels WHERE threadId = ?`,
        [thread.id]
      );

      if (!matchData) {
        return interaction.editReply({
          content: "❌ This match is not in the database.",
        });
      }

      const { match_id, lastReadyCheck } = matchData;
      const now = Date.now();
      const cooldown = 5 * 60 * 1000;

      if (isReadyCheckActive(thread.id)) {
        return interaction.editReply({
          content: "⚠️ A ready check is already in progress.",
        });
      }

      if (!isMod && now - lastReadyCheck < cooldown) {
        return interaction.editReply({
          content:
            "⏳ A ready check was recently performed. Please wait ~5 minutes.",
        });
      }

      const players = await db
        .allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id]
        )
        .then((rows) => rows.map((r) => r.playerId));

      if (!players.includes(userId)) {
        return interaction.editReply({
          content: "❌ You are not a participant in this match.",
        });
      }

      if (players.length <= 1) {
        return interaction.editReply({
          content:
            "❌ You need at least 2 active players to start a ready check.",
        });
      }

      await db.runAsync(
        `UPDATE channels SET lastReadyCheck = ? WHERE threadId = ?`,
        [now, thread.id]
      );

      startReadyCheck(thread.id, userId);

      await initiateReadyCheck(thread, players);

      return interaction.editReply({
        content: "✅ Ready check initiated.",
      });
    } catch (err) {
      logger.errorWrapper("❌ Error in ready_check button", err, {
        threadId: thread?.id,
        userId,
      });

      await safeSend(thread, {
        content: "❌ Failed to start ready check.",
      });
    }
  },
};
