const {
  handleReadyConfirmation,
} = require("../../utils/handleReadyConfirmation");

module.exports = {
  customId: "confirm_ready",
  async execute(interaction) {
    await interaction.deferUpdate().catch(() => {});
    await handleReadyConfirmation(
      interaction.channel,
      interaction.user.id,
      "button",
      interaction
    );
  },
};
