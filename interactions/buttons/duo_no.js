const { showNightlordSelectMenu } = require("../../utils/nightlordSelect");
const logger = require("../../logger");

module.exports = {
  customId: "duo_no",
  async execute(interaction) {
    const userId = interaction.user.id;

    try {
      logger.info("🎮 duo_no triggered", {
        userId,
        customId: interaction.customId,
      });

      // Show boss selection instead of queuing immediately
      await showNightlordSelectMenu(interaction);
    } catch (error) {
      logger.errorWrapper("❌ Error in duo_no button", error, {
        userId,
        customId: interaction.customId,
      });

      const response = {
        content: "❌ Something went wrong while preparing your queue entry.",
        flags: 64,
      };

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(response).catch(() => {});
      } else {
        await interaction.followUp(response).catch(() => {});
      }
    }
  },
};
