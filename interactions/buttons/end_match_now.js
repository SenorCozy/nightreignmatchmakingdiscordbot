// buttons/end_match_now.js
const { PermissionFlagsBits } = require("discord.js");
const db = require("../../database");

module.exports = {
  customId: "end_match_now",
  async execute(interaction) {
    try {
      const thread = interaction.channel;
      const guild = interaction.guild;

      await interaction.deferReply({ flags: 64 }).catch(() => {});

      const dbResult = await new Promise((resolve, reject) => {
        db.get(
          `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!dbResult) {
        return interaction
          .editReply({ content: "❌ No active match found." })
          .catch(() => {});
      }

      const { voiceChannelId } = dbResult;

      await new Promise((resolve, reject) => {
        db.run(`DELETE FROM channels WHERE threadId = ?`, [thread.id], (err) =>
          err ? reject(err) : resolve()
        );
      });

      await thread
        .send(
          "⚠️ **Match has been force-ended by a player. The match will end shortly.**"
        )
        .catch(() => {});

      const threadMembers = thread.members.cache.map((m) => m.id);
      for (const playerId of threadMembers) {
        await thread.members.remove(playerId).catch(() => {});
        await thread.permissionOverwrites
          .edit(playerId, {
            ViewChannel: false,
            SendMessages: false,
          })
          .catch(() => {});
      }

      if (voiceChannelId) {
        const voiceChannel = guild.channels.cache.get(voiceChannelId);
        if (voiceChannel) {
          await voiceChannel.delete().catch(() => {});
        }
      }

      setTimeout(async () => {
        await thread.delete().catch(() => {});
      }, 5000);
    } catch (error) {
      logger.error("❌ Error handling end_match_now:", error.message);
      await interaction
        .editReply({ content: "❌ Error ending match." })
        .catch(() => {});
    }
  },
};
