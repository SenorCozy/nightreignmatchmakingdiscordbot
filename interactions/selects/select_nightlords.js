const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const db = require("../../database");
const logger = require("../../logger");
const { incrementBotStatistic } = require("../../utils/statistics");
const { NIGHTLORD_CHOICES } = require("../../utils/nightlordSelect");

module.exports = {
  customId: "select_nightlords",

  async execute(interaction) {
    const raw = interaction.values;
    const selected = raw.includes("select_all")
      ? NIGHTLORD_CHOICES.filter((opt) => opt.value !== "select_all").map(
          (opt) => opt.value
        )
      : raw;

    const playerId = interaction.user.id;

    if (!selected || selected.length === 0) {
      return interaction.reply({
        content: "❌ You must select at least one Nightlord.",
        flags: 64,
      });
    }

    try {
      await db.runAsync(
        `INSERT INTO queue_preferences (player_id, nightlords, selected_at)
         VALUES (?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET nightlords = excluded.nightlords, selected_at = excluded.selected_at`,
        [playerId, selected.join(","), Date.now()]
      );

      for (const boss of selected) {
        await incrementBotStatistic(`nl_${boss}`);
      }

      const vcSelect = new StringSelectMenuBuilder()
        .setCustomId("select_vc")
        .setPlaceholder("Are you willing to use voice chat?")
        .addOptions([
          { label: "Yes – I'm okay with VC", value: "vc_yes" },
          { label: "No – I'd prefer not to VC", value: "vc_no" },
        ]);

      const row = new ActionRowBuilder().addComponents(vcSelect);

      await interaction.update({
        content: "🎧 Now, are you okay using voice chat for this match?",
        components: [row],
      });
    } catch (err) {
      logger.errorWrapper("❌ select_nightlords execution failed", err, {
        playerId,
        selected,
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content:
              "❌ Something went wrong while saving your Nightlord preferences.",
            flags: 64,
          })
          .catch(() => {});
      }
    }
  },
};
