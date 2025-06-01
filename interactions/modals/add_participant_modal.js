const db = require("../../database");
const logger = require("../../logger");

module.exports = {
  customIdRegex: /^add_participant_modal_/,
  async execute(interaction) {
    const submissionId = interaction.customId.split("_").slice(-1)[0];
    const input = interaction.fields.getTextInputValue("participant_ids");

    const userIdRegex = /<@!?(\d+)>|(\d{17,20})/g;
    const matchedIds = [];
    let match;

    while ((match = userIdRegex.exec(input)) !== null) {
      const id = match[1] || match[2];
      if (id && !matchedIds.includes(id)) matchedIds.push(id);
    }

    if (matchedIds.length === 0) {
      return interaction.reply({
        content: "❌ No valid user IDs or mentions found.",
        flags: 64,
      });
    }

    const now = Date.now();
    let successCount = 0;
    let skipped = [];

    for (const userId of matchedIds) {
      try {
        await db.runAsync(
          `INSERT OR IGNORE INTO event_submission_participants (submission_id, player_id)
           VALUES (?, ?)`,
          [submissionId, userId]
        );
        successCount++;
      } catch (err) {
        logger.warn("❌ Failed to add participant", {
          submissionId,
          userId,
          error: err.message,
        });
        skipped.push(userId);
      }
    }

    logger.info("➕ Participants added", {
      submissionId,
      added: matchedIds,
      by: interaction.user.id,
    });

    await interaction.reply({
      content: `✅ Added ${successCount} participant(s). ${
        skipped.length ? `Skipped: ${skipped.join(", ")}` : ""
      }`,
      flags: 64,
    });
  },
};
