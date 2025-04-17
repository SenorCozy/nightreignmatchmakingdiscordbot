const { ChannelType } = require("discord.js");

async function safeAddToThread(thread, playerId) {
  try {
    if (!thread || !thread.members) {
      logger.warn(
        `safeAddToThread: Invalid thread or missing members (${thread?.id})`
      );
      return;
    }

    const guildMember = thread.guild.members.cache.get(playerId);
    if (!guildMember) {
      logger.warn(`safeAddToThread: Player ${playerId} not found in guild.`);
      return;
    }

    const botHasPermission = thread
      .permissionsFor(thread.client.user)
      ?.has("ManageThreads");

    if (!botHasPermission) {
      logger.warn(
        `safeAddToThread: Bot lacks ManageThreads permission in thread ${thread.id}`
      );
      return;
    }

    await thread.members
      .add(playerId)
      .then(() => logger.info(`✅ Added ${playerId} to thread ${thread.id}`))
      .catch((error) =>
        logger.error(
          `safeAddToThread: Failed to add ${playerId} to thread ${thread.id}:`,
          error.message
        )
      );

    if (
      thread.type === ChannelType.GuildPrivateThread &&
      thread.permissionOverwrites
    ) {
      await thread.permissionOverwrites.edit(playerId, {
        ViewChannel: true,
        SendMessages: true,
      });
      logger.info(
        `✅ Granted ${playerId} access to private thread ${thread.id}`
      );
    }
  } catch (error) {
    logger.error(
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
      logger.info(`Created category: Nightreign-${platform}`);
    }

    return category;
  } catch (error) {
    logger.error("Error fetching or creating category:", error.message);
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
    logger.info(`Created platform channel: ${channelName}`);
  }

  return channel;
}

module.exports = {
  safeAddToThread,
  getOrCreateCategory,
  getOrCreatePlatformChannel,
};
