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
    matchThreads = await db.allAsync(`
      SELECT m.match_id, m.thread_id, c.voiceChannelId 
      FROM matches m
      LEFT JOIN channels c ON m.thread_id = c.threadId
    `);
  } catch (error) {
    logger.errorWrapper("ThreadIntegrity_LoadMatchThreads", error);
    return;
  }

  const threads = [];

  for (const row of matchThreads) {
    let thread = null;

    try {
      thread = await client.channels.fetch(row.thread_id);
    } catch (err) {
      logger.warn(`⚠️ Could not fetch thread ${row.thread_id}`);
      continue;
    }

    if (thread?.isThread?.()) {
      threads.push({ ...row, thread });
    }
  }

  logger.info(`🔍 Running thread integrity check on ${threads.length} threads`);

  for (const { thread, match_id, voiceChannelId } of threads) {
    try {
      const membersInThread = await thread.members.fetch();
      const activePlayerIds = membersInThread.map((m) => m.id);

      const expectedPlayers = await db
        .allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id]
        )
        .then((rows) => rows.map((r) => r.playerId));

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
            const isLeaving = await db.getAsync(
              `SELECT leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
              [match_id, playerId]
            );

            if (isLeaving?.leave_in_progress === 1) {
              logger.info(
                `⏭️ Skipping ${playerId} — leave already in progress.`
              );
              continue;
            }

            await db.runAsync(
              `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
              [match_id, playerId]
            );

            // ✅ Centralized cleanup handles everything
            await removePlayerFromMatch(
              playerId,
              thread.id,
              `left_match (${statusReason})`
            );

            const remaining = await db
              .allAsync(
                `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
                [match_id]
              )
              .then((rows) => rows.map((r) => r.playerId));

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
