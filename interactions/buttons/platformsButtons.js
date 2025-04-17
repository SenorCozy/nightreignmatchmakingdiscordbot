const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../../database");

const { getPlayerById } = require("../utils/playerUtils");
const { playerPlatformSelection } = require("../utils/globalState");

module.exports = {
  regex: /^platform_(pc|xbox|playstation)$/,
  async execute(interaction) {
    const { customId, user } = interaction;
    const playerId = user.id;
    const platform = customId.replace("platform_", "").toLowerCase();

    try {
      // ✅ Check if queue is locked
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

      // ✅ Store platform selection using shared global state
      playerPlatformSelection[playerId] = platform;

      const player = await getPlayerById(playerId);

      if (player) {
        const queueType = player.duoPartner ? "Duo" : "Solo";
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

      // ✅ Prompt for solo or duo queue type
      return interaction.reply({
        content: "Would you like to queue solo or with a friend?",
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("duo_no")
              .setLabel("Queue Solo")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId("duo_yes")
              .setLabel("Queue with a Friend")
              .setStyle(ButtonStyle.Primary)
          ),
        ],
        flags: 64,
      });
    } catch (error) {
      logger.error(`❌ Error handling platform button (${customId}):`, error);
      return interaction.reply({
        content: "❌ Something went wrong while selecting your platform.",
        flags: 64,
      });
    }
  },
};
