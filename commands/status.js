const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check a user's queue/match/blacklist status")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to check status for")
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const member = interaction.options.getUser("user");
      const playerId = member.id;

      let statusMessage = `**Status for <@${playerId}>:**\n\n`;

      // Check queue status
      const queueData = await new Promise((resolve, reject) => {
        db.get(
          `SELECT platform, status, duoPartner FROM players WHERE id = ?`,
          [playerId],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      let queueType = "Solo";

      if (queueData) {
        if (queueData.duoPartner) {
          const partnerStillQueued = await new Promise((resolve, reject) => {
            db.get(
              `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
              [queueData.duoPartner],
              (err, row) => (err ? reject(err) : resolve(row ? true : false))
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

            logger.info(
              `Duo partner removed for ${playerId} since their partner left the queue.`
            );
          } else {
            queueType = `Duo (with <@${queueData.duoPartner}>)`;
          }
        }

        statusMessage += `🔹 **Queue Status:** ${queueData.status.toUpperCase()}\n`;
        statusMessage += `🔹 **Platform:** ${queueData.platform.toUpperCase()}\n`;
        statusMessage += `🔹 **Queue Type:** ${queueType}\n\n`;
      } else {
        statusMessage += "🔹 **Queue Status:** Not in queue.\n\n";
      }

      // Check active match
      const matchData = await new Promise((resolve, reject) => {
        db.get(
          `SELECT threadId, playerIds, voiceChannelId FROM channels WHERE playerIds LIKE ?`,
          [`%${playerId}%`],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (
        matchData &&
        queueData?.status !== "inactive" &&
        matchData.playerIds.includes(playerId)
      ) {
        const teammates =
          matchData.playerIds
            .split(",")
            .filter((id) => id !== playerId)
            .map((id) => `<@${id}>`)
            .join(", ") || "No teammates";

        statusMessage += `🔹 **Active Match:** Yes\n`;
        statusMessage += `🔹 **Match Thread:** <#${matchData.threadId}>\n`;
        statusMessage += `🔹 **Teammates:** ${teammates}\n`;
        statusMessage += `🔹 **Voice Channel:** ${
          matchData.voiceChannelId ? `<#${matchData.voiceChannelId}>` : "None"
        }\n\n`;
      } else {
        statusMessage += "🔹 **Active Match:** Not in a match.\n\n";
      }

      // Blacklist check
      // Blacklist check (with reason + timestamp)
      const blacklistEntry = await new Promise((resolve, reject) => {
        db.get(
          `SELECT reason, added_at FROM blacklist WHERE id = ?`,
          [playerId],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (blacklistEntry) {
        statusMessage += `🚫 **This user is blacklisted from matchmaking.**\n`;
        statusMessage += `🔸 **Reason:** ${
          blacklistEntry.reason || "Not provided"
        }\n`;
        statusMessage += `🔸 **Since:** <t:${Math.floor(
          blacklistEntry.added_at / 1000
        )}:R>\n`;
      }

      return interaction.reply({ content: statusMessage, flags: 64 });
    } catch (error) {
      logger.error("Error executing /status:", error.message);
      return interaction.reply({
        content: "An error occurred while retrieving the user's status.",
        flags: 64,
      });
    }
  },
};
