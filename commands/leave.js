const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const db = require("../database");
const { cleanupMatch } = require("../utils/matchmakingUtils/matchUtils");
const { removePlayerFromMatch } = require("../utils/playerUtils");

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

      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT match_id, voiceChannelId FROM channels WHERE threadId = ?`,
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

      const { match_id, voiceChannelId } = match;

      // ✅ Check if already in process of leaving
      const inProgress = await new Promise((resolve, reject) => {
        db.get(
          `SELECT leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId],
          (err, row) =>
            err ? reject(err) : resolve(row?.leave_in_progress === 1)
        );
      });

      if (inProgress) {
        return interaction.reply({
          content: "⚠️ Your leave request is already being processed.",
          flags: 64,
        });
      }

      // ✅ Lock leave process
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId],
          (err) => (err ? reject(err) : resolve())
        );
      });

      const activePlayers = await new Promise((resolve, reject) => {
        db.all(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id],
          (err, rows) =>
            err ? reject(err) : resolve(rows.map((r) => r.playerId))
        );
      });

      if (!activePlayers.includes(playerId)) {
        return interaction.reply({
          content: "❌ You are not part of this match.",
          flags: 64,
        });
      }

      // ✅ Update match_players status
      await db.run(
        `UPDATE match_players SET status = 'removed' WHERE match_id = ? AND playerId = ?`,
        [match_id, playerId]
      );

      // ✅ Log leave event with final_status
      await db.run(
        `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
         VALUES (?, ?, ?, 'leave', ?, ?, ?)`,
        [
          match_id,
          thread.id,
          playerId,
          Date.now(),
          "Player used /leave command",
          "left_match",
        ]
      );

      // ✅ Remove player from match
      await removePlayerFromMatch(playerId, thread.id, "left_match");

      // ✅ Remove from thread and VC
      await thread.members.remove(playerId).catch(() => {});
      await thread.permissionOverwrites
        .edit(playerId, { ViewChannel: false, SendMessages: false })
        .catch(() => {});

      if (voiceChannelId) {
        const vc = thread.guild.channels.cache.get(voiceChannelId);
        if (vc) {
          await vc.permissionOverwrites
            .edit(playerId, { ViewChannel: false, Connect: false })
            .catch(() => {});
        }
      }

      const remaining = await new Promise((resolve, reject) => {
        db.all(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id],
          (err, rows) =>
            err ? reject(err) : resolve(rows.map((r) => r.playerId))
        );
      });

      if (remaining.length === 0) {
        await cleanupMatch({ thread, voiceChannelId });
      } else {
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
          content: `<@${remaining.join(
            ">, <@"
          )}>: A player has left the match.\nWould you like to end the match or search for a replacement?`,
          components: [actionRow],
        });
      }

      // ✅ Release the lock
      await db.run(
        `UPDATE match_players SET leave_in_progress = 0 WHERE match_id = ? AND playerId = ?`,
        [match_id, playerId]
      );

      return interaction.reply({
        content: "✅ You have left the match.",
        flags: 64,
      });
    } catch (error) {
      console.error("❌ Error executing /leave:", error);
      return interaction.reply({
        content: "❌ An error occurred while trying to leave the match.",
        flags: 64,
      });
    }
  },
};
