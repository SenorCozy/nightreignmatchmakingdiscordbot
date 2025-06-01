const { handleSoloQueue } = require("../../utils/queueHandlers");
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

      await handleSoloQueue(interaction);
    } catch (error) {
      logger.errorWrapper("❌ Error in duo_no button", error, {
        userId,
        customId: interaction.customId,
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content:
              "❌ Something went wrong while processing your solo queue request.",
            flags: 64,
          })
          .catch(() => {});
      } else {
        await interaction
          .followUp({
            content:
              "❌ Something went wrong while processing your solo queue request.",
            flags: 64,
          })
          .catch(() => {});
      }
    }
  },
};
