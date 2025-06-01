const db = require("../../database");
const logger = require("../../logger");
const sendQueueStatusPrompt = require("../../utils/sendQueueStatusPrompt");
const {
  unlockAchievementIfNotEarned,
} = require("../../utils/achievementHelpers");

module.exports = {
  customIdRegex: /^leave_queue_\d+$/,

  async execute(interaction) {
    const partnerId = interaction.customId.replace("leave_queue_", "");
    const userId = interaction.user.id;

    if (userId !== partnerId) {
      return interaction
        .reply({
          content: "❌ This button is not meant for you.",
          flags: 64,
        })
        .catch((err) =>
          logger.warn("⚠️ Failed to send unauthorized button warning", {
            userId,
            error: err.message,
          })
        );
    }

    await interaction.deferUpdate().catch((err) =>
      logger.warn("⚠️ Failed to defer leave_queue interaction", {
        userId,
        error: err.message,
      })
    );

    try {
      const player = await db.getAsync(`SELECT * FROM players WHERE id = ?`, [
        partnerId,
      ]);

      if (!player || player.status !== "queued") {
        return interaction
          .followUp({
            content: "⚠️ You're no longer in the queue — nothing to do.",
            flags: 64,
          })
          .catch((err) =>
            logger.warn("⚠️ Failed to send not-in-queue notice", {
              userId,
              error: err.message,
            })
          );
      }

      const guild = interaction.guild;

      // ✅ Handle active trio association
      const activeTrio = await db.getAsync(
        `SELECT * FROM trio_partner_groups 
         WHERE active = 1 AND (player1_id = ? OR player2_id = ? OR player3_id = ?)`,
        [partnerId, partnerId, partnerId]
      );

      if (activeTrio) {
        const trioIds = [
          activeTrio.player1_id,
          activeTrio.player2_id,
          activeTrio.player3_id,
        ];
        const remaining = trioIds.filter((id) => id !== partnerId);

        // Mark trio inactive
        await db.runAsync(
          `UPDATE trio_partner_groups SET active = 0 WHERE trio_id = ?`,
          [activeTrio.trio_id]
        );

        logger.info("🧯 Trio disbanded via leave_queue", {
          trio_id: activeTrio.trio_id,
          leaver: partnerId,
        });

        for (const otherId of remaining) {
          await db.runAsync(
            `UPDATE players SET duoPartner = NULL WHERE id = ?`,
            [otherId]
          );
          await sendQueueStatusPrompt(guild, otherId, "trio");
        }
        await unlockAchievementIfNotEarned(partnerId, "leave_trio");
      }

      // ✅ Handle duo unlink
      if (player.duoPartner) {
        const duoPartnerId = player.duoPartner;

        await db.runAsync(
          `UPDATE players SET duoPartner = NULL WHERE id IN (?, ?)`,
          [partnerId, duoPartnerId]
        );

        logger.info("🔗 Duo unlinked via leave_queue", {
          playerId: partnerId,
          partnerId: duoPartnerId,
        });

        await sendQueueStatusPrompt(guild, duoPartnerId, "duo");
        await unlockAchievementIfNotEarned(partnerId, "leave_duo");
      }

      // ✅ Mark player as left
      await db.runAsync(
        `UPDATE players SET status = 'left', last_queue_exit_at = ? WHERE id = ?`,
        [Date.now(), partnerId]
      );

      logger.info("✅ Player left queue via leave_queue", {
        playerId: partnerId,
      });

      return interaction
        .followUp({
          content: "✅ You have successfully left the queue.",
          flags: 64,
        })
        .catch((err) =>
          logger.warn("⚠️ Failed to confirm queue departure", {
            userId,
            error: err.message,
          })
        );
    } catch (error) {
      logger.errorWrapper("❌ Error handling leave_queue_<id>", error, {
        userId,
        partnerId,
      });

      try {
        await interaction.followUp({
          content: "❌ An error occurred while leaving the queue.",
          flags: 64,
        });
      } catch (fallbackErr) {
        logger.warn("❌ Failed to send queue error fallback", {
          userId,
          error: fallbackErr.message,
        });
      }
    }
  },
};
