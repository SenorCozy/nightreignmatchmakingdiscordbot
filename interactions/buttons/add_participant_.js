const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const logger = require("../../logger");

module.exports = {
  customIdRegex: /^add_participant_/,

  async execute(interaction) {
    try {
      const submissionId = interaction.customId.split("_").pop();

      const modal = new ModalBuilder()
        .setCustomId(`add_participant_modal_${submissionId}`)
        .setTitle("➕ Add Group Participants");

      const input = new TextInputBuilder()
        .setCustomId("participant_ids")
        .setLabel("Enter user IDs or mentions (comma separated)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder("e.g. 1234567890, <@9876543210>");

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);
    } catch (error) {
      logger.errorWrapper("❌ Failed to show add_participant modal", error, {
        userId: interaction.user.id,
        customId: interaction.customId,
      });

      await interaction
        .reply({
          content: "❌ An error occurred while opening the modal.",
          flags: 64,
        })
        .catch(() => {});
    }
  },
};
