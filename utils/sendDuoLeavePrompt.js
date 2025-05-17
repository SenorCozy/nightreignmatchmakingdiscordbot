const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const logger = require("../logger");

module.exports = async function sendDuoLeavePrompt(guild, partnerId) {
  const dmEmbed = {
    content: `⚠️ Your duo partner has left the queue. You are now queued as a solo.\nWould you like to leave the queue too?`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`leave_queue_${partnerId}`)
          .setLabel("Leave Queue")
          .setStyle(ButtonStyle.Danger)
      ),
    ],
  };

  const partnerMember = guild.members.cache.get(partnerId);
  if (partnerMember) {
    try {
      await partnerMember.send(dmEmbed);
      logger.info(`✅ Sent DM to ${partnerId} about duo leave.`);
    } catch (error) {
      logger.warn(
        `⚠️ Could not DM ${partnerId}, falling back to public alert.`
      );

      const fallbackChannel = guild.channels.cache.find(
        (ch) =>
          ch.name === process.env.QUEUE_ALERT_CHANNEL_NAME && ch.isTextBased()
      );

      if (fallbackChannel) {
        try {
          await fallbackChannel.send({
            content: `<@${partnerId}>`,
            ...dmEmbed,
          });
        } catch (fallbackError) {
          logger.errorWrapper("SendDuoLeavePrompt_Fallback", fallbackError, {
            partnerId,
            channel: fallbackChannel?.id,
          });
        }
      }
    }
  } else {
    logger.warn(`⚠️ Partner ${partnerId} not found in guild cache.`);
  }
};
