const { handleSoloQueue } = require("../../utils/queueHandlers");
const db = require("../../database");
const logger = require("../../logger");
const { incrementBotStatistic } = require("../../utils/statistics");

module.exports = {
  customId: "select_vc",
  async execute(interaction) {
    const playerId = interaction.user.id;
    const choice = interaction.values?.[0];

    if (!choice || (choice !== "vc_yes" && choice !== "vc_no")) {
      return interaction.reply({
        content: "❌ Invalid voice chat preference selected.",
        flags: 64,
      });
    }

    const wantsVC = choice === "vc_yes" ? 1 : 0;

    try {
      await db.runAsync(
        `UPDATE queue_preferences SET vc_ok = ?, selected_at = ? WHERE player_id = ?`,
        [wantsVC, Date.now(), playerId]
      );
      await incrementBotStatistic(wantsVC ? "vc_pref_yes" : "vc_pref_no");

      logger.info("🎧 Voice preference recorded", {
        playerId,
        wantsVC,
      });

      await handleSoloQueue(interaction);
    } catch (err) {
      logger.errorWrapper("❌ Failed to record VC preference", err, {
        playerId,
        wantsVC,
      });

      return interaction.reply({
        content:
          "❌ Something went wrong while saving your VC preference. Please try again.",
        flags: 64,
      });
    }
  },
};
