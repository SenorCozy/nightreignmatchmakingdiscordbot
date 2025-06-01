const { ActionRowBuilder, ButtonBuilder } = require("discord.js");
const db = require("../../database");
const logger = require("../../logger");
const { cleanupMatch } = require("../../utils/matchmakingUtils/matchUtils");
const sendQueueStatusPrompt = require("../../utils/sendQueueStatusPrompt");
const { removePlayerFromMatch } = require("../../utils/playerUtils");

module.exports = {
  name: "guildMemberRemove",
  async execute(member) {
    const userId = member.id;
    const guild = member.guild;

    try {
      const leaveStatus = await db.getAsync(
        `SELECT leave_in_progress FROM match_players WHERE playerId = ? AND status = 'active'`,
        [userId]
      );

      if (leaveStatus?.leave_in_progress === 1) {
        logger.warn(
          `⏭️ Skipping guildMemberRemove for ${userId} — already in progress.`
        );
        return;
      }

      await db.runAsync(
        `UPDATE match_players SET leave_in_progress = 1 WHERE playerId = ?`,
        [userId]
      );

      // 🔍 Check if player was queued
      const player = await db.getAsync(
        `SELECT duoPartner FROM players WHERE id = ? AND status = 'queued'`,
        [userId]
      );

      if (player) {
        const { duoPartner } = player;

        // ✅ Remove player from queue
        await db.runAsync(`DELETE FROM players WHERE id = ?`, [userId]);
        logger.info(`🛑 Player ${userId} removed from the queue.`);

        // ✅ Handle duo unlinking
        if (duoPartner) {
          await db.runAsync(
            `UPDATE players SET duoPartner = NULL WHERE id IN (?, ?)`,
            [userId, duoPartner]
          );
          logger.info(`🔗 Duo unlinked: ${userId} & ${duoPartner}`);
          await sendQueueStatusPrompt(guild, duoPartner, "duo");
        }

        // ✅ Handle active trio membership
        const activeTrio = await db.getAsync(
          `SELECT * FROM trio_partner_groups 
           WHERE active = 1 AND (player1_id = ? OR player2_id = ? OR player3_id = ?)`,
          [userId, userId, userId]
        );

        if (activeTrio) {
          const trioIds = [
            activeTrio.player1_id,
            activeTrio.player2_id,
            activeTrio.player3_id,
          ];
          const remaining = trioIds.filter((id) => id !== userId);

          await db.runAsync(
            `UPDATE trio_partner_groups SET active = 0 WHERE trio_id = ?`,
            [activeTrio.trio_id]
          );

          logger.info("🔗 Trio group disbanded via guildMemberRemove", {
            trio_id: activeTrio.trio_id,
            leaver: userId,
          });

          for (const otherId of remaining) {
            await db.runAsync(
              `UPDATE players SET duoPartner = NULL WHERE id = ?`,
              [otherId]
            );
            await sendQueueStatusPrompt(guild, otherId, "trio");
          }
        }
      } else {
        logger.info(`ℹ️ Player ${userId} was not in the queue.`);
      }

      // 🔍 Check for active match cleanup
      const matchRow = await db.getAsync(
        `SELECT m.match_id, m.thread_id, c.voiceChannelId
         FROM matches m
         JOIN channels c ON m.thread_id = c.threadId
         WHERE c.playerIds LIKE ?`,
        [`%${userId}%`]
      );

      if (!matchRow) {
        logger.info(`ℹ️ Player ${userId} was not in an active match.`);
        return;
      }

      const { match_id, thread_id, voiceChannelId } = matchRow;
      const thread = global.client.channels.cache.get(thread_id);

      await removePlayerFromMatch(userId, thread_id, "left_server");

      if (thread) {
        await thread.send({
          content: `⚠️ **<@${userId}> has left the server.**`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("end_match")
                .setLabel("End Match")
                .setStyle("Danger"),
              new ButtonBuilder()
                .setCustomId("find_replacement")
                .setLabel("Find Replacement")
                .setStyle("Primary")
            ),
          ],
        });

        const remaining = await db.allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id]
        );

        if (remaining.length === 0) {
          await cleanupMatch({ thread, voiceChannelId });
        }
      }
    } catch (err) {
      logger.errorWrapper(`❌ Error in guildMemberRemove for ${userId}`, err);
    } finally {
      await db.runAsync(
        `UPDATE match_players SET leave_in_progress = 0 WHERE playerId = ?`,
        [userId]
      );
    }
  },
};
