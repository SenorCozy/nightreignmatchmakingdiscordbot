require("dotenv").config();
const logger = require("./logger");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  VoiceConnectionStatus,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const {
  loadMatchmakingSettings,
} = require("./utils/matchmaking/loadMatchmakingSettings");
const { startMatchmakingLoop } = require("./utils/matchmaking/matchmakingLoop");
const googleTTS = require("google-tts-api"); // TTS API to generate speech
const { createAudioStream } = require("prism-media"); // Convert to audio stream
const handleInteraction = require("./interactions/interactionCreate");
const { cleanupMatches } = require("./utils/matchamkingUtils/cleanupMatches");

client.on("interactionCreate", async (interaction) => {
  try {
    await handleInteraction(interaction);
  } catch (err) {
    logger.error("Error in interactionCreate:", err.message);
  }
});

const db = require("./database.js");
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

let playerPlatformSelection = {}; // Track platform selections per player

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
setInterval(cleanupMatches, 1 * 1500 * 1000); // Run every 5 minutes CHANGE BACK!!

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

  // Attempt to remove the user from the queue
  try {
    const result = await new Promise((resolve, reject) => {
      db.run(`DELETE FROM players WHERE id = ?`, [userId], function (err) {
        if (err) return reject(err);
        resolve(this.changes); // Number of rows affected
      });
    });

    if (result > 0) {
      logger.info(`🛑 Player ${userId} removed from the queue.`);
    } else {
      logger.info(`ℹ️ Player ${userId} was not in the queue.`);
    }
  } catch (err) {
    logger.error(`❌ Error removing player ${userId} from queue:`, err.message);
  }

  // Check if the user was part of an active match
  let matchThreadId;
  try {
    matchThreadId = await new Promise((resolve, reject) => {
      db.get(
        `SELECT threadId FROM channels WHERE playerIds LIKE ?`,
        [`%${userId}%`],
        (err, row) => {
          if (err) return reject(err);
          resolve(row ? row.threadId : null);
        }
      );
    });
  } catch (err) {
    logger.error(`❌ Error checking match status for ${userId}:`, err.message);
    return;
  }

  if (!matchThreadId) {
    logger.info(`ℹ️ Player ${userId} was not in an active match.`);
    return;
  }

  // Remove the user from the match's playerIds
  try {
    const { playerIds } = await new Promise((resolve, reject) => {
      db.get(
        `SELECT playerIds FROM channels WHERE threadId = ?`,
        [matchThreadId],
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

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
          [updatedPlayerIds, matchThreadId],
          (err) => (err ? reject(err) : resolve())
        );
      });

      logger.info(`🧹 Removed player ${userId} from match ${matchThreadId}.`);
    }
  } catch (err) {
    logger.error(`❌ Error updating match data for ${userId}:`, err.message);
  }

  // Notify the match thread
  const thread = client.channels.cache.get(matchThreadId);
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

client.once("ready", async () => {
  logger.info(`✅ Logged in as ${client.user.tag}`);

  const { matchmakingInterval } = await loadMatchmakingSettings();
  startMatchmakingLoop(matchmakingInterval);
});
