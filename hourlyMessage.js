const cron = require("node-cron");
const { ChannelType } = require("discord.js");
const logger = require("./logger");

async function sendMessageToChannel(client, channelId, messageContent) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return logger.warn("Invalid or non-text channel", { channelId });
    }

    await channel.send(messageContent);
    logger.info(`📤 Sent scheduled message to ${channelId}`);
  } catch (err) {
    logger.errorWrapper("Failed to send scheduled message", err, { channelId });
  }
}

module.exports = function scheduleTwelveHourlyMessage(
  client,
  sendImmediately = false
) {
  const hourlyChannel = "1360614708943655042";
  const twoHourlyChannels = [
    "1378828261089607830",
    "1378828168680702053",
    "1378828101676564510",
  ];

  const messageContent = [
    "**📢 Matchmaking is live!**",
    "Looking for Nightreign teammates? Our matchmaking bot supports Solo, Duo, and full Trio queues!",
    "",
    "🎯 **Queue Types:**",
    "- Solo ➝ Find two others",
    "- Duo ➝ Get matched with a third",
    "- Trio ➝ Queue together and get a private space",
    "",
    "🧠 Matches respect Nightlord preferences (*always*) and VC preference (*when possible*)!",
    "🏆 Earn **achievements**, participate in **events**, and unlock **special roles**!",
    "📆 Use **`/events`** to view all active events and track your progress!",
    "",
    "💡 Have ideas or issues? Drop them in <#1381326844170731672>.",
    "💬 Queue now in <#1378832127402971216> and help keep the matchmaking system active!",
    "",
    "_This system is currently in beta — report bugs and spread the word!_",
  ].join("\n");

  // 🔁 Every 12 hours at 00:00 and 12:00
  cron.schedule("0 0,12 * * *", () => {
    sendMessageToChannel(client, hourlyChannel, messageContent);
    for (const channelId of twoHourlyChannels) {
      sendMessageToChannel(client, channelId, messageContent);
    }
  });

  // 🟢 Optional: Send immediately on startup
  if (sendImmediately) {
    sendMessageToChannel(client, hourlyChannel, messageContent);
    for (const channelId of twoHourlyChannels) {
      sendMessageToChannel(client, channelId, messageContent);
    }
  }
};
