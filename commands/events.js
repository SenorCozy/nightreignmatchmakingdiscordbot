const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const db = require("../database");
const logger = require("../logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("events")
    .setDescription("View active challenges and your progress."),
  async execute(interaction) {
    try {
      const playerId = interaction.user.id;
      const now = Date.now();

      const activeEvents = await db.allAsync(
        `SELECT * FROM events WHERE active = 1 AND start_time <= ? AND end_time >= ?`,
        [now, now]
      );

      if (activeEvents.length === 0) {
        return interaction.reply({
          content: "📭 There are no active events right now.",
          flags: 64,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("🎯 Active Events")
        .setColor(0x00b0f4);

      for (const event of activeEvents) {
        const progress = await db.getAsync(
          `SELECT progress, completed FROM event_progress WHERE player_id = ? AND event_id = ?`,
          [playerId, event.event_id]
        );

        const progressValue = progress?.progress ?? 0;

        // Detect if this is a tier-based event (goal_target is null)
        const isTiered = event.goal_target === null;

        let progressDisplay = "";
        let rewardDisplay = "";
        let tierProgressDisplay = "";

        if (isTiered) {
          const tiers = await db.allAsync(
            `SELECT * FROM event_tiers WHERE event_id = ? ORDER BY tier_index ASC`,
            [event.event_id]
          );

          const completedTiers = tiers.filter(
            (tier) => tier.goal_target <= progressValue
          );

          const nextTier = tiers.find(
            (tier) => tier.goal_target > progressValue
          );

          if (nextTier) {
            progressDisplay = `${progressValue} / ${nextTier.goal_target} (Tier ${nextTier.tier_index})`;
            rewardDisplay =
              [
                nextTier.currency_reward
                  ? `💰 ${nextTier.currency_reward}`
                  : null,
                nextTier.match_point_reward
                  ? `🏅 ${nextTier.match_point_reward}`
                  : null,
              ]
                .filter(Boolean)
                .join(" + ") || "—";
          } else {
            progressDisplay = "✅ All tiers completed";
            rewardDisplay = "—";
          }

          tierProgressDisplay = `\n**Tiers Completed:** ${completedTiers.length} / ${tiers.length}`;
        } else {
          progressDisplay =
            progress?.completed === 1
              ? "✅ Completed"
              : `${progressValue} / ${event.goal_target}`;
          rewardDisplay =
            [
              event.currency_reward ? `💰 ${event.currency_reward}` : null,
              event.match_point_reward
                ? `🏅 ${event.match_point_reward}`
                : null,
            ]
              .filter(Boolean)
              .join(" + ") || "None";
        }

        const cooldownDisplay = event.cooldown_ms
          ? `${Math.floor(event.cooldown_ms / 60000)} min`
          : "None";

        embed.addFields({
          name: `📌 ${event.name}`,
          value: `${
            event.description || "*No description provided.*"
          }\n**Progress:** ${progressDisplay}${tierProgressDisplay}\n**Rewards:** ${rewardDisplay}\n**Cooldown:** ${cooldownDisplay}\n**Ends:** <t:${Math.floor(
            event.end_time / 1000
          )}:R>`,
        });
      }

      await interaction.reply({ embeds: [embed], flags: 64 });
    } catch (error) {
      logger.errorWrapper("EventCommandError", error);
      await interaction.reply({
        content: "❌ Something went wrong while fetching event data.",
        flags: 64,
      });
    }
  },
};
