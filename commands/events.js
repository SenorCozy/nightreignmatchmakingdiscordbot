// commands/events.js
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

        const progressValue = progress?.progress || 0;
        const completed =
          progress?.completed === 1
            ? "✅ Completed"
            : `${progressValue} / ${event.goal_target}`;

        embed.addFields({
          name: `📌 ${event.name}`,
          value: `${
            event.description || "No description"
          }\n**Progress:** ${completed}`,
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
