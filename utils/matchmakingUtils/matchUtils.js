// utils/matchUtils.js
const db = require("../../database");
const { updateGlobalLongestMatch } = require("../utils/botstatshelper");

async function isPlayerInActiveMatch(playerId) {
  try {
    const result = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM players WHERE id = ? AND status = ?`,
        [playerId, "active"],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });

    return !!result;
  } catch (error) {
    logger.error("Error checking if player is in an active match:", error);
    return false;
  }
}

async function cleanupMatch({ thread, voiceChannelId }) {
  try {
    if (!thread || !thread.id || !thread.guild) {
      logger.warn("cleanupMatch called with invalid or missing thread.");
      return;
    }

    const dbResult = await new Promise((resolve, reject) => {
      db.get(
        `SELECT playerIds FROM channels WHERE threadId = ?`,
        [thread.id],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });

    if (!dbResult || !dbResult.playerIds) {
      logger.warn(`No match found for thread: ${thread.name} (${thread.id})`);
    } else {
      const players = dbResult.playerIds.split(",").filter(Boolean);

      if (players.length) {
        await new Promise((resolve, reject) => {
          db.run(
            `DELETE FROM players WHERE id IN (${players
              .map(() => "?")
              .join(",")})`,
            players,
            (err) => {
              if (err) {
                logger.error("Error deleting players from DB:", err.message);
                return reject(err);
              }
              logger.info(`✅ Removed ${players.length} players from DB.`);
              resolve();
            }
          );
        });

        // 🔍 Get queue_entered_at from one of the players
        const queueEnteredAt = await new Promise((resolve, reject) => {
          db.get(
            `SELECT queue_entered_at FROM player_statistics WHERE id = ?`,
            [players[0]],
            (err, row) => {
              if (err) {
                logger.error("Error fetching queue_entered_at:", err.message);
                return reject(err);
              }
              resolve(row?.queue_entered_at || null);
            }
          );
        });

        if (queueEnteredAt) {
          const matchDuration = Date.now() - queueEnteredAt;
          await updateGlobalLongestMatch(matchDuration);
        }
      }
    }

    // ✅ Delete thread
    if (thread?.deletable) {
      try {
        await thread.delete("Cleaning up inactive match");
        logger.info(`🧹 Deleted thread: ${thread.name} (${thread.id})`);
      } catch (err) {
        logger.error(`❌ Failed to delete thread ${thread.id}:`, err.message);
      }
    }

    // ✅ Handle VC cleanup
    const vc = thread.guild.channels.cache.get(voiceChannelId);
    if (vc) {
      try {
        logger.info(`🧼 Preparing to delete VC: ${vc.name} (${vc.id})`);
        await vc
          .send("⚠️ This voice channel will be deleted in 5 seconds.")
          .catch(() => {});

        await new Promise((r) => setTimeout(r, 5000));

        const members = [...vc.members.values()];
        for (const member of members) {
          try {
            await member.voice.disconnect();
            logger.info(`🔌 Disconnected ${member.user.tag} from ${vc.name}`);
          } catch (err) {
            logger.warn(
              `⚠️ Failed to disconnect ${member.user.tag}:`,
              err.message
            );
          }
        }

        await new Promise((r) => setTimeout(r, 2000));

        await vc.delete("Cleaning up inactive match");
        logger.info(`✅ Deleted voice channel: ${vc.name}`);
      } catch (error) {
        logger.error(`❌ VC cleanup failed for ${vc.name}:`, error.message);
      }
    } else {
      logger.warn(`⚠️ Voice channel not found for ID: ${voiceChannelId}`);
    }

    // ✅ Delete match entry
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM channels WHERE threadId = ?`, [thread.id], (err) => {
        if (err) {
          logger.error("Error deleting match from DB:", err.message);
          return reject(err);
        }
        resolve();
      });
    });

    logger.info(`✅ Match cleanup complete for thread: ${thread.name}`);
  } catch (error) {
    logger.error("❌ Unhandled error in cleanupMatch:", error.message);
  }
}

async function cleanupMatches(client) {
  logger.info("🧹 Running periodic cleanup...");

  client.guilds.cache.forEach(async (guild) => {
    const allThreads = guild.channels.cache.filter((channel) =>
      channel.isThread()
    );

    for (const thread of allThreads.values()) {
      try {
        const dbResult = await new Promise((resolve, reject) => {
          db.get(
            `SELECT playerIds, voiceChannelId, lastActivity FROM channels WHERE threadId = ?`,
            [thread.id],
            (err, row) => (err ? reject(err) : resolve(row))
          );
        });

        if (!dbResult) {
          logger.warn(`⚠️ No DB entry for thread: ${thread.name}`);
          continue;
        }

        const { voiceChannelId, lastActivity } = dbResult;
        const now = Date.now();

        const lastMessage = await thread.messages
          .fetch({ limit: 1 })
          .then((msgs) => msgs.first())
          .catch(() => null);

        const lastMessageTimestamp =
          lastMessage?.createdTimestamp || lastActivity;
        const minutesInactive = (now - lastMessageTimestamp) / 60000; //set time for inactivity here

        if (voiceChannelId) {
          const vc = guild.channels.cache.get(voiceChannelId);
          if (vc && vc.members.size > 0) {
            logger.info(`🎤 Skipping: ${vc.name} has ${vc.members.size} users`);
            continue;
          }
        }

        if (minutesInactive > 5) {
          logger.info(
            `🕒 Cleaning up thread ${
              thread.name
            } (inactive ${minutesInactive.toFixed(2)} min)`
          );
          await cleanupMatch({ thread, voiceChannelId });
        } else {
          logger.info(
            `⌛ Skipping: ${
              thread.name
            } is only inactive ${minutesInactive.toFixed(2)} min`
          );
        }
      } catch (err) {
        logger.error(`❌ Cleanup failed for thread ${thread.name}:`, err);
      }
    }
  });
}
module.exports = { isPlayerInActiveMatch, cleanupMatch, cleanupMatches };
