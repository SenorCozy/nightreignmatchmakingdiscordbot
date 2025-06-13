const db = require("../../database");
const logger = require("../../logger");
const { evaluateEventProgress } = require("../../utils/eventUtils");
const { checkCurrencyAchievements } = require("../../utils/achievementHelpers");

const MODERATOR_ROLE_IDS = [
  process.env.TICKET_HANDLER_ROLE,
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
  process.env.BOT_ROLE,
].filter(Boolean);

module.exports = {
  customIdRegex: /^approve_submission_/,
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

      const submission = await db.getAsync(
        `SELECT * FROM event_submissions WHERE submission_id = ?`,
        [submissionId]
      );

      if (!submission || submission.status !== "pending") {
        return interaction.reply({
          content: "❌ Submission already reviewed or invalid.",
          flags: 64,
        });
      }

      const event = await db.getAsync(
        `SELECT currency_reward, match_point_reward FROM events WHERE event_id = ?`,
        [submission.event_id]
      );

      if (!event) {
        return interaction.reply({
          content: "❌ Event not found. Cannot approve submission.",
          flags: 64,
        });
      }

      const { currency_reward = 0, match_point_reward = 0 } = event;

      await db.runAsync(
        `UPDATE event_submissions
         SET status = 'approved', reviewed_by = ?, reviewed_at = ?
         WHERE submission_id = ?`,
        [reviewerId, now, submissionId]
      );

      const participants = await db.allAsync(
        `SELECT player_id FROM event_submission_participants WHERE submission_id = ?`,
        [submissionId]
      );

      const alertChannelId = process.env.QUEUE_ALERT_CHANNEL;
      const alertChannel =
        interaction.client.channels.cache.get(alertChannelId);
      const awardedMentions = [];

      for (const { player_id } of participants) {
        try {
          // 💰 Award currency
          if (currency_reward > 0) {
            await db.runAsync(
              `INSERT INTO player_currency (player_id, balance)
               VALUES (?, ?)
               ON CONFLICT(player_id) DO UPDATE SET balance = balance + ?`,
              [player_id, currency_reward, currency_reward]
            );

            await db.runAsync(
              `INSERT INTO currency_audit (
                player_id, amount_changed, source, source_id,
                modified_by, modified_at, reason
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                player_id,
                currency_reward,
                "event",
                submission.event_id,
                reviewerId,
                now,
                `Approved submission ${submissionId}`,
              ]
            );
          }

          // 🏅 Award match completion points
          if (match_point_reward > 0) {
            await db.runAsync(
              `INSERT INTO match_completion_awards (
                match_id, player_id, awarded_at, points, modified_by, action_type
              ) VALUES (?, ?, ?, ?, ?, ?)`,
              [
                `submission:${submissionId}`,
                player_id,
                now,
                match_point_reward,
                reviewerId,
                "event_submission",
              ]
            );
          }

          // ⏱ Trigger async checks
          setImmediate(() => {
            if (currency_reward > 0) {
              checkCurrencyAchievements(player_id, db).catch((err) =>
                logger.errorWrapper("Currency achievement check failed", err, {
                  playerId: player_id,
                })
              );
            }

            evaluateEventProgress(player_id, "manual_submission", 1, {
              event_id: submission.event_id,
              submission_id: submission.submission_id,
            }).catch((err) =>
              logger.errorWrapper("Event progress check failed", err, {
                playerId: player_id,
              })
            );
          });

          logger.info("✅ Submission reward granted", {
            submissionId,
            playerId: player_id,
            eventId: submission.event_id,
            reviewerId,
            currency: currency_reward,
            matchPoints: match_point_reward,
          });

          awardedMentions.push(`<@${player_id}>`);
        } catch (err) {
          logger.error(
            "❌ Error processing participant reward or event progress",
            {
              playerId: player_id,
              error: err,
              submissionId,
              eventId: submission.event_id,
            }
          );
        }
      }

      // 📢 Send approval notice
      if (alertChannel && awardedMentions.length) {
        await alertChannel.send({
          content:
            `✅ **Submission Approved**\n${awardedMentions.join(
              ", "
            )} were awarded:` +
            (currency_reward > 0 ? ` **${currency_reward} coins**` : "") +
            (currency_reward > 0 && match_point_reward > 0 ? " and" : "") +
            (match_point_reward > 0
              ? ` **${match_point_reward} match points**`
              : "") +
            `.\nSubmission ID: \`${submissionId}\``,
        });
      }

      await interaction.update({
        content: `✅ Approved and awarded rewards to: ${awardedMentions.join(
          ", "
        )}`,
        components: [],
      });
    } catch (err) {
      logger.error("❌ Failed to approve submission", {
        error: err,
        customId: interaction.customId,
        userId: interaction.user.id,
      });

      await interaction.reply({
        content: "❌ An error occurred while approving the submission.",
        flags: 64,
      });
    }
  },
};
