require("dotenv").config();
const db = require("./database.js");
const fs = require("fs");
const path = require("path");
const logger = console;
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  VoiceConnectionStatus,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const { checkThreadIntegrity } = require("./utils/threadIntegrityChecker");
const {
  loadMatchmakingSettings,
} = require("./utils/matchmakingUtils/loadMatchmakingSettings");
const {
  startMatchmakingLoop,
} = require("./utils/matchmakingUtils/matchmakingLoop");
const googleTTS = require("google-tts-api"); // TTS API to generate speech
const { createAudioStream } = require("prism-media"); // Convert to audio stream
const handleInteraction = require("./interactions/interactionCreate");
const { cleanupMatches } = require("./utils/matchmakingUtils/matchUtils");
const eventsPath = path.join(__dirname, "interactions", "events");
const threadMemberUpdateHandler = require("./interactions/events/threadMemberUpdate");

const eventFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith(".js"));

console.log("✅ DB from index.js:", typeof db !== "undefined");

db.get("SELECT name FROM sqlite_master WHERE type='table'", (err, row) => {
  if (err) console.error("Database error:", err);
  else console.log("Database tables:", row);
});
const {
  Client,
  Intents,
  GatewayIntentBits,
  ButtonBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonStyle,
  ChannelType,
  InteractionType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
  ComponentType,
} = require("discord.js");
const { setTimeout } = require("timers");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// load events
for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
  console.log(`✅ Loaded event: ${event.name}`);
}

// Load commands into client.commands
client.commands = new Map();
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

const commandDataArray = [];
const loadedCommandNames = new Set();

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if (
    command?.data &&
    typeof command.execute === "function" &&
    !loadedCommandNames.has(command.data.name)
  ) {
    client.commands.set(command.data.name, command);
    commandDataArray.push(command.data);
    loadedCommandNames.add(command.data.name);
    console.log(`✅ Loaded command: ${command.data.name}`);
  } else if (loadedCommandNames.has(command.data?.name)) {
    console.warn(`⚠️ Duplicate command skipped: ${command.data.name}`);
  } else {
    console.warn(`⚠️ Skipped invalid command: ${file}`);
  }
}

client.once("ready", async () => {
  console.log("🎯 Client ready event fired");
  console.log("🔍 Client status:", {
    isReady: client.isReady(),
    guilds: client.guilds.cache.size,
  });

  try {
    const { matchmakingInterval } = await loadMatchmakingSettings();
    client.matchmakingInterval = matchmakingInterval;

    console.log(
      "⏳ Starting matchmaking loop with interval:",
      matchmakingInterval
    );
    startMatchmakingLoop(client, db, matchmakingInterval);
  } catch (err) {
    console.error("❌ Failed to start matchmaking loop:", err);
  }
});
client.on("ready", async () => {
  console.log(`✅ Logged in as: ${client.user.tag}`);

  try {
    // Register all loaded commands
    const guild = client.guilds.cache.first(); // or use specific ID if needed
    await guild.commands.set(commandDataArray);

    console.log(
      `✅ Registered ${commandDataArray.length} application commands.`
    );
  } catch (error) {
    console.error("❌ Error registering commands:", error);
  }
});
client.on("interactionCreate", async (interaction) => {
  try {
    await handleInteraction(interaction);
  } catch (err) {
    logger.error("Error in interactionCreate:", err.message);
  }
});
let playerPlatformSelection = {}; // Track platform selections per player

//scans for players who manually leave threads or are manually removed by mods
client.on("threadMembersUpdate", threadMemberUpdateHandler);

//TTS test function
async function announceVCWarning(voiceChannel, message) {
  if (!voiceChannel) return console.error("No valid voice channel provided.");

  // ✅ Generate TTS audio URL
  const ttsUrl = googleTTS.getAudioUrl(message, {
    lang: "en",
    slow: false,
    host: "https://translate.google.com",
  });

  // ✅ Create a voice connection
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false, // Keep bot undeafened to interact
  });

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log("🔊 Bot is ready in the VC!");
  });

  // ✅ Create an audio player
  const player = createAudioPlayer();
  const resource = createAudioResource(ttsUrl); // Load the TTS URL

  // ✅ Handle audio events
  player.on(AudioPlayerStatus.Idle, () => {
    console.log("✅ Finished playing the message. Leaving VC...");
    connection.destroy(); // Leave the VC
  });

  player.on("error", (err) => {
    console.error("❌ Error in voice playback:", err);
    connection.destroy();
  });

  // ✅ Play the TTS message
  player.play(resource);
  connection.subscribe(player);
}

