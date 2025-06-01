const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const logger = require("../logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription("Display the matchmaking interface"),

  async execute(interaction) {
    try {
      await interaction.deferReply({});

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("join_queue")
          .setLabel("Enter Nightreign Matchmaking Queue")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("remove_from_queue")
          .setLabel("Remove me from Queue")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("check_queue_status")
          .setLabel("Check my Queue Status")
          .setStyle(ButtonStyle.Secondary)
      );

      const embed = new EmbedBuilder()
        .setTitle("🎮 Welcome to the Nightreign Matchmaking!")
        .setDescription("Click the button below to join the queue.")
        .setColor("#7289DA")
        .setThumbnail("https://your-image-link.com");

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
    } catch (err) {
      logger.errorWrapper("❌ Error in /start command", err, {
        userId: interaction.user.id,
      });

      const fallbackContent = {
        content: "❌ Failed to display matchmaking interface.",
        flags: 64,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(fallbackContent).catch((e) =>
          logger.warn("⚠️ Failed to send fallback editReply in /start", {
            error: e.message,
          })
        );
      } else {
        await interaction.reply(fallbackContent).catch((e) =>
          logger.warn("⚠️ Failed to send fallback reply in /start", {
            error: e.message,
          })
        );
      }
    }
  },
};
