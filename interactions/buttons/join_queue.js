const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const {
  isPlayerInActiveMatch,
} = require("../../utils/matchmakingUtils/matchUtils");
const db = require("../../database");

module.exports = {
  customId: "join_queue",

  async execute(interaction) {
    const playerId = interaction.user.id;

    try {
      // Check if queue is locked
      const queueLocked = await new Promise((resolve, reject) => {
        db.get(
          `SELECT value FROM settings WHERE key = 'queue_locked'`,
          [],
          (err, row) => (err ? reject(err) : resolve(row?.value || "0"))
        );
      });

      if (parseInt(queueLocked) === 1) {
        return interaction.reply({
          content: "🚫 **Queue entry is currently disabled.**",
          flags: 64,
        });
      }

      // Check if blacklisted
      const isBlacklisted = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM blacklist WHERE id = ?`,
          [playerId],
          (err, row) => (err ? reject(err) : resolve(!!row))
        );
      });

      if (isBlacklisted) {
        return interaction.reply({
          content: "🚫 You are blacklisted and cannot queue.",
          flags: 64,
        });
      }

      // Already in match?
      if (await isPlayerInActiveMatch(playerId)) {
        return interaction.reply({
          content: "You are already in an active match!",
          flags: 64,
        });
      }

      // Show platform buttons
      const platformButtons = [
        new ButtonBuilder()
          .setCustomId("platform_playstation")
          .setLabel("PlayStation")
          .setEmoji("<:ps:972112725448724480>")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("platform_xbox")
          .setLabel("Xbox")
          .setEmoji("<:xbox_round:972112725352276018>")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("platform_pc")
          .setLabel("PC")
          .setEmoji("<:steam_pr:958049880188805220>")
          .setStyle(ButtonStyle.Secondary),
      ];

      return interaction.reply({
        content: "Which platform would you like to queue on?",
        components: [new ActionRowBuilder().addComponents(platformButtons)],
        flags: 64,
      });
    } catch (error) {
      console.error("join_queue error:", error.message);
      return interaction.reply({
        content: "❌ Something went wrong while joining the queue.",
        flags: 64,
      });
    }
  },
};
