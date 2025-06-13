// platformbuttons.js (updated)
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../../database");
const logger = require("../../logger");

const { getPlayerById } = require("../../utils/playerUtils");
const { playerPlatformSelection } = require("../../utils/globalState");

module.exports = {
  regex: /^platform_(pc|xbox|playstation)$/,

  async execute(interaction) {
    const { customId, user } = interaction;
    const playerId = user.id;
    const platform = customId.replace("platform_", "").toLowerCase();

    try {
      const queueLocked = await new Promise((resolve, reject) => {
        db.get(
          `SELECT value FROM settings WHERE key = 'queue_locked'`,
          [],
          (err, row) =>
            err ? reject(err) : resolve(row ? parseInt(row.value) : 0)
        );
      });

      if (queueLocked) {
        return interaction.reply({
          content:
            "🚫 **Queue entry is currently disabled.** Please wait until it is re-enabled.",
          flags: 64,
        });
      }

      playerPlatformSelection[playerId] = platform;
      logger.info("🎮 Platform selected", { playerId, platform });

      const player = await getPlayerById(playerId);

      if (player?.status === "queued") {
        const queueType =
          player.trioPartner1 && player.trioPartner2
            ? "Trio"
            : player.duoPartner
            ? "Duo"
            : "Solo";

        return interaction.reply({
          content: `You're already queued as **${queueType}** on platform **${player.platform}**.\nIf you'd like to change your queue status, please leave the queue and re-enter.`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("remove_from_queue")
                .setLabel("Leave Queue")
                .setStyle(ButtonStyle.Danger)
            ),
          ],
          flags: 64,
        });
      }

      return interaction.reply({
        content: "Would you like to queue solo, duo, or trio?",
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("duo_no")
              .setLabel("Queue Solo")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId("duo_yes")
              .setLabel("Queue with a Friend")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId("trio_yes")
              .setLabel("Queue as a Trio")
              .setStyle(ButtonStyle.Success)
          ),
        ],
        flags: 64,
      });
    } catch (error) {
      logger.errorWrapper(
        `❌ Error handling platform button (${customId})`,
        error,
        {
          playerId,
        }
      );

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: "❌ Something went wrong while selecting your platform.",
            flags: 64,
          });
        } else {
          await interaction.reply({
            content: "❌ Something went wrong while selecting your platform.",
            flags: 64,
          });
        }
      } catch (fallbackErr) {
        logger.warn("⚠️ Failed to send fallback platform error", {
          playerId,
          error: fallbackErr.message,
        });
      }
    }
  },
};
