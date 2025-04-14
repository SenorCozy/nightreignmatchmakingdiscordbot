const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { hasModRole } = require("../utils/permissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a player from the match, thread, and voice channel")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Player to remove").setRequired(true)
    ),

  async execute(interaction) {
    const thread = interaction.channel;
    const member = interaction.options.getUser("user");
    const playerId = member.id;

    if (!thread?.isThread()) {
      return interaction.reply({
        content: "❌ You must use this command inside a match thread.",
        flags: 64,
      });
    }

    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "🚫 You do not have permission to use this command.",
        flags: 64,
      });
    }

    try {
      // Fetch match
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!match) {
        return interaction.reply({
          content: "❌ This thread is not part of an active match.",
          flags: 64,
        });
      }

      let playerIds = match.playerIds.split(",").filter(Boolean);
      if (!playerIds.includes(playerId)) {
        return interaction.reply({
          content: `⚠️ <@${playerId}> is not part of this match.`,
          flags: 64,
        });
      }

      // Update DB
      const updatedPlayerIds = playerIds.filter((id) => id !== playerId);
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
          [updatedPlayerIds.join(","), thread.id],
          (err) => (err ? reject(err) : resolve())
        );
      });

      await new Promise((resolve, reject) => {
        db.run(`DELETE FROM players WHERE id = ?`, [playerId], (err) =>
          err ? reject(err) : resolve()
        );
      });

      // Remove from thread
      try {
        await thread.members.remove(playerId);
      } catch (err) {
        logger.warn(
          `⚠️ Could not remove ${playerId} from thread: ${err.message}`
        );
      }

      try {
        await thread.permissionOverwrites.edit(playerId, {
          ViewChannel: false,
          SendMessages: false,
        });
      } catch (err) {
        logger.warn(`⚠️ Could not update thread permissions: ${err.message}`);
      }

      // Remove from VC
      if (match.voiceChannelId) {
        const voiceChannel = thread.guild.channels.cache.get(
          match.voiceChannelId
        );
        if (voiceChannel) {
          try {
            await voiceChannel.permissionOverwrites.edit(playerId, {
              ViewChannel: false,
              Connect: false,
            });
          } catch (err) {
            logger.warn(`⚠️ Could not update VC permissions: ${err.message}`);
          }
        }
      }

      return interaction.reply({
        content: `✅ <@${playerId}> has been removed from the match and stripped of access.`,
        flags: 64,
      });
    } catch (error) {
      logger.error("❌ Error in /remove:", error);
      return interaction.reply({
        content: "❌ An error occurred while removing the user.",
        flags: 64,
      });
    }
  },
};