async function getPlayerStatus(playerId) {
  try {
    const player = await new Promise((resolve, reject) => {
      db.get(
        `SELECT status FROM players WHERE id = ?`,
        [playerId],
        (err, row) => {
          if (err) {
            logger.error("Error fetching player status:", err.message);
            return reject(err);
          }
          resolve(row);
        }
      );
    });

    return player?.status || null;
  } catch (error) {
    logger.error("Error in getPlayerStatus:", error.message);
    return null;
  }
}

// clean up inactive matches function scans for matches to clean up then executes cleanupmatch
setInterval(() => cleanupMatches(client), 10000);
// Run every 5 minutes CHANGE BACK!!

setInterval(() => checkThreadIntegrity(client), 10000); // 3 minutes CHANGE BACK

async function isPlayerInServer(playerId) {
  const guild = client.guilds.cache.first();
  if (!guild) return false;

  try {
    await guild.members.fetch(); // Ensure the member list is up to date
    return guild.members.cache.has(playerId); // Check if the player exists in the server
  } catch (error) {
    logger.error("Error checking if player is in the server:", error.message);
    return false;
  }
}

//helper function to validate players (queued, and still in the server)
async function validatePlayers(playerIds) {
  const invalidPlayers = [];
  for (const playerId of playerIds) {
    const isQueued = (await getPlayerStatus(playerId)) === "queued";
    const isInServer = await isPlayerInServer(playerId);

    if (!isQueued || !isInServer) {
      invalidPlayers.push(playerId);
    }
  }
  return invalidPlayers;
}

