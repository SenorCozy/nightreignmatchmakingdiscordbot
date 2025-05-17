const db = require("../database");
const logger = require("../logger");
const { removePlayerFromMatch } = require("../utils/playerUtils");
const { cleanupMatch } = require("../utils/matchmakingUtils/matchUtils");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

async function checkThreadIntegrity(client) {
  const guild = client.guilds.cache.first();
  const now = Date.now();

  let matchThreads = [];
  try {
    matchThreads = await new Promise((resolve, reject) => {
      db.all(
        `SELECT m.match_id, m.thread_id, c.voiceChannelId 
         FROM matches m
         LEFT JOIN channels c ON m.thread_id = c.threadId`,
        [],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });
  } catch (error) {
    logger.errorWrapper("ThreadIntegrity_LoadMatchThreads", error);
    return;
  }

  const threads = matchThreads
    .map((row) => {
      const thread = guild.channels.cache.get(row.thread_id);
      return thread ? { ...row, thread } : null;
    })
    .filter(Boolean);

  logger.info(`🔍 Running thread integrity check on ${threads.length} threads`);

  for (const { thread, match_id, voiceChannelId } of threads) {
    try {
      const membersInThread = await thread.members.fetch();
      const activePlayerIds = membersInThread.map((m) => m.id);

      const expectedPlayers = await new Promise((resolve, reject) => {
        db.all(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id],
          (err, rows) =>
            err ? reject(err) : resolve(rows.map((r) => r.playerId))
        );
      });

      for (const playerId of expectedPlayers) {
        if (!activePlayerIds.includes(playerId)) {
          let statusReason = "missing_player";

          try {
            const guildMember = await thread.guild.members
              .fetch(playerId)
              .catch(() => null);
            if (!guildMember) {
              statusReason = "left_server";
            } else {
              const threadMember = await thread.members
                .fetch(playerId)
                .catch(() => null);
              if (!threadMember) {
                statusReason = "left_thread";
              }
            }
          } catch (error) {
            logger.errorWrapper("ThreadIntegrity_FetchMember", error, {
              playerId,
            });
          }

          try {
            const isLeaving = await new Promise((resolve, reject) => {
              db.get(
                `SELECT leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
                [match_id, playerId],
                (err, row) =>
                  err ? reject(err) : resolve(row?.leave_in_progress === 1)
              );
            });

            if (isLeaving) {
              logger.info(
                `⏭️ Skipping ${playerId} — leave already in progress.`
              );
              continue;
            }

            await db.run(
              `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
              [match_id, playerId]
            );

            await db.run(
              `UPDATE match_players SET status = 'removed' WHERE match_id = ? AND playerId = ?`,
              [match_id, playerId]
            );

            await db.run(
              `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason)
               VALUES (?, ?, ?, 'leave', ?, ?)`,
              [
                match_id,
                thread.id,
                playerId,
                now,
                `Integrity check: ${statusReason}`,
              ]
            );

            await removePlayerFromMatch(playerId, thread.id).catch((e) => {
              logger.warn(
                `removePlayerFromMatch failed for ${playerId}: ${e.message}`
              );
            });

            if (voiceChannelId) {
              const vc = thread.guild.channels.cache.get(voiceChannelId);
              if (vc) {
                await vc.permissionOverwrites
                  .edit(playerId, {
                    ViewChannel: false,
                    Connect: false,
                  })
                  .catch(() => {});
                const member = vc.members.get(playerId);
                if (member?.voice) {
                  await member.voice.disconnect().catch(() => {});
                }
              }
            }

            await db.run(
              `UPDATE match_players SET leave_in_progress = 0 WHERE match_id = ? AND playerId = ?`,
              [match_id, playerId]
            );

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

              await new Promise((r) => setTimeout(r, 750));
            }
          } catch (error) {
            logger.errorWrapper("ThreadIntegrity_PlayerHandling", error, {
              playerId,
            });
          }
        }
      }
    } catch (error) {
      logger.errorWrapper("ThreadIntegrity_ThreadCheck", error);
    }
  }
}

module.exports = { checkThreadIntegrity };
