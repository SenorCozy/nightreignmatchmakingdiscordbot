const db = require("../../database");
const logger = require("../../logger");
const { evaluateEventProgress } = require("../../utils/eventUtils");
const {
  unlockStatThresholdAchievements,
  vcTimeAchievements,
} = require("../../utils/achievementHelpers");

const activeVCJoins = new Map(); // key: userId_channelId, value: join timestamp

module.exports = {
  name: "voiceStateUpdate",
  async execute(oldState, newState) {
    const userId = newState.id;
    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    // Ignore bots
    if (newState.member?.user?.bot) return;

    // ✅ Joining a voice channel
    if (!oldChannel && newChannel) {
      const vcId = newChannel.id;

      // Check if it's a tracked match VC
      const row = await new Promise((res, rej) =>
        db.get(
          `SELECT threadId FROM channels WHERE voiceChannelId = ?`,
          [vcId],
          (err, row) => (err ? rej(err) : res(row))
        )
      );

      if (row) {
        const key = `${userId}_${vcId}`;
        activeVCJoins.set(key, Date.now());
        logger.info("🎙️ VC join tracked", { userId, vcId });
      }
    }

    // ✅ Leaving a voice channel
    if (oldChannel && !newChannel) {
      const vcId = oldChannel.id;
      const key = `${userId}_${vcId}`;
      const joinedAt = activeVCJoins.get(key);

      if (joinedAt) {
        const durationMs = Date.now() - joinedAt;
        const durationSeconds = Math.floor(durationMs / 1000);
        const durationMinutes = Math.floor(durationSeconds / 60);

        try {
          // Update player statistics
          await db.runAsync(
            `UPDATE player_statistics SET vc_time = vc_time + ? WHERE id = ?`,
            [durationSeconds, userId]
          );
          // 🏆 VC Time Achievement Check
          try {
            const { vc_time } = await db.getAsync(
              `SELECT vc_time FROM player_statistics WHERE id = ?`,
              [userId]
            );

            await unlockStatThresholdAchievements(
              userId,
              "vc_time",
              vcTimeAchievements
            );
          } catch (err) {
            logger.errorWrapper("VC Time Achievement Check Failed", err, {
              userId,
            });
          }

          // 🎯 Evaluate VC time goal progress
          if (durationMinutes > 0) {
            await evaluateEventProgress(userId, "vc_minutes", durationMinutes);
          }

          logger.info("⏱️ VC time recorded", {
            userId,
            vcId,
            seconds: durationSeconds,
            minutes: durationMinutes,
          });
        } catch (err) {
          logger.errorWrapper("VC exit tracking failed", err, {
            userId,
            vcId,
            durationMs,
          });
        }

        activeVCJoins.delete(key);
      }
    }
  },
};
