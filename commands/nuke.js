const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const db = require("../database");

const { hasModRole } = require("../utils/permissions");
const {
  deleteBotThreadsAndVoiceChannels,
  clearDatabaseTables,
} = require("../utils/nukecleanup");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nuke")
    .setDescription(
      "Delete all active match data, threads, and voice channels (DEV ONLY)"
    ),

  async execute(interaction) {
    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "🚫 You do not have permission to use this command.",
        flags: 64,
      });
    }

    await interaction.reply({
      content:
        "⚠️ **WARNING:** This will wipe all active matches, voice channels, and queued players.\nStatistics will remain intact.\n\nPress **Confirm Nuke** below to proceed.",
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("confirm_nuke")
            .setLabel("Confirm Nuke")
            .setStyle(ButtonStyle.Danger)
        ),
      ],
      flags: 64,
    });

    const collector = interaction.channel.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 15000,
      max: 1,
    });

    collector.on("collect", async (btnInteraction) => {
      if (btnInteraction.customId !== "confirm_nuke") return;

      if (!hasModRole(btnInteraction.member)) {
        return btnInteraction.reply({
          content: "🚫 You do not have permission to confirm this action.",
          flags: 64,
        });
      }

      await btnInteraction.reply("🧹 Nuking in progress...");

      try {
        await deleteBotThreadsAndVoiceChannels(interaction.guild);
        await clearDatabaseTables();

        console.info("✅ /nuke completed successfully.");
      } catch (err) {
        console.error("❌ Error during /nuke:", err);
        await interaction.channel.send(
          "❌ An error occurred during the nuke process. Please check logs."
        );
      }
    });

    collector.on("end", (collected) => {
      if (collected.size === 0) {
        interaction.channel
          .send("⌛ Nuke confirmation timed out. No action was taken.")
          .catch(() => {});
      }
    });
  },
};
