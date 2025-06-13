const { handleTrioQueue } = require("../../utils/queueHandlers");
const logger = require("../../logger");

module.exports = {
  customId: "trio_yes",
  async execute(interaction) {
    const userId = interaction.user.id;

    logger.info("🎮 trio_yes triggered", {
      userId,
      customId: interaction.customId,
    });

    try {
      await handleTrioQueue(interaction);
    } catch (error) {
      logger.errorWrapper("❌ Error in trio_yes button", error, {
        userId,
        customId: interaction.customId,
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content:
              "❌ Something went wrong while handling your trio request.",
            flags: 64,
          })
          .catch(() => {});
      }
    }
  },
};
