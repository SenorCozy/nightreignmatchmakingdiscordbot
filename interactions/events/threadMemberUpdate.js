const db = require("../../database");
const logger = require("../../logger");
const { removePlayerFromMatch } = require("../../utils/playerUtils");
const {
  cleanupMatch,
  safeSend,
} = require("../../utils/matchmakingUtils/matchUtils");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

module.exports = async (addedMembers, removedMembers, thread) => {
  try {
    if (!thread?.isThread()) return;

    for (const [playerId] of removedMembers) {
      try {
        const match = await db.getAsync(
          `SELECT match_id, voiceChannelId, shared_nightlords FROM matches WHERE thread_id = ?`,
          [thread.id]
        );

        if (!match?.match_id) continue;

        const { match_id, voiceChannelId, shared_nightlords } = match;

        const playerStatus = await db.getAsync(
          `SELECT status, leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId]
        );

        if (
          !playerStatus ||
          playerStatus.status !== "active" ||
          playerStatus.leave_in_progress === 1
        ) {
          logger.info("🔄 Skipping already-handled thread leave", {
            playerId,
            match_id,
          });
          continue;
        }

        await db.runAsync(
          `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId]
        );

        await removePlayerFromMatch(playerId, thread.id, "manual_thread_leave");

        const remaining = await db
          .allAsync(
            `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
            [match_id]
          )
          .then((rows) => rows.map((r) => r.playerId));

        if (remaining.length === 0) {
          logger.info("🧹 All players left match — cleaning up", {
            match_id,
            threadId: thread.id,
          });
          await cleanupMatch({ thread, voiceChannelId });
        } else {
          let formattedPrefs = "_None currently set._";
          try {
            const parsed = shared_nightlords
              ? JSON.parse(shared_nightlords)
              : [];
            if (Array.isArray(parsed) && parsed.length > 0) {
              formattedPrefs = parsed.map((boss) => `• ${boss}`).join("\n");
            }
          } catch (err) {
            logger.warn(
              "⚠️ Failed to parse shared_nightlords in threadMemberUpdate",
              {
                match_id,
                error: err.message,
              }
            );
          }

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("update_shared_nightlords_button")
              .setLabel("Update Nightlord Preferences")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId("find_replacement")
              .setLabel("Find Replacement from Queue")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId("end_match_now")
              .setLabel("End Match Immediately")
              .setStyle(ButtonStyle.Danger)
          );

          await safeSend(thread, {
            content: `⚠️ <@${remaining.join(">, <@")}>
A player has left the match.

**Current Nightlord Preferences:**\n${formattedPrefs}

Would you like to update preferences before searching for a replacement or ending the match?`,
            components: [row],
          });
        }
      } catch (err) {
        logger.errorWrapper(
          "❌ Error handling player removal via threadMemberUpdate",
          err,
          {
            playerId,
            threadId: thread.id,
          }
        );
      }
    }
  } catch (error) {
    logger.errorWrapper("❌ Error in threadMemberUpdate handler", error, {
      threadId: thread?.id,
    });
  }
};
