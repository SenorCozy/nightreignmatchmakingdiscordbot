const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../../database");

const { removePlayerFromMatch } = require("../../utils/playerUtils");
const { cleanupMatch } = require("../../utils/matchmakingUtils/matchUtils");
const {
  addToPlayerMatchTime,
  trackLongestMatchTime,
  addToTotalMatchTime,
} = require("../../utils/playerstatshelper");

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

      const matchData = await new Promise((resolve, reject) => {
        db.get(
          `SELECT match_id, playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!matchData) {
        return interaction.editReply({
          content: "❌ This match no longer exists.",
        });
      }

      const { match_id, playerIds, voiceChannelId } = matchData;

      const playerList = playerIds.split(",").filter(Boolean);
      if (!playerList.includes(userId)) {
        return interaction.editReply({
          content: "❌ You are not part of this match.",
        });
      }

      // ✅ Check for leave_in_progress
      const inProgress = await new Promise((resolve, reject) => {
        db.get(
          `SELECT leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
          [match_id, userId],
          (err, row) =>
            err ? reject(err) : resolve(row?.leave_in_progress === 1)
        );
      });

      if (inProgress) {
        return interaction.editReply({
          content: "⚠️ You're already being removed from this match.",
        });
      }

      // ✅ Set leave_in_progress = 1
      await db.run(
        `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
        [match_id, userId]
      );

      // ✅ Match time tracking
      const queueEnteredAt = await new Promise((resolve, reject) => {
        db.get(
          `SELECT queue_entered_at FROM player_statistics WHERE id = ?`,
          [userId],
          (err, row) =>
            err ? reject(err) : resolve(row?.queue_entered_at || null)
        );
      });

      if (queueEnteredAt) {
        const matchDuration = Date.now() - queueEnteredAt;
        await Promise.all([
          addToPlayerMatchTime(userId, matchDuration),
          trackLongestMatchTime(userId, matchDuration),
          addToTotalMatchTime(matchDuration),
        ]).catch((err) =>
          console.warn("⚠️ Failed to update match duration stats:", err.message)
        );
      }

      // ✅ Mark player as removed
      await db.run(
        `UPDATE match_players SET status = 'removed' WHERE match_id = ? AND playerId = ?`,
        [match_id, userId]
      );

      // ✅ Log leave event with final_status
      await db.run(
        `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
   VALUES (?, ?, ?, 'leave', ?, ?, ?)`,
        [
          match_id,
          thread.id,
          userId,
          Date.now(),
          "Player used leave_match button",
          "left_match",
        ]
      );

      // ✅ Update playerIds in channels
      const updatedPlayerIds = playerList.filter((id) => id !== userId);
      await db.run(`UPDATE channels SET playerIds = ? WHERE threadId = ?`, [
        updatedPlayerIds.join(","),
        thread.id,
      ]);

      // ✅ Reset player queue status
      await removePlayerFromMatch(userId, thread.id);

      // ✅ Remove from thread and VC
      await thread.members.remove(userId).catch(() => {});

      if (voiceChannelId) {
        const vc = thread.guild.channels.cache.get(voiceChannelId);
        if (vc) {
          await vc.permissionOverwrites
            .edit(userId, {
              ViewChannel: false,
              Connect: false,
              Speak: false,
            })
            .catch(() => {});
          await vc.members
            .get(userId)
            ?.voice.disconnect()
            .catch(() => {});
        }
      }

      // ✅ Reset leave_in_progress
      await db.run(
        `UPDATE match_players SET leave_in_progress = 0 WHERE match_id = ? AND playerId = ?`,
        [match_id, userId]
      );

      // ✅ Check for cleanup
      const remaining = await new Promise((resolve, reject) => {
        db.get(
          `SELECT COUNT(*) AS count FROM match_players 
           WHERE match_id = ? AND status = 'active'`,
          [match_id],
          (err, row) => (err ? reject(err) : resolve(row.count || 0))
        );
      });

      if (remaining === 0) {
        await cleanupMatch({ thread, voiceChannelId });
        return;
      }

      // ✅ Notify remaining players
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
        content: `⚠️ <@${updatedPlayerIds.join(
          ">, <@"
        )}>: A player has left the match.\nWould you like to end the match or search for a replacement?`,
        components: [actionRow],
      });

      return interaction.editReply({
        content: "✅ You have successfully left the match.",
      });
    } catch (error) {
      console.error("❌ Error handling leave_match button:", error.message);
      return interaction.editReply({
        content: "❌ Something went wrong trying to leave the match.",
      });
    }
  },
};
