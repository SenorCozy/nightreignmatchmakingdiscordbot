const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");

const path = require("path");
const logger = require("../logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription("Display the matchmaking interface"),

  async execute(interaction) {
    try {
      await interaction.deferReply();

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

      const imagePath = path.join(__dirname, "../public/queue_guide.png");
      const file = new AttachmentBuilder(imagePath);

      const embed = new EmbedBuilder()
        .setTitle("🎮 Welcome to the Nightreign Matchmaking!")
        .setDescription(
          `**How it works**\n\n` +
            `**1.** Click **Enter Queue** below — you'll be prompted to select a platform.\n\n` +
            `**2.** Choose how to queue:\n` +
            `  • **Solo** — matched with two random players\n` +
            `  • **Duo** — enter one friend's Discord username\n` +
            `  • **Trio** — enter two Discord usernames for a full premade\n\n` +
            `**3.** You'll be placed into a private match thread to coordinate.\n\n` +
            `**4.** Your friends **must be in this server** to be added to queue.\n\n` +
            `**5.** If you leave while in a duo/trio, your teammates will remain in queue unless they leave too.\n\n` +
            `📈 **Progression is tracked and rewarded by using this system!**`
        )
        .setColor("#7289DA")
        .setImage("attachment://queue_guide.png");

      await interaction.editReply({
        embeds: [embed],
        components: [row],
        files: [file],
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
