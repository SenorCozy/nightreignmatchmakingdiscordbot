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
            `**1.** Click **Enter Queue** below — you'll choose your platform and queue type.\n\n` +
            `**2.** Choose your **Queue Type**:\n` +
            `  • **Solo** — matched with two other solo players or duos\n` +
            `  • **Duo** — enter your friend's Discord username (they must be in this server)\n` +
            `  • **Trio** — enter two Discord usernames for a full premade (must be in the server)\n\n` +
            `**3.** Select your **Nightlords** — you'll only be matched with others who share at least one similar preference.\n` +
            `  • The more you select, the faster you'll match.\n` +
            `  • **ONLY SELECT Nightlords you are currently able to fight!**\n\n` +
            `**4.** Choose your **Voice Chat (VC) preference** — matches will prioritize this if possible.\n` +
            `  • If queues are low, VC preference may be ignored.\n\n` +
            `**5.** Once matched, you'll enter a private match thread to coordinate.\n\n` +
            `🎁 **Stats, achievements, and rewards** are tracked by participating in the system!\n\n` +
            `⚠️ If you leave the queue as a duo or trio, your teammates will stay queued unless they leave too.\n`
        )
        .setColor("#8f72da")
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