//helper function to remove players who are invalid from the database
async function removeInvalidPlayers(playerIds) {
  await new Promise((resolve, reject) => {
    const placeholders = playerIds.map(() => "?").join(",");
    db.run(
      `DELETE FROM players WHERE id IN (${placeholders})`,
      playerIds,
      (err) => {
        if (err) {
          logger.error("Error removing invalid players:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
  console.log(`Removed invalid players: ${playerIds.join(", ")}`);
}

// STATISTICS
// Player statistics
async function updateQueueStatistics(playerId, platform, isSolo) {
  const soloIncrement = isSolo ? 1 : 0;
  const duoIncrement = isSolo ? 0 : 1;

  await new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO player_statistics (id, queue_entries, queue_entries_solo, queue_entries_duo, top_platform)
       VALUES (?, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET 
         queue_entries = queue_entries + 1,
         queue_entries_solo = queue_entries_solo + ?,
         queue_entries_duo = queue_entries_duo + ?,
         top_platform = CASE 
           WHEN top_platform = ? THEN top_platform
           ELSE ?
         END`,
      [
        playerId,
        soloIncrement,
        duoIncrement,
        platform,
        soloIncrement,
        duoIncrement,
        platform,
        platform,
      ],
      (err) => {
        if (err) {
          logger.error("Error updating queue statistics:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}
async function updateDuoPartnerStatistics(player1, player2) {
  try {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO duo_partner_counts (player_id, partner_id, pair_count)
         VALUES (?, ?, 1), (?, ?, 1)
         ON CONFLICT(player_id, partner_id) DO UPDATE SET 
           pair_count = pair_count + 1`,
        [player1, player2, player2, player1],
        (err) => {
          if (err) {
            logger.error("Error updating duo partner statistics:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });
    console.log(
      `Updated duo partner statistics for ${player1} and ${player2}.`
    );
  } catch (error) {
    logger.error("Error in updateDuoPartnerStatistics:", error.message);
  }
}

async function updateMatchStatistics(players) {
  await new Promise((resolve, reject) => {
    const placeholders = players.map(() => "(?, 1)").join(",");
    const query = `
      INSERT INTO player_statistics (id, matches_played)
      VALUES ${placeholders}
      ON CONFLICT(id) DO UPDATE SET 
        matches_played = matches_played + 1
    `;
    db.run(
      query,
      players.flatMap((id) => [id, 1]),
      (err) => {
        if (err) {
          logger.error("Error updating match statistics:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

// time in match voice chat stat
const vcJoinTimes = new Map(); // Temporary in-memory storage

client.on("voiceStateUpdate", async (oldState, newState) => {
  const playerId = oldState.id;

  if (newState.channel?.name.startsWith("voice-")) {
    // Player joins a match VC
    vcJoinTimes.set(playerId, Date.now());
  } else if (
    oldState.channel?.name.startsWith("voice-") &&
    vcJoinTimes.has(playerId)
  ) {
    // Player leaves a match VC
    const joinTime = vcJoinTimes.get(playerId);
    const duration = Math.floor((Date.now() - joinTime) / 1000); // In seconds
    vcJoinTimes.delete(playerId);

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO player_statistics (id, vc_time)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET 
           vc_time = vc_time + ?`,
        [playerId, duration, duration],
        (err) => {
          if (err) {
            logger.error("Error updating VC time statistics:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });
  }
});

client.on("guildMemberRemove", async (member) => {
  const userId = member.id;
  const timestamp = Date.now();

  try {
    // Remove from queue if present
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM players WHERE id = ?`, [userId], function (err) {
        if (err) return reject(err);
        if (this.changes > 0) {
          console.info(`🛑 Player ${userId} removed from the queue.`);
        } else {
          console.info(`ℹ️ Player ${userId} was not in the queue.`);
        }
        resolve();
      });
    });

    // Check if the user was part of an active match
    const matchData = await new Promise((resolve, reject) => {
      db.get(
        `SELECT match_id, threadId, voiceChannelId FROM channels WHERE playerIds LIKE ?`,
        [`%${userId}%`],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });

    if (!matchData) {
      console.info(`ℹ️ Player ${userId} was not in an active match.`);
      return;
    }

    const { match_id, threadId, voiceChannelId } = matchData;

    // Update match_players status
    await db.run(
      `UPDATE match_players SET status = 'removed' WHERE match_id = ? AND playerId = ?`,
      [match_id, userId]
    );

    // Insert into match_events with final_status
    await db.run(
      `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
       VALUES (?, ?, ?, 'leave', ?, ?, ?)`,
      [
        match_id,
        threadId,
        userId,
        timestamp,
        "Player left the server",
        "left_server",
      ]
    );

    // Update playerIds in channels
    const { playerIds } = await new Promise((resolve, reject) => {
      db.get(
        `SELECT playerIds FROM channels WHERE threadId = ?`,
        [threadId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || {});
        }
      );
    });

    if (playerIds) {
      const updatedPlayerIds = playerIds
        .split(",")
        .filter((id) => id !== userId)
        .join(",");

      await db.run(`UPDATE channels SET playerIds = ? WHERE threadId = ?`, [
        updatedPlayerIds,
        threadId,
      ]);
    }

    // Notify the match thread
    const thread = client.channels.cache.get(threadId);
    if (thread) {
      await thread.send({
        content: `⚠️ **<@${userId}> has left the server.**`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("end_match")
              .setLabel("End Match")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId("find_replacement")
              .setLabel("Find Replacement")
              .setStyle(ButtonStyle.Primary)
          ),
        ],
      });

      // Check if match is now empty
      const remaining = await new Promise((resolve, reject) => {
        db.all(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id],
          (err, rows) =>
            err ? reject(err) : resolve(rows.map((r) => r.playerId))
        );
      });

      if (remaining.length === 0) {
        await cleanupMatch({ thread, voiceChannelId });
      }
    }
  } catch (err) {
    console.error(`❌ Error handling guildMemberRemove for ${userId}:`, err);
  }
});

// bot login token
client.login(process.env.BOT_TOKEN);
client.on("ready", async () => {
  console.log(`Logged in as: ${client.user.tag}`);
  console.log(`Connected to ${client.guilds.cache.size} guilds.`);
});

// reports # of servers bot is active in
client.guilds.cache.forEach(async (guild) => {
  console.log(`Checking guild: ${guild.name}`);
});
