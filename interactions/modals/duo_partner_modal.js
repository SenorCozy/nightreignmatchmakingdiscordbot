const { handleDuoQueueModal } = require("../../utils/queueHandlers");

module.exports = {
  customId: "duo_partner_modal",

  async execute(interaction) {
    try {
      console.log(`📥 Modal received from ${interaction.user.tag}`);
      await handleDuoQueueModal(interaction);
    } catch (err) {
      console.error("❌ Failed to execute modal handler:", err);
      if (!interaction.replied) {
        await interaction.reply({
          content: "❌ Something went wrong while handling the modal.",
          ephemeral: true,
        });
      }
    }
  },
};
