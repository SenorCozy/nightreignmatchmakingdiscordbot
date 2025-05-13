const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getPlayerById } = require("../../utils/playerUtils");
const db = require("../../database");

module.exports = {
  customId: "remove_from_queue",
  async execute(interaction) {
    const playerId = interaction.user.id;

    try {
      const player = await getPlayerById(playerId);
      if (!player) {
        return interaction.reply({
          content: "You're not currently in the matchmaking queue.",
          flags: 64,
        });
      }

      if (player.status === "active") {
        return interaction.reply({
          content: "You are in an active match and cannot leave the queue.",
          flags: 64,
        });
      }

      // ✅ Duo unlink logic
      if (player.duoPartner) {
        const partnerId = player.duoPartner;

        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE players SET duoPartner = NULL WHERE id = ? OR id = ?`,
            [playerId, partnerId],
            (err) => (err ? reject(err) : resolve())
          );
        });

        console.info(
          `Duo partnership cleared for ${playerId} and ${partnerId}`
        );

        const dmEmbed = {
          content: `⚠️ Your duo partner has left the queue. You are now queued as a solo.\nWould you like to leave the queue too?`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`leave_queue_${partnerId}`)
                .setLabel("Leave Queue")
                .setStyle(ButtonStyle.Danger)
            ),
          ],
        };

        const partnerMember = interaction.guild.members.cache.get(partnerId);
        if (partnerMember) {
          try {
            await partnerMember.send(dmEmbed);
            console.info(`✅ Sent DM to ${partnerId} about duo leave.`);
          } catch {
            console.warn(
              `⚠️ Could not DM ${partnerId}, falling back to public alert.`
            );
            const fallbackChannel = interaction.guild.channels.cache.find(
              (ch) =>
                ch.name === process.env.QUEUE_ALERT_CHANNEL_NAME &&
                ch.isTextBased()
            );
            if (fallbackChannel) {
              await fallbackChannel.send({
                content: `<@${partnerId}>`,
                ...dmEmbed,
              });
            }
          }
        }
      }

      // ✅ Delete from players table
      const result = await new Promise((resolve, reject) => {
        db.run(
          `DELETE FROM players WHERE id = ? AND status = ?`,
          [playerId, "queued"],
          function (err) {
            if (err) return reject(err);
            resolve(this.changes); // number of rows affected
          }
        );
      });

      if (result === 0) {
        return interaction.reply({
          content: "❌ You were not in the queue or have already been removed.",
          flags: 64,
        });
      }

      return interaction.reply({
        content: "✅ You've been removed from the matchmaking queue.",
        flags: 64,
      });
    } catch (error) {
      console.error("Error handling remove_from_queue:", error.message);
      return interaction.reply({
        content: "❌ An error occurred while leaving the queue.",
        flags: 64,
      });
    }
  },
};
