const { ChannelType, PermissionsBitField } = require("discord.js");
const db = require("../database");
const logger = require("../logger");

const PLATFORM_SLUGS = {
  playstation: "ps",
  xbox: "xbox",
  pc: "pc",
};

function updateLastActivity(threadId) {
  db.run(
    `UPDATE channels SET lastActivity = ? WHERE threadId = ?`,
    [Date.now(), threadId],
    (err) => {
      if (err) {
        logger.errorWrapper("UpdateLastActivity", err, { threadId });
      }
    }
  );
}

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
      ?.has(PermissionsBitField.Flags.ManageThreads);

    if (!botHasPermission) {
      logger.warn(
        `safeAddToThread: Bot lacks ManageThreads permission in thread ${thread.id}`
      );
      return;
    }

    await thread.members
      .add(playerId)
      .then(() => {
        logger.info(`✅ Added ${playerId} to thread ${thread.id}`);
      })
      .catch((error) => {
        logger.errorWrapper("SafeAddToThread_Add", error, {
          playerId,
          threadId: thread.id,
        });
      });

    updateLastActivity(thread.id);
  } catch (error) {
    logger.errorWrapper("SafeAddToThread_Catch", error, {
      playerId,
      threadId: thread?.id,
    });
  }
}

function normalizeName(name) {
  return name
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "") // remove emojis
    .toLowerCase()
    .trim();
}

async function getOrCreateCategory(guild) {
  try {
    const targetName = "nightreign matches";

    let category = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        normalizeName(channel.name) === targetName
    );

    if (!category) {
      category = await guild.channels.create({
        name: "🌙 Nightreign Matches",
        type: ChannelType.GuildCategory,
      });
      logger.info(`📁 Created category: 🌙 Nightreign Matches`);
    }

    return category;
  } catch (error) {
    logger.errorWrapper("GetOrCreateCategory", error);
    throw new Error("Failed to get or create category.");
  }
}

async function getOrCreatePlatformChannel(guild, platform) {
  const category = await getOrCreateCategory(guild);

  const slug = PLATFORM_SLUGS[platform.toLowerCase()] || platform.toLowerCase();
  const channelName = `${slug}-matchmaking`; // e.g. "ps-matchmaking"

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
      topic: `Matchmaking thread creation area for ${slug.toUpperCase()}`,
      parent: category.id,
    });
    logger.info(`💬 Created platform matchmaking channel: ${channelName}`);
  }

  return channel;
}

module.exports = {
  safeAddToThread,
  getOrCreateCategory,
  getOrCreatePlatformChannel,
};
