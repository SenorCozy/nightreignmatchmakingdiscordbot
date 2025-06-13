const { handleDuoQueue } = require("../../utils/queueHandlers");
const logger = require("../../logger");

module.exports = {
  customId: "duo_yes",
  async execute(interaction) {
    const userId = interaction.user.id;

    logger.info("🎮 duo_yes triggered", {
      userId,
      customId: interaction.customId,
    });

    try {
      await handleDuoQueue(interaction);
    } catch (error) {
      logger.errorWrapper("❌ Error in duo_yes button", error, {
        userId,
        customId: interaction.customId,
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ Something went wrong while handling your duo request.",
            flags: 64,
          })
          .catch(() => {});
      }
    }
  },
};
