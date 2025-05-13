const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { hasModRole } = require("../utils/permissions");
const db = require("../database");

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
      // Get match_id
      const matchInfo = await new Promise((resolve, reject) => {
        db.get(
          `SELECT matches.match_id, voiceChannelId FROM matches 
           JOIN channels ON matches.thread_id = channels.threadId 
           WHERE matches.thread_id = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      const { match_id, voiceChannelId } = matchInfo || {};
      if (!match_id) {
        return interaction.reply({
          content: "❌ This thread is not part of an active match.",
          flags: 64,
        });
      }

      // ✅ Concurrency check
      const isInProgress = await new Promise((resolve, reject) => {
        db.get(
          `SELECT leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId],
          (err, row) =>
            err ? reject(err) : resolve(row?.leave_in_progress === 1)
        );
      });

      if (isInProgress) {
        return interaction.reply({
          content: "⚠️ This player is already being removed.",
          flags: 64,
        });
      }

      // ✅ Set leave_in_progress = 1
      await db.run(
        `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
        [match_id, playerId]
      );

      // ✅ Update match_players
      await db.run(
        `UPDATE match_players SET status = 'removed' WHERE match_id = ? AND playerId = ?`,
        [match_id, playerId]
      );

      // ✅ Log match event with final_status
      await db.run(
        `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
         VALUES (?, ?, ?, 'kick', ?, ?, ?)`,
        [
          match_id,
          thread.id,
          playerId,
          Date.now(),
          "Removed via /remove",
          "removed_by_moderator",
        ]
      );

      // ✅ Remove from players table
      await db.run(`DELETE FROM players WHERE id = ?`, [playerId]);

      // ✅ Remove from thread
      await thread.members.remove(playerId).catch(() => {});

      // ✅ Remove from VC
      if (voiceChannelId) {
        const vc = thread.guild.channels.cache.get(voiceChannelId);
        if (vc) {
          await vc.permissionOverwrites
            .edit(playerId, {
              ViewChannel: false,
              Connect: false,
            })
            .catch(() => {});
        }
      }

      // ✅ Reset leave_in_progress
      await db.run(
        `UPDATE match_players SET leave_in_progress = 0 WHERE match_id = ? AND playerId = ?`,
        [match_id, playerId]
      );

      return interaction.reply({
        content: `✅ <@${playerId}> has been removed from the match and stripped of access. Please use /search to attempt to replace this player from the queue if desired.`,
        flags: 64,
      });
    } catch (error) {
      console.error("❌ Error in /remove:", error);
      return interaction.reply({
        content: "❌ An error occurred while removing the user.",
        flags: 64,
      });
    }
  },
};
