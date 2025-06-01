// buttons/trio_yes.js
const { handleTrioQueue } = require("../../utils/queueHandlers");
const logger = require("../../logger");

module.exports = {
  customId: "trio_yes",

  async execute(interaction) {
    const userId = interaction.user.id;

    try {
      logger.info("🎮 trio_yes triggered", {
        userId,
        customId: interaction.customId,
      });

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
              "❌ Something went wrong while processing your trio queue request.",
            flags: 64,
          })
          .catch(() => {});
      } else {
        await interaction
          .followUp({
            content:
              "❌ Something went wrong while processing your trio queue request.",
            flags: 64,
          })
          .catch(() => {});
      }
    }
  },
};
