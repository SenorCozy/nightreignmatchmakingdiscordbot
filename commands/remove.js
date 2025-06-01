// commands/remove.js
const { SlashCommandBuilder } = require("discord.js");
const { hasModRole } = require("../utils/permissions");
const db = require("../database");
const { removePlayerFromMatch } = require("../utils/playerUtils");
const logger = require("../logger");

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
      let matchInfo;
      try {
        matchInfo = await db.getAsync(
          `SELECT matches.match_id, voiceChannelId FROM matches 
           JOIN channels ON matches.thread_id = channels.threadId 
           WHERE matches.thread_id = ?`,
          [thread.id]
        );
      } catch (err) {
        logger.errorWrapper("DB error fetching match info in /remove", err, {
          threadId: thread.id,
          playerId,
        });
        return interaction.reply({
          content: "❌ Failed to retrieve match data.",
          flags: 64,
        });
      }

      const { match_id } = matchInfo || {};
      if (!match_id) {
        return interaction.reply({
          content: "❌ This thread is not part of an active match.",
          flags: 64,
        });
      }

      let isInProgress;
      try {
        isInProgress = await db.getAsync(
          `SELECT leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId]
        );
      } catch (err) {
        logger.errorWrapper(
          "DB error checking leave_in_progress in /remove",
          err,
          {
            match_id,
            playerId,
          }
        );
        return interaction.reply({
          content: "❌ Could not verify player status.",
          flags: 64,
        });
      }

      if (isInProgress?.leave_in_progress === 1) {
        return interaction.reply({
          content: "⚠️ This player is already being removed.",
          flags: 64,
        });
      }

      try {
        await db.runAsync(
          `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId]
        );
      } catch (err) {
        logger.errorWrapper(
          "DB error setting leave_in_progress in /remove",
          err,
          {
            match_id,
            playerId,
          }
        );
        return interaction.reply({
          content: "❌ Failed to lock player for removal.",
          flags: 64,
        });
      }

      try {
        await removePlayerFromMatch(
          playerId,
          thread.id,
          "removed_by_moderator"
        );
      } catch (err) {
        logger.errorWrapper(
          "Error in removePlayerFromMatch during /remove",
          err,
          {
            match_id,
            playerId,
          }
        );
        return interaction.reply({
          content: "❌ Failed to remove the player from the match.",
          flags: 64,
        });
      }

      return interaction.reply({
        content: `✅ <@${playerId}> has been removed from the match and stripped of access. Please use /search to attempt to replace this player from the queue if desired.`,
        flags: 64,
      });
    } catch (error) {
      logger.errorWrapper("❌ Error in /remove", error, {
        playerId,
        threadId: thread?.id,
      });
      return interaction.reply({
        content: "❌ An error occurred while removing the user.",
        flags: 64,
      });
    }
  },
};
