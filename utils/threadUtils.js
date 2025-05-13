const { ChannelType } = require("discord.js");
const db = require("../database");
function updateLastActivity(threadId) {
  db.run(
    `UPDATE channels SET lastActivity = ? WHERE threadId = ?`,
    [Date.now(), threadId],
    (err) => {
      if (err) {
        console.warn(
          `⚠️ Failed to update lastActivity for ${threadId}:`,
          err.message
        );
      }
    }
  );
}
async function safeAddToThread(thread, playerId) {
  try {
    if (!thread || !thread.members) {
      console.warn(
        `safeAddToThread: Invalid thread or missing members (${thread?.id})`
      );
      return;
    }

    const guildMember = thread.guild.members.cache.get(playerId);
    if (!guildMember) {
      console.warn(`safeAddToThread: Player ${playerId} not found in guild.`);
      return;
    }

    const botHasPermission = thread
      .permissionsFor(thread.client.user)
      ?.has("ManageThreads");

    if (!botHasPermission) {
      console.warn(
        `safeAddToThread: Bot lacks ManageThreads permission in thread ${thread.id}`
      );
      return;
    }

    await thread.members
      .add(playerId)
      .then(() => console.info(`✅ Added ${playerId} to thread ${thread.id}`))

      .catch((error) =>
        console.error(
          `safeAddToThread: Failed to add ${playerId} to thread ${thread.id}:`,
          error.message
        )
      );
    updateLastActivity(thread.id);

    if (
      thread.type === ChannelType.GuildPrivateThread &&
      thread.permissionOverwrites
    ) {
      await thread.permissionOverwrites.edit(playerId, {
        ViewChannel: true,
        SendMessages: true,
        ManageThreads: False,
      });
      console.info(
        `✅ Granted ${playerId} access to private thread ${thread.id}`
      );
    }
  } catch (error) {
    console.error(
      `safeAddToThread: Unexpected error for ${playerId} in thread ${thread?.id}:`,
      error.message
    );
  }
}

async function getOrCreateCategory(guild, platform) {
  try {
    let category = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name.toLowerCase() === `nightreign-${platform.toLowerCase()}`
    );

    if (!category) {
      category = await guild.channels.create({
        name: `Nightreign-${platform}`,
        type: ChannelType.GuildCategory,
      });
      console.info(`Created category: Nightreign-${platform}`);
    }

    return category;
  } catch (error) {
    console.error("Error fetching or creating category:", error.message);
    throw new Error("Failed to get or create category.");
  }
}

async function getOrCreatePlatformChannel(guild, platform) {
  const category = await getOrCreateCategory(guild, platform);
  const channelName = `${platform}-matches`.toLowerCase();

  let channel = guild.channels.cache.find(
    (ch) =>
      ch.name === channelName &&
      ch.parentId === category.id &&
      ch.type === ChannelType.GuildText
  );

  if (!channel) {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: `Platform-specific matchmaking channel for ${platform}`,
      parent: category.id,
    });
    console.info(`Created platform channel: ${channelName}`);
  }

  return channel;
}

module.exports = {
  safeAddToThread,
  getOrCreateCategory,
  getOrCreatePlatformChannel,
};
