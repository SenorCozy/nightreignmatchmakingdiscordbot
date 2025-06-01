const { handleDuoQueueModal } = require("../../utils/queueHandlers");
const logger = require("../../logger");

module.exports = {
  customId: "duo_partner_modal",

  async execute(interaction) {
    try {
      logger.info("📥 Modal received", {
        user: interaction.user.tag,
        customId: interaction.customId,
      });
      await handleDuoQueueModal(interaction);
    } catch (err) {
      logger.errorWrapper("❌ Failed to execute duo_partner_modal", err, {
        user: interaction.user.tag,
        customId: interaction.customId,
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ Something went wrong while handling the modal.",
            flags: 64,
          })
          .catch(() => {});
      }
    }
  },
};
