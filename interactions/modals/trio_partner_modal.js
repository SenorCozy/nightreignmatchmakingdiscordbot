const { handleTrioQueueModal } = require("../../utils/queueHandlers");
const logger = require("../../logger");

module.exports = {
  customId: "trio_partner_modal",

  async execute(interaction) {
    try {
      logger.info("📥 Trio modal received", {
        user: interaction.user.tag,
        customId: interaction.customId,
      });

      await handleTrioQueueModal(interaction);
    } catch (err) {
      logger.errorWrapper("❌ Failed to execute trio_partner_modal", err, {
        user: interaction.user.tag,
        customId: interaction.customId,
      });

      const errorReply = {
        content: "❌ Something went wrong while handling the modal.",
        flags: 64,
      };

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(errorReply).catch(() => {});
      } else {
        await interaction.followUp(errorReply).catch(() => {});
      }
    }
  },
};
