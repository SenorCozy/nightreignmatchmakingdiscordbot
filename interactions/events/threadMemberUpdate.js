// interactions/events/threadMemberUpdate.js
const db = require("../../database");
const { removePlayerFromMatch } = require("../../utils/playerUtils");
const { cleanupMatch } = require("../../utils/matchmakingUtils/matchUtils");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

module.exports = async (addedMembers, removedMembers, thread) => {
  try {
    if (!thread?.isThread()) return;

    const timestamp = Date.now();

    for (const [playerId] of removedMembers) {
      // Retrieve match details
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT match_id, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!match?.match_id) continue;

      const { match_id, voiceChannelId } = match;

      // Check if the player is already being removed or has been removed
      const playerStatus = await new Promise((resolve, reject) => {
        db.get(
          `SELECT status, leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId],
          (err, row) => {
            if (err) return reject(err);
            if (!row || row.status !== "active") return resolve({ skip: true });
            return resolve({
              skip: false,
              leaveInProgress: row.leave_in_progress === 1,
            });
          }
        );
      });

      if (playerStatus.skip || playerStatus.leaveInProgress) {
        console.log(
          `🔄 Skipping threadMemberUpdate for ${playerId} — already removed or in progress.`
        );
        continue;
      }

      // Set leave_in_progress to prevent concurrent modifications
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId],
          (err) => (err ? reject(err) : resolve())
        );
      });

      // Mark player as removed
      await db.run(
        `UPDATE match_players SET status = 'removed' WHERE match_id = ? AND playerId = ?`,
        [match_id, playerId]
      );

      // Log the event with final_status
      await db.run(
        `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
         VALUES (?, ?, ?, 'leave', ?, ?, ?)`,
        [
          match_id,
          thread.id,
          playerId,
          timestamp,
          "Manual thread leave",
          "manual_thread_leave",
        ]
      );

      // Perform cleanup actions
      await removePlayerFromMatch(playerId, thread.id);

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE players 
           SET platform = 'unknown', status = 'inactive', duoPartner = NULL, queue_entered_at = NULL
           WHERE id = ?`,
          [playerId],
          (err) => (err ? reject(err) : resolve())
        );
      });

      // Check if any players remain
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
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("end_match_now")
            .setLabel("End Match Immediately")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("find_replacement")
            .setLabel("Find Replacement from Queue")
            .setStyle(ButtonStyle.Primary)
        );

        await thread
          .send({
            content: `<@${remaining.join(
              ">, <@"
            )}>: A player has left the match.\nWould you like to end the match or search for a replacement?`,
            components: [row],
          })
          .catch(() => {});
      }

      // Reset leave_in_progress
      await db.run(
        `UPDATE match_players SET leave_in_progress = 0 WHERE match_id = ? AND playerId = ?`,
        [match_id, playerId]
      );
    }
  } catch (error) {
    console.error("❌ Error in threadMembersUpdate handler:", error);
  }
};
