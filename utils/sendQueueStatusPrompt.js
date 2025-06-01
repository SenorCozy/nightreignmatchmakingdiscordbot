const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const db = require("../database");
const logger = require("../logger");

module.exports = async function sendQueueStatusPrompt(
  guild,
  userId,
  type = "duo"
) {
  const user = guild.members.cache.get(userId);
  if (!user) {
    logger.warn(`⚠️ User ${userId} not found in guild cache.`);
    return;
  }

  const allowedTypes = ["duo", "trio"];
  const promptType = allowedTypes.includes(type) ? type : "duo";

  const messages = {
    duo: `⚠️ Your **duo partner** has left the queue. You are now queued as a solo.\nWould you like to leave the queue too?`,
    trio: `⚠️ Your **trio group** has disbanded. You are now queued alone or with fewer members.\nWould you like to leave the queue?`,
  };

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`leave_queue_${userId}`)
      .setLabel("Leave Queue")
      .setStyle(ButtonStyle.Danger)
  );

  try {
    const statusRow = await db.getAsync(
      `SELECT status FROM players WHERE id = ?`,
      [userId]
    );

    if (!statusRow || statusRow.status !== "queued") {
      logger.info(`ℹ️ Skipping prompt — ${userId} is not queued.`);
      return;
    }

    await user.send({ content: messages[promptType], components: [row] });
    logger.info(`✅ Sent DM to ${userId} about ${promptType} status update.`);
  } catch (err) {
    logger.warn(`⚠️ Could not DM ${userId} (${err.message}). Trying fallback.`);

    const fallbackChannel = guild.channels.cache.find(
      (ch) =>
        ch.name === process.env.QUEUE_ALERT_CHANNEL_NAME &&
        ch.isTextBased() &&
        ch.type === 0 // Ensure it's a normal text channel
    );

    if (fallbackChannel) {
      try {
        await fallbackChannel.send({
          content: `<@${userId}>\n${messages[promptType]}`,
          components: [row],
        });
        logger.info(`📢 Fallback alert sent in #${fallbackChannel.name}`);
      } catch (fallbackError) {
        logger.errorWrapper("QueuePromptFallback", fallbackError, {
          userId,
          channel: fallbackChannel?.id,
        });
      }
    } else {
      logger.warn(`❌ No valid fallback channel for queue alert.`);
    }
  }
};
