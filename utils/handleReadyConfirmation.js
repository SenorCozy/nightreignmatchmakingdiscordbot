const db = require("../database");
const logger = require("../logger");
const { getReadyPlayers, addReadyPlayer } = require("./readyCheckState");
const { safeSend } = require("./matchmakingUtils/matchUtils");

async function handleReadyConfirmation(
  thread,
  userId,
  source = "unknown",
  interaction = null
) {
  const readyPlayers = getReadyPlayers(thread.id);
  const alreadyReady = readyPlayers.has(userId);

  if (alreadyReady) {
    const msg = "✅ You are already marked as ready!";
    if (interaction) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: 64 }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
      }
    } else {
      await safeSend(thread, msg);
    }
    return false;
  }

  addReadyPlayer(thread.id, userId);

  try {
    const match = await db.getAsync(
      `SELECT match_id FROM channels WHERE threadId = ?`,
      [thread.id]
    );
    if (!match?.match_id) {
      logger.warn("No match found in handleReadyConfirmation", {
        threadId: thread.id,
      });
      return false;
    }

    await db.runAsync(
      `INSERT INTO match_events (
        match_id, threadId, playerId, eventType, timestamp, reason, final_status
      ) VALUES (?, ?, ?, 'ready_confirmed', ?, ?, 'ready_passed')`,
      [match.match_id, thread.id, userId, Date.now(), `Confirmed via ${source}`]
    );

    const msg = `✅ <@${userId}> is now marked as ready!`;
    if (interaction) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: 64 }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
      }
    } else {
      await safeSend(thread, msg);
    }

    return true;
  } catch (err) {
    logger.errorWrapper("Error in handleReadyConfirmation", err, {
      threadId: thread.id,
      userId,
    });
    const fallback = "❌ Failed to mark you as ready. Please try again.";

    if (interaction) {
      if (interaction.replied || interaction.deferred) {
        await interaction
          .followUp({ content: fallback, flags: 64 })
          .catch(() => {});
      } else {
        await interaction
          .reply({ content: fallback, flags: 64 })
          .catch(() => {});
      }
    } else {
      await safeSend(thread, fallback);
    }

    return false;
  }
}

module.exports = { handleReadyConfirmation };
