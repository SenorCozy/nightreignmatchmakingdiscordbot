const {
  getQueuePosition,
  calculateAverageQueueTime,
  getPlayerById,
} = require("../../utils/playerUtils");
const db = require("../../database");
const logger = require("../../logger");

module.exports = {
  customId: "check_queue_status",

  async execute(interaction) {
    const { user } = interaction;
    const playerId = user.id;

    try {
      const player = await getPlayerById(playerId);

      if (!player) {
        return interaction.reply({
          content: "You're not in the queue or a match.",
          flags: 64,
        });
      }

      const platform = player.platform?.toUpperCase() || "Unknown";

      if (player.status === "active") {
        return interaction.reply({
          content: `⚔️ You are currently in an **active match** on **${platform}**.`,
          flags: 64,
        });
      }

      if (player.status !== "queued") {
        return interaction.reply({
          content: `ℹ️ You are not currently in the matchmaking queue.`,
          flags: 64,
        });
      }

      let queueType = "Solo";
      let details = `🔹 **Platform:** ${platform}\n`;

      // 🧑‍🤝‍🧑 Duo Check
      if (player.duoPartner) {
        const partnerStillQueued = await new Promise((resolve, reject) => {
          db.get(
            `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
            [player.duoPartner],
            (err, row) => (err ? reject(err) : resolve(!!row))
          );
        });

        if (!partnerStillQueued) {
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE players SET duoPartner = NULL WHERE id = ? AND duoPartner IS NOT NULL`,
              [playerId],
              (err) => (err ? reject(err) : resolve())
            );
          });

          logger.info("🧹 Removed orphaned duo", { playerId });
        } else {
          queueType = `Duo (with <@${player.duoPartner}>)`;
          details += `🔹 **Duo Partner:** <@${player.duoPartner}>\n`;
        }
      }

      const position = await getQueuePosition(playerId, player.platform);
      const avgWait = await calculateAverageQueueTime(
        player.platform,
        player.duoPartner ? "duo" : "solo"
      );

      const estWait =
        avgWait > 0 && position > 0
          ? `${Math.round((avgWait * position) / 60000)} minutes`
          : "N/A";

      details += `🔹 **Queue Type:** ${queueType}\n`;
      details += `🔹 **Queue Position:** ${position}\n`;
      details += `🔹 **Estimated Wait Time:** ${estWait}`;

      return interaction.reply({
        content: `📝 **Queue Status:**\n${details}`,
        flags: 64,
      });
    } catch (error) {
      logger.errorWrapper("❌ Error in check_queue_status button", error, {
        userId: user.id,
      });

      return interaction
        .reply({
          content: "❌ An error occurred while checking your status.",
          flags: 64,
        })
        .catch((err) =>
          logger.warn("⚠️ Failed to send error reply", { err: err.message })
        );
    }
  },
};
