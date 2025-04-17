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
  clearPlayerStatistics,
  clearAllStatistics,
} = require("../utils/playerstatshelper");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clearstats")
    .setDescription("Clear statistics for a player or all players")
    .addSubcommand((sub) =>
      sub
        .setName("user")
        .setDescription("Clear stats for a specific player")
        .addUserOption((opt) =>
          opt
            .setName("target")
            .setDescription("Player to clear")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("all").setDescription("Clear all player statistics")
    ),

  async execute(interaction) {
    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "🚫 You do not have permission to use this command.",
        flags: 64,
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "user") {
      const target = interaction.options.getUser("target");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_clear_user_${target.id}`)
          .setLabel(`Yes, clear stats for ${target.username}`)
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        content: `⚠️ Are you sure you want to clear all statistics for <@${target.id}>?`,
        components: [row],
        flags: 64,
      });

      const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
        max: 1,
      });

      collector.on("collect", async (btnInteraction) => {
        if (!hasModRole(btnInteraction.member)) {
          return btnInteraction.reply({
            content: "🚫 You do not have permission to confirm this.",
            flags: 64,
          });
        }

        await clearPlayerStatistics(target.id);
        await btnInteraction.reply({
          content: `✅ Stats cleared for <@${target.id}>.`,
          flags: 64,
        });
      });

      collector.on("end", (collected) => {
        if (collected.size === 0) {
          interaction
            .followUp({
              content: "⌛ Clear request timed out.",
              flags: 64,
            })
            .catch(() => {});
        }
      });
    }

    if (subcommand === "all") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_clear_all_stats")
          .setLabel("Yes, clear ALL player statistics")
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        content:
          "⚠️ Are you sure you want to wipe all player statistics from the database?",
        components: [row],
        flags: 64,
      });

      const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
        max: 1,
      });

      collector.on("collect", async (btnInteraction) => {
        if (!hasModRole(btnInteraction.member)) {
          return btnInteraction.reply({
            content: "🚫 You do not have permission to confirm this.",
            flags: 64,
          });
        }

        await clearAllStatistics();
        await btnInteraction.reply({
          content: "✅ All player statistics have been cleared.",
          flags: 64,
        });
      });

      collector.on("end", (collected) => {
        if (collected.size === 0) {
          interaction
            .followUp({
              content: "⌛ Clear request timed out.",
              flags: 64,
            })
            .catch(() => {});
        }
      });
    }
  },
};
