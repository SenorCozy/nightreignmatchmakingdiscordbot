const { getPlayerById } = require("../../utils/playerUtils");
const sendQueueStatusPrompt = require("../../utils/sendQueueStatusPrompt");
const db = require("../../database");
const logger = require("../../logger");
const {
  unlockAchievementIfNotEarned,
} = require("../../utils/achievementHelpers");

module.exports = {
  customId: "remove_from_queue",

  async execute(interaction) {
    const playerId = interaction.user.id;

    try {
      const player = await getPlayerById(playerId);
      if (!player) {
        return interaction
          .reply({
            content: "You're not currently in the matchmaking queue.",
            flags: 64,
          })
          .catch((err) =>
            logger.warn("⚠️ Failed to send not-in-queue reply", {
              playerId,
              error: err.message,
            })
          );
      }

      if (player.status === "active") {
        return interaction
          .reply({
            content:
              "❌ You are in an active match and cannot leave the queue.",
            flags: 64,
          })
          .catch((err) =>
            logger.warn("⚠️ Failed to send active-match reply", {
              playerId,
              error: err.message,
            })
          );
      }

      await interaction.deferUpdate().catch((err) =>
        logger.warn("⚠️ Failed to defer remove_from_queue interaction", {
          playerId,
          error: err.message,
        })
      );

      const guild = interaction.guild;

      // ✅ Handle active trio association
      const activeTrio = await db.getAsync(
        `SELECT * FROM trio_partner_groups 
         WHERE active = 1 AND (player1_id = ? OR player2_id = ? OR player3_id = ?)`,
        [playerId, playerId, playerId]
      );

      if (activeTrio) {
        const trioIds = [
          activeTrio.player1_id,
          activeTrio.player2_id,
          activeTrio.player3_id,
        ];
        const remaining = trioIds.filter((id) => id !== playerId);

        await db.runAsync(
          `UPDATE trio_partner_groups SET active = 0 WHERE trio_id = ?`,
          [activeTrio.trio_id]
        );

        logger.info("🧯 Trio disbanded via remove_from_queue", {
          trio_id: activeTrio.trio_id,
          leaver: playerId,
        });

        for (const otherId of remaining) {
          await db.runAsync(
            `UPDATE players SET duoPartner = NULL WHERE id = ?`,
            [otherId]
          );
          await sendQueueStatusPrompt(guild, otherId, "trio");
        }
        await unlockAchievementIfNotEarned(playerId, "leave_trio");
      }

      // ✅ Handle duo unlinking
      if (player.duoPartner) {
        const partnerId = player.duoPartner;

        await db.runAsync(
          `UPDATE players SET duoPartner = NULL WHERE id IN (?, ?)`,
          [playerId, partnerId]
        );

        logger.info("🔗 Duo unlinked via remove_from_queue", {
          playerId,
          partnerId,
        });

        await sendQueueStatusPrompt(guild, partnerId, "duo");
        await unlockAchievementIfNotEarned(playerId, "leave_duo");
      }

      // ✅ Mark player as left and update cooldown timestamp
      await db.runAsync(
        `UPDATE players SET status = 'left', last_queue_exit_at = ? WHERE id = ?`,
        [Date.now(), playerId]
      );

      logger.info("✅ Player removed from queue", { playerId });

      return interaction
        .followUp({
          content: "✅ You've been removed from the matchmaking queue.",
          flags: 64,
        })
        .catch((err) =>
          logger.warn("⚠️ Failed to send queue removal confirmation", {
            playerId,
            error: err.message,
          })
        );
    } catch (error) {
      logger.errorWrapper("❌ Error in remove_from_queue", error, { playerId });

      try {
        await interaction.followUp({
          content: "❌ An error occurred while leaving the queue.",
          flags: 64,
        });
      } catch (fallbackErr) {
        logger.errorWrapper(
          "❌ Failed to send queue error followUp",
          fallbackErr,
          { playerId }
        );
      }
    }
  },
};
