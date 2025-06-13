const { ActionRowBuilder, ButtonBuilder } = require("discord.js");
const db = require("../../database");
const logger = require("../../logger");

const {
  getQueuePosition,
  calculateAverageQueueTime,
} = require("../../utils/playerUtils");
const { playerPlatformSelection } = require("../../utils/globalState");
const { evaluateEventProgress } = require("../../utils/eventUtils");

const { updateDuoPartnerStatistics } = require("../../utils/playerstatshelper");

const {
  incrementBotStatistic,
  updateQueueStatistics,
  trackUniqueUser,
} = require("../../utils/statistics");
const { pendingDuoQueue } = require("../../state/pendingDuoQueue");

async function processDuoQueuePostActions(playerId, friendId, platform) {
  try {
    await Promise.all([
      updateQueueStatistics(playerId, platform, "duo"),
      updateQueueStatistics(friendId, platform, "duo"),
      trackUniqueUser(playerId),
      trackUniqueUser(friendId),
      updateDuoPartnerStatistics(playerId, friendId),
      evaluateEventProgress(playerId, "queue_entries", 1),
      evaluateEventProgress(friendId, "queue_entries", 1),
      evaluateEventProgress(playerId, "duo_queues", 1),
      evaluateEventProgress(friendId, "duo_queues", 1),
      evaluateEventProgress(playerId, "play_with_user", {
        partnerId: friendId,
      }),
      evaluateEventProgress(friendId, "play_with_user", {
        partnerId: playerId,
      }),
      incrementBotStatistic("total_queue_entries", 2),
      incrementBotStatistic(`queue_entries_${platform}`, 2),
      incrementBotStatistic("queue_entries_duo", 1),
    ]);
  } catch (err) {
    logger.errorWrapper("processDuoQueuePostActions", err, {
      playerId,
      friendId,
    });
  }
}

module.exports = {
  customIdRegex: /^duo_select_vc:(\d+):(\d+)$/,
  async execute(interaction) {
    const match = interaction.customId.match(/^duo_select_vc:(\d+):(\d+)$/);
    if (!match) return;

    const [_, userId1, userId2] = match;
    const wantsVC = interaction.values?.[0] === "vc_yes" ? 1 : 0;
    const timestamp = Date.now();

    const pending1 = pendingDuoQueue.get(userId1);
    const pending2 = pendingDuoQueue.get(userId2);

    if (!pending1 || !pending2 || pending1.friendId !== userId2) {
      return interaction.reply({
        content:
          "❌ Missing duo queue context. Please try re-queuing together.",
        flags: 64,
      });
    }

    // ⏱️ Check if the pairing has expired (5 minutes)
    if (timestamp - pending1.timestamp > 5 * 60 * 1000) {
      pendingDuoQueue.delete(userId1);
      pendingDuoQueue.delete(userId2);
      return interaction.reply({
        content: "⏱️ This duo queue request has expired. Please try again.",
        flags: 64,
      });
    }

    const platform = pending1.platform;

    try {
      const [pref1, pref2] = await Promise.all([
        db.getAsync(
          `SELECT nightlords FROM queue_preferences WHERE player_id = ?`,
          [userId1]
        ),
        db.getAsync(
          `SELECT nightlords FROM queue_preferences WHERE player_id = ?`,
          [userId2]
        ),
      ]);

      if (!pref1?.nightlords || !pref2?.nightlords) {
        logger.warn("Missing queue_preferences for one or both players", {
          userId1,
          userId2,
        });
        return interaction.reply({
          content:
            "❌ Nightlord preferences are missing. Please complete that step first.",
          flags: 64,
        });
      }

      await Promise.all([
        db.runAsync(
          `UPDATE queue_preferences SET vc_ok = ?, selected_at = ? WHERE player_id = ?`,
          [wantsVC, timestamp, userId1]
        ),
        db.runAsync(
          `UPDATE queue_preferences SET vc_ok = ?, selected_at = ? WHERE player_id = ?`,
          [wantsVC, timestamp, userId2]
        ),
      ]);

      await incrementBotStatistic(wantsVC ? "vc_pref_yes" : "vc_pref_no");

      await Promise.all([
        db.runAsync(
          `INSERT INTO players (id, platform, status, duoPartner, queue_entered_at)
           VALUES (?, ?, 'queued', ?, ?)
           ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, status = 'queued', duoPartner = excluded.duoPartner, queue_entered_at = excluded.queue_entered_at`,
          [userId1, platform, userId2, timestamp]
        ),
        db.runAsync(
          `INSERT INTO players (id, platform, status, duoPartner, queue_entered_at)
           VALUES (?, ?, 'queued', ?, ?)
           ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, status = 'queued', duoPartner = excluded.duoPartner, queue_entered_at = excluded.queue_entered_at`,
          [userId2, platform, userId1, timestamp]
        ),
      ]);

      await Promise.all([
        db.runAsync(
          `INSERT INTO queue_history (playerId, platform, duoPartner, queue_entered_at)
           VALUES (?, ?, ?, ?)`,
          [userId1, platform, userId2, timestamp]
        ),
        db.runAsync(
          `INSERT INTO queue_history (playerId, platform, duoPartner, queue_entered_at)
           VALUES (?, ?, ?, ?)`,
          [userId2, platform, userId1, timestamp]
        ),
      ]);

      // ✅ Log success
      logger.info("✅ Duo queue finalized", {
        user1: userId1,
        user2: userId2,
        platform,
        wantsVC,
      });

      pendingDuoQueue.delete(userId1);
      pendingDuoQueue.delete(userId2);

      await processDuoQueuePostActions(userId1, userId2, platform);

      const queuePosition = await getQueuePosition(userId1, platform);
      const avgWaitTime = await calculateAverageQueueTime(platform, "duo");

      const leaveButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("remove_from_queue")
          .setLabel("Leave Queue")
          .setStyle("Danger")
      );

      const content = `✅ You and <@${userId2}> have joined the **Duo** queue for **${platform.toUpperCase()}**.
**Queue Position:** ${queuePosition}
**Estimated Wait Time:** ${Math.round(avgWaitTime / 60000)} minutes.
✅ Voice chat preference recorded.
You and your partner are now fully queued!`;

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content,
          components: [leaveButton],
          flags: 64,
        });
      } else {
        await interaction.reply({
          content,
          components: [leaveButton],
          flags: 64,
        });
      }
    } catch (err) {
      logger.errorWrapper(
        "❌ Failed duo VC preference or queue finalization",
        err,
        { userId1, userId2, wantsVC }
      );

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Something went wrong saving VC preference.",
          flags: 64,
        });
      }
    }
  },
};
