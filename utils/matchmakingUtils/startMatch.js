const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");
const db = require("../../database");
const {
  safeAddToThread,
  getOrCreatePlatformChannel,
} = require("../threadUtils");

async function startMatch(platform, players, client) {
  if (!players || players.length === 0) {
    logger.warn("⚠️ startMatch was called with an empty match list.");
    return;
  }

  try {
    const guild = client.guilds.cache.first();
    const platformChannel = await getOrCreatePlatformChannel(guild, platform);

    // ✅ Check for duplicate match
    const existingMatch = await new Promise((resolve, reject) => {
      db.get(
        `SELECT c.threadId 
           FROM channels c
           JOIN players p ON p.id IN (?, ?, ?) 
           WHERE p.status = 'active' 
           AND c.playerIds LIKE ? 
           AND c.threadId IS NOT NULL 
           LIMIT 1`,
        [players[0], players[1], players[2], `%${players.join(",")}%`],
        (err, row) => {
          if (err) {
            logger.error("Error checking existing match:", err.message);
            return reject(err);
          }
          resolve(row ? row.threadId : null);
        }
      );
    });

    if (existingMatch) {
      logger.warn(`⚠️ Duplicate match prevented: ${players.join(", ")}`);
      return;
    }

    // ✅ Create the private thread
    const thread = await platformChannel.threads.create({
      name: `match-${players.join("-")}`,
      autoArchiveDuration: 1440,
      type: ChannelType.GuildPrivateThread,
      invitable: false,
      reason: `Creating match thread for ${players.join(", ")}`,
    });

    if (!thread) {
      logger.error("❌ Failed to create match thread.");
      return;
    }

    logger.info(`✅ Created thread: ${thread.name} (${thread.id})`);

    // ✅ Insert into database
    const dbInsertSuccess = await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO channels (id, threadId, voiceChannelId, playerIds, lastActivity, lastReadyCheck)
           VALUES (?, ?, ?, ?, ?, ?)`,
        [thread.id, thread.id, null, players.join(","), Date.now(), 0],
        (err) => {
          if (err) {
            logger.error("❌ DB insert failed:", err.message);
            return reject(err);
          }
          logger.info(`✅ Match stored in DB for thread ${thread.id}`);
          resolve(true);
        }
      );
    }).catch(() => false);

    if (!dbInsertSuccess) {
      await thread.delete().catch(() => {});
      return;
    }

    // ✅ Add players to thread
    for (const playerId of players) {
      await safeAddToThread(thread, playerId);
    }

    // ✅ Send buttons
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("create_voice_channel")
        .setLabel("Create Voice Channel")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🎤"),
      new ButtonBuilder()
        .setCustomId("ready_check")
        .setLabel("Initiate Ready Check")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("✅"),
      new ButtonBuilder()
        .setCustomId("leave_match")
        .setLabel("Leave Match")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("end_match")
        .setLabel("End Match")
        .setStyle(ButtonStyle.Danger)
    );

    await thread.send({
      content: `🎮 **Match started!**\nPlayers: ${players
        .map((id) => `<@${id}>`)
        .join(", ")}\n\n**Use the buttons below to manage the match.**`,
      components: [buttons],
    });
  } catch (error) {
    logger.error(`❌ Error starting match: ${error.message}`, error.stack);
  }
}

module.exports = { startMatch };
