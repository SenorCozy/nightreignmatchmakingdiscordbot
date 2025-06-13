const { NIGHTLORD_CHOICES } = require("../../utils/nightlordSelect");
const db = require("../../database");
const logger = require("../../logger");

module.exports = {
  customId: "update_shared_nightlords",

  async execute(interaction) {
    const thread = interaction.channel;
    const userId = interaction.user.id;
    const raw = interaction.values;

    const selected = raw.includes("select_all")
      ? NIGHTLORD_CHOICES.filter((opt) => opt.value !== "select_all").map(
          (opt) => opt.value
        )
      : raw;

    if (!selected || selected.length === 0) {
      return interaction.reply({
        content: "❌ You must select at least one Nightlord.",
        flags: 64,
      });
    }

    try {
      const match = await db.getAsync(
        `SELECT match_id FROM matches WHERE thread_id = ?`,
        [thread.id]
      );

      if (!match) {
        return interaction.reply({
          content: "❌ No active match found.",
          flags: 64,
        });
      }

      await db.runAsync(
        `UPDATE matches SET shared_nightlords = ? WHERE match_id = ?`,
        [JSON.stringify(selected), match.match_id]
      );

      return interaction.update({
        content: `✅ Match Nightlord preferences updated to: \`${selected.join(
          ", "
        )}\`\nYou may now run /search or press Find Replacements.`,
        components: [],
      });
    } catch (err) {
      logger.errorWrapper("❌ Failed to update shared_nightlords", err, {
        userId,
        threadId: thread.id,
        selected,
      });

      return interaction.reply({
        content: "❌ Something went wrong while updating preferences.",
        flags: 64,
      });
    }
  },
};
