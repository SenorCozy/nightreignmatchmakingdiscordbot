const db = require("../../database");
const logger = require("../../logger");

const MODERATOR_ROLE_IDS = [
  process.env.TICKET_HANDLER_ROLE,
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
  process.env.BOT_ROLE,
].filter(Boolean);

module.exports = {
  customIdRegex: /^reject_submission_/,
  async execute(interaction) {
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const isMod = member.roles.cache.some((role) =>
        MODERATOR_ROLE_IDS.includes(role.id)
      );

      if (!isMod) {
        return interaction.reply({
          content: "🚫 You must be a moderator to review submissions.",
          flags: 64,
        });
      }

      const submissionId = interaction.customId.split("_").pop();
      const reviewerId = interaction.user.id;
      const now = Date.now();

      let submission;
      try {
        submission = await db.getAsync(
          `SELECT * FROM event_submissions WHERE submission_id = ?`,
          [submissionId]
        );
      } catch (err) {
        logger.errorWrapper("RejectSubmission_GetSubmission", err, {
          submissionId,
          reviewerId,
        });
        return interaction.reply({
          content: "❌ Failed to retrieve submission. Please try again.",
          flags: 64,
        });
      }

      if (!submission || submission.status !== "pending") {
        return interaction.reply({
          content: "❌ Submission already reviewed or invalid.",
          flags: 64,
        });
      }

      try {
        await db.runAsync(
          `UPDATE event_submissions
           SET status = 'rejected', reviewed_by = ?, reviewed_at = ?
           WHERE submission_id = ?`,
          [reviewerId, now, submissionId]
        );
      } catch (err) {
        logger.errorWrapper("RejectSubmission_UpdateStatus", err, {
          submissionId,
          reviewerId,
        });
        return interaction.reply({
          content: "❌ Failed to update submission status.",
          flags: 64,
        });
      }

      let participants = [];
      try {
        participants = await db.allAsync(
          `SELECT player_id FROM event_submission_participants WHERE submission_id = ?`,
          [submissionId]
        );
      } catch (err) {
        logger.errorWrapper("RejectSubmission_GetParticipants", err, {
          submissionId,
        });
      }

      const alertChannelId = process.env.QUEUE_ALERT_CHANNEL;
      const alertChannel =
        interaction.client.channels.cache.get(alertChannelId);
      const rejectedMentions = [];

      for (const { player_id } of participants) {
        logger.info("❌ Submission rejected for participant", {
          submissionId,
          playerId: player_id,
          eventId: submission.event_id,
          reviewerId,
        });
        rejectedMentions.push(`<@${player_id}>`);
      }

      if (alertChannel && rejectedMentions.length) {
        try {
          await alertChannel.send({
            content: `❌ **Submission Rejected**\n${rejectedMentions.join(
              ", "
            )}'s submission was rejected by <@${reviewerId}>.\nSubmission ID: \`${submissionId}\``,
          });
        } catch (err) {
          logger.errorWrapper("RejectSubmission_AlertChannelSend", err, {
            submissionId,
            alertChannelId,
          });
        }
      }

      try {
        await interaction.update({
          content: `❌ Submission rejected by <@${reviewerId}>.`,
          components: [],
        });
      } catch (err) {
        logger.errorWrapper("RejectSubmission_UpdateInteraction", err, {
          submissionId,
          reviewerId,
        });
      }
    } catch (err) {
      logger.errorWrapper("RejectSubmission_UnexpectedError", err, {
        userId: interaction.user?.id,
        customId: interaction.customId,
      });
      return interaction.reply({
        content: "❌ An unexpected error occurred.",
        flags: 64,
      });
    }
  },
};
