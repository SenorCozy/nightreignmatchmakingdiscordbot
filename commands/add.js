const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const { hasModRole } = require("../utils/permissions");
const db = require("../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add a user to the current match thread and voice channel")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to add").setRequired(true)
    ),

  async execute(interaction) {
    const thread = interaction.channel;
    const member = interaction.options.getUser("user");
    const playerId = member.id;

    if (!thread?.isThread()) {
      return interaction.reply({
        content: "❌ You must run this command inside a match thread.",
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
      // Check if blacklisted
      const isBlacklisted = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM blacklist WHERE id = ?`,
          [playerId],
          (err, row) => (err ? reject(err) : resolve(!!row))
        );
      });

      if (isBlacklisted) {
        return interaction.reply({
          content: `🚫 <@${playerId}> is blacklisted and cannot be added to a match.`,
          flags: 64,
        });
      }

      // Get match
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!match) {
        return interaction.reply({
          content: "❌ This thread is not linked to an active match.",
          flags: 64,
        });
      }

      const playerIds = match.playerIds.split(",").filter(Boolean);

      if (playerIds.includes(playerId)) {
        return interaction.reply({
          content: `⚠️ <@${playerId}> is already part of this match.`,
          flags: 64,
        });
      }

      // Add to DB
      playerIds.push(playerId);
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
          [playerIds.join(","), thread.id],
          (err) => (err ? reject(err) : resolve())
        );
      });

      // Add to thread
      try {
        await thread.members.add(playerId);
        await thread.permissionOverwrites.edit(playerId, {
          ViewChannel: true,
          SendMessages: true,
        });
        logger.info(`✅ Added ${playerId} to thread ${thread.id}`);
      } catch (err) {
        logger.error(`❌ Failed to add user to thread: ${err.message}`);
      }

      // Add to VC
      if (match.voiceChannelId) {
        const vc = thread.guild.channels.cache.get(match.voiceChannelId);
        if (vc) {
          try {
            await vc.permissionOverwrites.edit(playerId, {
              ViewChannel: true,
              Connect: true,
              Speak: true,
            });
            logger.info(`✅ Updated VC permissions for ${playerId}`);
          } catch (err) {
            logger.error(`❌ Failed to update VC perms: ${err.message}`);
          }
        } else {
          logger.warn(`⚠️ VC ${match.voiceChannelId} not found`);
        }
      }

      return interaction.reply({
        content: `✅ <@${playerId}> has been added to the match.`,
        flags: 64,
      });
    } catch (error) {
      logger.error("❌ Unexpected error in /add:", error);
      return interaction.reply({
        content: "❌ An error occurred while adding the user.",
        flags: 64,
      });
    }
  },
};
