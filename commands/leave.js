const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave your current match thread and voice channel"),

  async execute(interaction) {
    try {
      const thread = interaction.channel;
      const playerId = interaction.user.id;

      if (!thread?.isThread()) {
        return interaction.reply({
          content: "❌ This command must be used inside a match thread.",
          flags: 64,
        });
      }

      // Fetch match info
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!match) {
        return interaction.reply({
          content: "❌ This match no longer exists.",
          flags: 64,
        });
      }

      let playerIds = match.playerIds.split(",").filter(Boolean);

      if (!playerIds.includes(playerId)) {
        return interaction.reply({
          content: "❌ You are not part of this match.",
          flags: 64,
        });
      }

      // Remove from DB
      playerIds = playerIds.filter((id) => id !== playerId);

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
          [playerIds.join(","), thread.id],
          (err) => (err ? reject(err) : resolve())
        );
      });

      // Remove from thread
      await thread.members.remove(playerId);
      await thread.permissionOverwrites.edit(playerId, { ViewChannel: false });

      // Remove from VC (if applicable)
      if (match.voiceChannelId) {
        const vc = thread.guild.channels.cache.get(match.voiceChannelId);
        if (vc) {
          await vc.permissionOverwrites
            .edit(playerId, { ViewChannel: false, Connect: false })
            .catch(() => {});
        }
      }

      // Check if match is now empty
      if (playerIds.length === 0) {
        await cleanupMatch({ thread, voiceChannelId: match.voiceChannelId });
        return;
      }

      // Present options to remaining players
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

      return interaction.reply({
        content: "✅ You have left the match.",
        flags: 64,
      });
    } catch (error) {
      logger.error("Error executing /leave:", error);
      return interaction.reply({
        content: "❌ An error occurred while trying to leave the match.",
        flags: 64,
      });
    }
  },
};
