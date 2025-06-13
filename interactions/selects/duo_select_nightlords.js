const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const db = require("../../database");
const logger = require("../../logger");
const { incrementBotStatistic } = require("../../utils/statistics");
const { NIGHTLORD_CHOICES } = require("../../utils/showDuoPreferenceMenus");

module.exports = {
  customIdRegex: /^duo_select_nightlords:(\d+):(\d+)$/,
  async execute(interaction) {
    const match = interaction.customId.match(
      /^duo_select_nightlords:(\d+):(\d+)$/
    );
    if (!match) return;

    const [_, userId1, userId2] = match;
    const raw = interaction.values;
    const selectedBosses = raw.includes("select_all")
      ? NIGHTLORD_CHOICES.filter((opt) => opt.value !== "select_all").map(
          (opt) => opt.value
        )
      : raw;

    const timestamp = Date.now();

    if (!selectedBosses || selectedBosses.length === 0) {
      return interaction.reply({
        content: "❌ You must select at least one Nightlord.",
        flags: 64,
      });
    }

    const selected = selectedBosses.join(",");

    try {
      // ✅ Parallel update for queue_preferences
      await Promise.all([
        db.runAsync(
          `INSERT INTO queue_preferences (player_id, nightlords, selected_at)
           VALUES (?, ?, ?)
           ON CONFLICT(player_id) DO UPDATE SET nightlords = excluded.nightlords, selected_at = excluded.selected_at`,
          [userId1, selected, timestamp]
        ),
        db.runAsync(
          `INSERT INTO queue_preferences (player_id, nightlords, selected_at)
           VALUES (?, ?, ?)
           ON CONFLICT(player_id) DO UPDATE SET nightlords = excluded.nightlords, selected_at = excluded.selected_at`,
          [userId2, selected, timestamp]
        ),
      ]);

      for (const boss of selectedBosses) {
        await incrementBotStatistic(`nl_${boss}`);
      }

      logger.info("✅ Nightlord preferences saved for duo", {
        userId1,
        userId2,
        selectedBosses,
      });

      const vcSelect = new StringSelectMenuBuilder()
        .setCustomId(`duo_select_vc:${userId1}:${userId2}`)
        .setPlaceholder("Are you both okay with voice chat?")
        .addOptions([
          { label: "Yes – We're okay with VC", value: "vc_yes" },
          { label: "No – We'd prefer not to VC", value: "vc_no" },
        ]);

      const row = new ActionRowBuilder().addComponents(vcSelect);

      // Prefer `update()` but fall back safely
      if (
        interaction.isMessageComponent() &&
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction.update({
          content: "🎧 Are you and your partner okay using voice chat?",
          components: [row],
        });
      } else {
        await interaction
          .followUp({
            content: "🎧 Are you and your partner okay using voice chat?",
            components: [row],
            flags: 64,
          })
          .catch(() => {});
      }
    } catch (err) {
      logger.errorWrapper("❌ Failed to save duo nightlord preferences", err, {
        userId1,
        userId2,
        selectedBosses,
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Something went wrong saving your preferences.",
          flags: 64,
        });
      }
    }
  },
};
