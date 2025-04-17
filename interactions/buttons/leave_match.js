const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../../database");

const { removePlayerFromMatch } = require("../utils/playerUtils");
const { cleanupMatch } = require("../utils/matchmaking/matchUtils");

module.exports = {
  customId: "leave_match",
  async execute(interaction) {
    try {
      const thread = interaction.channel;
      const userId = interaction.user.id;

      if (!thread?.isThread()) {
        return interaction.reply({
          content: "❌ This must be used inside a match thread.",
          flags: 64,
        });
      }

      await interaction.deferReply({ flags: 64 }).catch(() => {});

      // Fetch match info
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!match) {
        return interaction.editReply({
          content: "❌ This match no longer exists.",
        });
      }

      let playerIds = match.playerIds.split(",").filter(Boolean);

      if (!playerIds.includes(userId)) {
        return interaction.editReply({
          content: "❌ You are not part of this match.",
        });
      }

      // Remove player from DB match entry
      playerIds = playerIds.filter((id) => id !== userId);
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
          [playerIds.join(","), thread.id],
          (err) => (err ? reject(err) : resolve())
        );
      });

      await removePlayerFromMatch(userId, thread.id);

      // Remove from thread
      await thread.members.remove(userId).catch(() => {});
      await thread.permissionOverwrites
        .edit(userId, {
          ViewChannel: false,
          SendMessages: false,
        })
        .catch(() => {});

      // Remove from VC
      if (match.voiceChannelId) {
        const vc = thread.guild.channels.cache.get(match.voiceChannelId);
        if (vc) {
          await vc.permissionOverwrites
            .edit(userId, {
              ViewChannel: false,
              Connect: false,
            })
            .catch(() => {});
          await vc.members
            .get(userId)
            ?.voice.disconnect()
            .catch(() => {});
        }
      }

      if (playerIds.length === 0) {
        await cleanupMatch({ thread, voiceChannelId: match.voiceChannelId });
        return;
      }

      // Prompt remaining players
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("end_match_now")
          .setLabel("End Match Immediately")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("find_replacement")
          .setLabel("Find Replacement from Queue")
          .setStyle(ButtonStyle.Primary)
      );

      await thread.send({
        content: `<@${playerIds.join(
          ">, <@"
        )}>: A player has left the match.\nWould you like to end the match or search for a replacement?`,
        components: [actionRow],
      });

      return interaction.editReply({
        content: "✅ You have successfully left the match.",
      });
    } catch (error) {
      logger.error("❌ Error handling leave_match button:", error.message);
      return interaction.editReply({
        content: "❌ Something went wrong trying to leave the match.",
      });
    }
  },
};
