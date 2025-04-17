const {
  getQueuePosition,
  calculateAverageQueueTime,
  getPlayerById,
} = require("../utils/playerUtils");
const db = require("../../database");

module.exports = {
  customId: "check_queue_status",

  async execute(interaction) {
    const { user } = interaction;

    try {
      const player = await getPlayerById(user.id);

      if (!player) {
        return interaction.reply({
          content: "You're not in the queue or a match.",
          flags: 64,
        });
      }

      const platform = player.platform.toUpperCase();
      let queueType = "Solo";
      let details = `🔹 **Platform:** ${platform}\n`;

      if (player.duoPartner) {
        const stillQueued = await new Promise((resolve, reject) => {
          db.get(
            `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
            [player.duoPartner],
            (err, row) => (err ? reject(err) : resolve(!!row))
          );
        });

        if (!stillQueued) {
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE players SET duoPartner = NULL WHERE id = ? AND duoPartner IS NOT NULL`,
              [user.id],
              (err) => (err ? reject(err) : resolve())
            );
          });

          logger.info(`Removed orphaned duo for ${user.id}`);
        } else {
          queueType = `Duo (with <@${player.duoPartner}>)`;
          details += `🔹 **Duo Partner:** <@${player.duoPartner}>\n`;
        }
      }

      const position = await getQueuePosition(user.id, player.platform);
      const avgWait = await calculateAverageQueueTime(
        player.platform,
        player.duoPartner ? "duo" : "solo"
      );

      const estWait =
        avgWait > 0
          ? `${Math.round((avgWait * position) / 60)} minutes`
          : "N/A";

      details += `🔹 **Queue Type:** ${queueType}\n`;
      details += `🔹 **Queue Position:** ${position}\n`;
      details += `🔹 **Estimated Wait Time:** ${estWait}`;

      if (player.status === "active") {
        return interaction.reply({
          content: `⚔️ You are currently in an **active match** on **${platform}**.`,
          flags: 64,
        });
      }

      return interaction.reply({
        content: `📝 **Queue Status:**\n${details}`,
        flags: 64,
      });
    } catch (error) {
      logger.error("❌ Error in check_queue_status button:", error.message);
      return interaction
        .reply({
          content: "An error occurred while checking your status.",
          flags: 64,
        })
        .catch(() => {});
    }
  },
};
