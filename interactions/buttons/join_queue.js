const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const {
  isPlayerInActiveMatch,
} = require("../../utils/matchmakingUtils/matchUtils");
const { getPlayerById } = require("../../utils/playerUtils");
const db = require("../../database");
const logger = require("../../logger");

module.exports = {
  customId: "join_queue",

  async execute(interaction) {
    const playerId = interaction.user.id;

    try {
      // ✅ Check if queue is locked
      const queueLocked = await new Promise((resolve, reject) => {
        db.get(
          `SELECT value FROM settings WHERE key = 'queue_locked'`,
          [],
          (err, row) => (err ? reject(err) : resolve(row?.value || "0"))
        );
      });

      if (parseInt(queueLocked) === 1) {
        logger.info("🚫 Queue is locked — blocking join", { playerId });
        return interaction.reply({
          content: "🚫 **Queue entry is currently disabled.**",
          flags: 64,
        });
      }

      // ✅ Check if user is blacklisted
      const isBlacklisted = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM blacklist WHERE id = ?`,
          [playerId],
          (err, row) => (err ? reject(err) : resolve(!!row))
        );
      });

      if (isBlacklisted) {
        logger.info("🚫 Blacklisted user attempted to queue", { playerId });
        return interaction.reply({
          content: "🚫 You are blacklisted and cannot queue.",
          flags: 64,
        });
      }

      // ✅ Check if user is in an active match
      const alreadyInMatch = await isPlayerInActiveMatch(playerId);
      if (alreadyInMatch) {
        logger.info("⚠️ User already in active match attempted to queue", {
          playerId,
        });
        return interaction.reply({
          content: "You are already in an active match!",
          flags: 64,
        });
      }

      // ✅ Check if user is already in the queue (status = 'queued')
      const existing = await getPlayerById(playerId);
      if (existing?.status === "queued") {
        logger.info("⚠️ User already in queue attempted to queue again", {
          playerId,
        });
        return interaction.reply({
          content:
            "⚠️ You're already in the matchmaking queue. Use the **Leave Queue** button if you wish to cancel.",
          flags: 64,
        });
      }

      // ✅ Prompt platform selection
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

      logger.info("🎮 Prompting platform selection", { playerId });

      return interaction.reply({
        content: "Which platform would you like to queue on?",
        components: [new ActionRowBuilder().addComponents(platformButtons)],
        flags: 64,
      });
    } catch (error) {
      logger.errorWrapper("❌ Error handling join_queue", error, { playerId });

      try {
        return interaction.reply({
          content: "❌ Something went wrong while joining the queue.",
          flags: 64,
        });
      } catch (fallbackErr) {
        logger.warn("⚠️ Failed to send fallback error message", {
          playerId,
          error: fallbackErr.message,
        });
      }
    }
  },
};
