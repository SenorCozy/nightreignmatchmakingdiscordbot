const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription("Display the matchmaking interface"),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      // Defer the reply first to prevent timeout

      const buttonJoin = new ButtonBuilder()
        .setCustomId("join_queue")
        .setLabel("Enter Nightreign Matchmaking Queue")
        .setStyle(ButtonStyle.Primary);

      const buttonRemove = new ButtonBuilder()
        .setCustomId("remove_from_queue")
        .setLabel("Remove me from Queue")
        .setStyle(ButtonStyle.Danger);

      const buttonCheckStatus = new ButtonBuilder()
        .setCustomId("check_queue_status")
        .setLabel("Check my Queue Status")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(
        buttonJoin,
        buttonRemove,
        buttonCheckStatus
      );

      const embed = new EmbedBuilder()
        .setTitle("Welcome to the Nightreign Matchmaking!")
        .setDescription(
          "Click the button below to enter the matchmaking queue."
        )
        .setColor("#7289DA")
        .setThumbnail("https://your-image-link.com");

      // Edit the deferred reply
      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [embed],
          components: [row],
        });
      } else {
        await interaction.reply({
          embeds: [embed],
          components: [row],
          flags: 64, // Optional: make it ephemeral if needed
        });
      }
    } catch (err) {
      console.error("❌ Error in /start:", err);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(
          "❌ Failed to display matchmaking interface."
        );
      } else {
        await interaction.reply({
          content: "❌ Failed to display matchmaking interface.",
          ephemeral: true,
        });
      }
    }
  },
};
