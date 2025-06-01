const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");

module.exports = {
  customIdRegex: /^add_participant_/,
  async execute(interaction) {
    const submissionId = interaction.customId.split("_").slice(-1)[0];

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
  },
};
