const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");
const { v4: uuidv4 } = require("uuid");
const db = require("../../database");
const {
  safeAddToThread,
  getOrCreatePlatformChannel,
} = require("../threadUtils");
const {
  incrementMatchesPlayed,
  trackQueueLeaveTimestamp,
} = require("../playerstatshelper");

async function startMatch(client, platform, players) {
  if (!players || players.length === 0) {
    console.warn("⚠️ startMatch was called with an empty match list.");
    return;
  }

  try {
    const allowedRoleIds = [
      process.env.TICKET_HANDLER_ROLE,
      process.env.ELDEN_MODERATOR_ROLE,
      process.env.ELDEN_ENFORCER_ROLE,
      process.env.BOT_ROLE,
    ];

    const guild = client.guilds.cache.first();

    const fetchedChannels = await guild.channels.fetch();
    const activeThreads = fetchedChannels.filter((c) => c.isThread()).size;

    if (activeThreads >= 1000) {
      console.warn("🚨 Cannot start match — thread limit (1000) reached.");

      // Revert players back to queue
      const placeholders = players.map(() => "?").join(", ");
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE players SET status = 'queued' 
       WHERE id IN (${placeholders})`,
          players,
          (err) => (err ? reject(err) : resolve())
        );
      });

      return { error: "Thread limit reached — match aborted.", players };
    }

    const platformChannel = await getOrCreatePlatformChannel(guild, platform);

    // Prevent duplicate match entry
    const existingMatch = await new Promise((resolve, reject) => {
      db.get(
        `SELECT threadId FROM match_players 
         WHERE playerId IN (${players.map(() => "?").join(",")}) 
         AND status = 'active' LIMIT 1`,
        players,
        (err, row) => (err ? reject(err) : resolve(row?.threadId || null))
      );
    });

    if (existingMatch) {
      console.warn(
        `⚠️ Duplicate match prevented. One or more players already in thread: ${existingMatch}`
      );
      return;
    }

    // Create thread
    const thread = await platformChannel.threads.create({
      name: `match-${players.join("-")}`,
      autoArchiveDuration: 1440,
      type: ChannelType.GuildPrivateThread,
      invitable: false,
      reason: `Creating match thread for ${players.join(", ")}`,
    });

    if (!thread) {
      console.error("❌ Failed to create match thread.");
      return;
    }

    const matchId = uuidv4();
    const timestamp = Date.now();

    // Insert into matches table
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO matches (match_id, thread_id, platform, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [matchId, thread.id, platform, players[0], timestamp],
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Insert into channels
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO channels 
         (id, threadId, voiceChannelId, match_id, playerIds, lastActivity, lastReadyCheck)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [thread.id, thread.id, null, matchId, players.join(","), timestamp, 0],
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Add players to match_players and log join event
    for (const playerId of players) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO match_players (match_id, threadId, playerId, status, joined_at)
           VALUES (?, ?, ?, 'active', ?)
           ON CONFLICT(match_id, playerId) DO UPDATE SET status = 'active', joined_at = ?`,
          [matchId, thread.id, playerId, timestamp, timestamp],
          (err) => (err ? reject(err) : resolve())
        );
      });

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO match_events 
           (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
           VALUES (?, ?, ?, 'join', ?, ?, 'active')`,
          [matchId, thread.id, playerId, timestamp, "startMatch"],
          (err) => (err ? reject(err) : resolve())
        );
      });

      await Promise.all([
        safeAddToThread(thread, playerId).catch(() => {}),
        incrementMatchesPlayed(playerId).catch(() => {}),
        trackQueueLeaveTimestamp(playerId).catch(() => {}),
      ]);
    }

    // Add helper roles to thread
    for (const roleId of allowedRoleIds) {
      const role = thread.guild.roles.cache.get(roleId);
      if (!role) continue;

      for (const member of role.members.values()) {
        try {
          await thread.members.add(member.id);
        } catch (err) {
          console.warn(
            `⚠️ Could not add ${member.user.tag} to thread:`,
            err.message
          );
        }
      }
    }

    // Send control buttons
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

    return { matchId, threadId: thread.id, players };
  } catch (error) {
    console.error("❌ Error in startMatch:", error.stack || error.message);
  }
}

module.exports = { startMatch };
