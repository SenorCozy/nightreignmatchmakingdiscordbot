require("dotenv").config();
const db = require("./database.js");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");
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
const sendDuoLeavePrompt = require("./utils/sendDuoLeavePrompt");

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
  try {
    const event = require(path.join(eventsPath, file));
    if (event.once) client.once(event.name, (...a) => event.execute(...a));
    else client.on(event.name, (...a) => event.execute(...a));
    logger.info(`Loaded event: ${event.name}`);
  } catch (err) {
    logger.errorWrapper("EventLoad", err, { file });
  }
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
  try {
    const command = require(path.join(commandsPath, file));
    if (
      command?.data &&
      typeof command.execute === "function" &&
      !loadedCommandNames.has(command.data.name)
    ) {
      client.commands.set(command.data.name, command);
      commandDataArray.push(command.data);
      loadedCommandNames.add(command.data.name);
      logger.info(`Loaded command: ${command.data.name}`);
    } else {
      logger.warn(
        loadedCommandNames.has(command.data?.name)
          ? `Duplicate command skipped: ${command.data.name}`
          : `Invalid command skipped: ${file}`
      );
    }
  } catch (err) {
    logger.errorWrapper("CommandLoad", err, { file });
  }
}

client.once("ready", async () => {
  logger.info("Client ready event fired");
  try {
    const { matchmakingInterval } = await loadMatchmakingSettings();
    client.matchmakingInterval = matchmakingInterval;
    logger.info(
      `Starting matchmaking loop with interval: ${matchmakingInterval}`
    );
    startMatchmakingLoop(client, db, matchmakingInterval);
  } catch (err) {
    logger.errorWrapper("Ready_Matchmaking", err);
  }
});

client.on("ready", async () => {
  logger.info(`Logged in as: ${client.user.tag}`);
  try {
    const guild = client.guilds.cache.first();
    await guild.commands.set(commandDataArray);
    logger.info(`Registered ${commandDataArray.length} commands.`);
  } catch (err) {
    logger.errorWrapper("RegisterCommands", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    await handleInteraction(interaction);
  } catch (err) {
    logger.errorWrapper("interactionCreate", err, {
      user: interaction.user?.id,
    });
  }
});

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

// clean up inactive matches function scans for matches to clean up then executes cleanupmatch
setInterval(() => cleanupMatches(client), 10000);
// Run every 5 minutes CHANGE BACK!!

setInterval(() => checkThreadIntegrity(client), 10000); // 3 minutes CHANGE BACK

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
  const guild = member.guild;
  const timestamp = Date.now();

  try {
    // 🛑 Leave-in-progress check
    const leaveStatus = await new Promise((resolve, reject) => {
      db.get(
        `SELECT leave_in_progress FROM match_players WHERE playerId = ? AND status = 'active'`,
        [userId],
        (err, row) =>
          err ? reject(err) : resolve(row?.leave_in_progress === 1)
      );
    });

    if (leaveStatus) {
      console.warn(
        `⏭️ Skipping guildMemberRemove for ${userId} — leave already in progress.`
      );
      return;
    }

    // Lock to prevent concurrent cleanup
    await db.run(
      `UPDATE match_players SET leave_in_progress = 1 WHERE playerId = ?`,
      [userId]
    );

    // 🔍 Queue + duo handling
    try {
      const player = await new Promise((resolve, reject) => {
        db.get(
          `SELECT duoPartner FROM players WHERE id = ? AND status = 'queued'`,
          [userId],
          (err, row) => (err ? reject(err) : resolve(row || null))
        );
      });

      if (player) {
        const { duoPartner } = player;

        await new Promise((resolve, reject) => {
          db.run(`DELETE FROM players WHERE id = ?`, [userId], (err) =>
            err ? reject(err) : resolve()
          );
        });
        console.info(`🛑 Player ${userId} removed from the queue.`);

        if (duoPartner) {
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE players SET duoPartner = NULL WHERE id = ? OR id = ?`,
              [userId, duoPartner],
              (err) => (err ? reject(err) : resolve())
            );
          });
          console.info(`🔗 Duo unlinked: ${userId} & ${duoPartner}`);
          await sendDuoLeavePrompt(guild, duoPartner);
        }
      } else {
        console.info(`ℹ️ Player ${userId} was not in the queue.`);
      }
    } catch (duoErr) {
      console.error(`❌ Error handling duo/queue logic for ${userId}:`, duoErr);
    }

    // 🎮 Match cleanup
    let matchData;
    try {
      matchData = await new Promise((resolve, reject) => {
        db.get(
          `SELECT match_id, threadId, voiceChannelId FROM channels WHERE playerIds LIKE ?`,
          [`%${userId}%`],
          (err, row) => (err ? reject(err) : resolve(row || null))
        );
      });

      if (!matchData) {
        console.info(`ℹ️ Player ${userId} was not in an active match.`);
        return;
      }

      const { match_id, threadId, voiceChannelId } = matchData;

      await db.run(
        `UPDATE match_players SET status = 'removed' WHERE match_id = ? AND playerId = ?`,
        [match_id, userId]
      );

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

      const { playerIds } = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds FROM channels WHERE threadId = ?`,
          [threadId],
          (err, row) => (err ? reject(err) : resolve(row || {}))
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

      const thread = client.channels.cache.get(threadId);
      if (thread) {
        await thread.send({
          content: `⚠️ **<@${userId}> has left the server.**`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("end_match")
                .setLabel("End Match")
                .setStyle("Danger"),
              new ButtonBuilder()
                .setCustomId("find_replacement")
                .setLabel("Find Replacement")
                .setStyle("Primary")
            ),
          ],
        });

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
    } catch (matchErr) {
      console.error(`❌ Error during match cleanup for ${userId}:`, matchErr);
    }
  } catch (err) {
    console.error(
      `❌ Top-level error in guildMemberRemove for ${member.id}:`,
      err
    );
  } finally {
    // Always clear the leave_in_progress lock
    await db.run(
      `UPDATE match_players SET leave_in_progress = 0 WHERE playerId = ?`,
      [member.id]
    );
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
