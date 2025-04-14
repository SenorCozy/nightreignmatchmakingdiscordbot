require("dotenv").config();
const logger = require("./logger");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  VoiceConnectionStatus,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const googleTTS = require("google-tts-api"); // TTS API to generate speech
const { createAudioStream } = require("prism-media"); // Convert to audio stream

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
let activeReadyChecks = new Map();
let playerDuoSelection = {}; // Track duo selections (player ID -> duo partner ID)
let matchmakingInterval = 10000; // Default 10s
let matchmakingTimer = setInterval(runMatchmaking, matchmakingInterval);
let matchmakingPaused = false;
let matchmakingLoop = null; // Stores the matchmaking interval reference
let isMatchmakingRunning = false;

// helper functions

async function loadMatchmakingSettings() {
  try {
    matchmakingPaused = await new Promise((resolve, reject) => {
      db.get(
        `SELECT value FROM settings WHERE key = 'matchmaking_paused'`,
        [],
        (err, row) => {
          if (err) return reject(err);
          resolve(row ? parseInt(row.value) === 1 : false);
        }
      );
    });

    matchmakingInterval = await new Promise((resolve, reject) => {
      db.get(
        `SELECT value FROM settings WHERE key = 'matchmaking_interval'`,
        [],
        (err, row) => {
          if (err) return reject(err);
          resolve(row ? parseInt(row.value) : 10000);
        }
      );
    });

    logger.info(
      `Loaded matchmaking settings: Paused=${matchmakingPaused}, Interval=${matchmakingInterval}ms`
    );
  } catch (error) {
    logger.error("Error loading matchmaking settings:", error.message);
  }
}

async function safeAddToThread(thread, playerId) {
  try {
    // ✅ Ensure thread exists and supports member management
    if (!thread || !thread.members) {
      logger.warn(
        `safeAddToThread: Thread ${thread?.id} is invalid or missing members.`
      );
      return;
    }

    // ✅ Ensure player is in the server
    const guildMember = thread.guild.members.cache.get(playerId);
    if (!guildMember) {
      logger.warn(`safeAddToThread: Player ${playerId} not found in server.`);
      return;
    }

    // ✅ Ensure bot has permission to manage threads
    if (!thread.permissionsFor(thread.client.user)?.has("ManageThreads")) {
      logger.warn(
        `safeAddToThread: Bot lacks ManageThreads permission in thread ${thread.id}`
      );
      return;
    }

    // ✅ Add the player to the private thread
    await thread.members
      .add(playerId)
      .then(() => logger.info(`✅ Added ${playerId} to thread ${thread.id}`))
      .catch((error) => {
        logger.error(
          `safeAddToThread: Failed to add ${playerId} to thread ${thread.id}:`,
          error.message
        );
      });

    // ✅ Ensure the thread is private & permissions are properly assigned
    if (thread.type === ChannelType.GuildPrivateThread) {
      if (thread.permissionOverwrites) {
        await thread.permissionOverwrites.edit(playerId, {
          ViewChannel: true,
          SendMessages: true,
        });
        logger.info(
          `✅ Granted ${playerId} view/send permissions for private thread ${thread.id}`
        );
      } else {
        logger.warn(
          `⚠️ safeAddToThread: Permission overwrites are undefined for thread ${thread.id}`
        );
      }
    }
  } catch (error) {
    logger.error(
      `safeAddToThread: Unexpected error for ${playerId} in thread ${thread?.id}:`,
      error.message
    );
  }
}

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

async function getQueuePosition(playerId, platform) {
  return new Promise((resolve, reject) => {
    logger.info(
      `🔍 Fetching queue position for player ${playerId} on platform ${platform}`
    );

    db.all(
      `SELECT id, queue_entered_at FROM players WHERE platform = ? AND status = 'queued' ORDER BY queue_entered_at;`,
      [platform],
      (err, queue) => {
        if (err) {
          logger.error(
            `❌ SQL Error fetching queue data for platform ${platform}: ${err.message}`
          );
          return reject(err);
        }

        if (!queue || queue.length === 0) {
          logger.warn(
            `🚫 No players in queue for platform ${platform}. Defaulting position to 1.`
          );
          return resolve(1);
        }

        // ✅ Log queue for debugging
        logger.info(`📊 Current Queue for platform ${platform}:`, queue);

        queue.forEach((player) => {
          logger.info(
            `   - Player ID: ${player.id} (Type: ${typeof player.id})`
          );
        });

        // ✅ Ensure player exists in queue
        const normalizedPlayerId = String(playerId);
        const playerIndex = queue.findIndex(
          (player) => String(player.id) === normalizedPlayerId
        );

        if (playerIndex === -1) {
          logger.warn(
            `⚠️ Player ${playerId} NOT FOUND in queue list! Possible reasons:`
          );
          logger.warn(`   1️⃣ The player is not in the 'players' table.`);
          logger.warn(
            `   2️⃣ The player's 'status' is not 'queued' (check FULL PLAYER LIST log above).`
          );
          logger.warn(`   3️⃣ The player has an incorrect platform.`);
          return resolve(1);
        }

        // ✅ Convert index (0-based) to 1-based position
        const queuePosition = playerIndex + 1;
        logger.info(
          `✅ Queue position for player ${playerId} on platform ${platform}: ${queuePosition}`
        );

        resolve(queuePosition);
      }
    );
  });
}

async function initiateReadyCheck(thread, players) {
  const readyPlayers = new Set();
  const timeLimit = 180000; // 3 minutes
  const warningIntervals = [120000, 60000, 10000]; // 2 min, 1 min, 10 sec

  // ✅ Fetch the platform for this match
  const platform = await new Promise((resolve, reject) => {
    db.get(
      `SELECT platform FROM players WHERE id = ?`,
      [players[0]], // Use the first player in the match to determine platform
      (err, row) => {
        if (err) {
          logger.error("Error fetching platform:", err.message);
          return reject(err);
        }
        resolve(row ? row.platform : null);
      }
    );
  });

  if (!platform) {
    logger.error("Error: Platform not found for match.");
    return thread.send("❌ An error occurred: Could not determine platform.");
  }

  try {
    // ✅ Ensure thread still exists before proceeding
    if (!thread || !thread.guild || !thread.isThread()) {
      logger.warn(
        `⚠️ Ready check aborted: Thread ${thread?.id} no longer exists.`
      );
      return;
    }

    // ✅ Notify players & ping them
    await thread.send(
      `🟢 **Ready Check Started!** 🟢\n
       ${players.map((id) => `<@${id}>`).join(", ")}\n
       All players must confirm readiness within **3 minutes**. If you do not respond, you will be **kicked and replaced from the queue.**`
    );

    // ✅ Create button
    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("confirm_ready")
        .setLabel("I'm Ready!")
        .setStyle(ButtonStyle.Success)
    );

    await thread.send({
      content: `Click the button below or type **!ready** to confirm your presence.`,
      components: [button],
    });

    // ✅ Button collector for 3 minutes
    const collector = thread.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: timeLimit,
      filter: (interaction) => interaction.customId === "confirm_ready",
    });

    collector.on("collect", async (interaction) => {
      if (!players.includes(interaction.user.id)) {
        return interaction.reply({
          content: "You are not part of this match.",
          flags: 64,
        });
      }

      readyPlayers.add(interaction.user.id);
      await interaction.reply({
        content: `✅ You are marked as ready!`,
        flags: 64,
      });
    });

    // ✅ Countdown Warning Function
    warningIntervals.reverse().forEach((interval, index) => {
      setTimeout(async () => {
        const unreadyPlayers = players.filter((p) => !readyPlayers.has(p));

        if (unreadyPlayers.length > 0) {
          let timeLeftMsg =
            index === 0 ? "10 seconds" : index === 1 ? "1 minute" : "2 minutes";

          await thread.send(
            `⏳ **${timeLeftMsg} remaining!** The following players have not confirmed readiness: ${unreadyPlayers
              .map((id) => `<@${id}>`)
              .join(", ")}`
          );
        }
      }, timeLimit - interval); // Ensure the warnings count down correctly
    });

    collector.on("end", async () => {
      // Check if thread still exists before sending messages
      if (!thread || !thread.guild || !thread.isThread()) {
        logger.warn(
          `⚠️ Ready check ended, but thread ${thread?.id} no longer exists.`
        );
        return;
      }
      const guild = thread.guild;
      const updatedPlayers = players.filter((id) =>
        guild.members.cache.has(id)
      ); // ✅ Remove players who left the server
      const unreadyPlayers = updatedPlayers.filter((p) => !readyPlayers.has(p));

      // ✅ If all players fail the ready check, delete match
      if (unreadyPlayers.length === updatedPlayers.length) {
        await thread.send(
          "❌ **No players responded to the ready check. The match will be closed.**"
        );

        // ✅ Fetch voice channel ID
        const voiceChannelId = await new Promise((resolve, reject) => {
          db.get(
            `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
            [thread.id],
            (err, row) => {
              if (err) {
                logger.error("Error fetching voice channel:", err.message);
                return reject(err);
              }
              resolve(row ? row.voiceChannelId : null);
            }
          );
        });

        // ✅ Delete the match and remove from DB
        await cleanupMatch({ thread, voiceChannelId });
        return;
      }
      if (unreadyPlayers.length > 0) {
        await thread.send(
          `⛔ **The following players did not respond and have been kicked:** ${unreadyPlayers
            .map((id) => `<@${id}>`)
            .join(", ")}`
        );

        for (const playerId of unreadyPlayers) {
          // ✅ Remove player from match database
          await removePlayerFromMatch(playerId, thread.id);

          // ✅ Remove player from the thread
          await thread.members.remove(playerId).catch(() => {});

          // ✅ Explicitly deny access to the thread to prevent rejoining
          if (thread?.permissionOverwrites) {
            await thread.permissionOverwrites
              ?.create(playerId, {
                ViewChannel: false,
                SendMessages: false,
              })
              .catch(() => {});
          }

          // ✅ Remove player from voice channel (if applicable)
          const voiceChannelId = await new Promise((resolve, reject) => {
            db.get(
              `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
              [thread.id],
              (err, row) => {
                if (err) {
                  logger.error("Error fetching voice channel:", err.message);
                  return reject(err);
                }
                resolve(row ? row.voiceChannelId : null);
              }
            );
          });

          if (voiceChannelId) {
            const voiceChannel = guild.channels.cache.get(voiceChannelId);
            if (voiceChannel) {
              await voiceChannel.permissionOverwrites
                .create(playerId, {
                  ViewChannel: false,
                  Connect: false,
                  Speak: false,
                })
                .catch(() => {});
              await voiceChannel.members
                .get(playerId)
                ?.voice.disconnect()
                .catch(() => {});
            }
          }
        }

        // ✅ Check if enough replacements are available before calling !search
        const replacementsAvailable = await new Promise((resolve, reject) => {
          db.get(
            `SELECT COUNT(*) AS count FROM players WHERE platform = ? AND status = 'queued'`,
            [platform],
            (err, row) => {
              if (err) {
                logger.error(
                  "Error checking available replacements:",
                  err.message
                );
                return reject(err);
              }
              resolve(row ? row.count >= unreadyPlayers.length : false);
            }
          );
        });

        if (replacementsAvailable) {
          await thread.send(`🔍 **Searching for replacements...**`);
          const searchResult = await commands["!search"](thread, [
            `!search`,
            unreadyPlayers.length.toString(),
          ]);

          if (!searchResult) {
            await thread.send(
              `⚠️ Not enough replacement players available. Please try running !search again or end the match.`
            );
          }
        } else {
          await thread.send(
            `⚠️ Not enough replacement players available. Please try running !search again or end the match.`
          );
        }
      }

      // ✅ Only send "All Players Ready" if the number of players in the match is still 3+
      const finalPlayers = await new Promise((resolve, reject) => {
        db.get(
          `SELECT COUNT(*) AS count FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => {
            if (err) {
              logger.error(
                "Error checking player count in match:",
                err.message
              );
              return reject(err);
            }
            resolve(row ? row.count : 0);
          }
        );
      });

      if (finalPlayers >= 3) {
        await thread.send(`✅ **All players are ready! The match continues.**`);
      }
    });
  } catch (error) {
    logger.error(`❌ Error during ready check: ${error.message}`);
  }
}

async function prioritizePlatformsByQueueTime() {
  const platforms = ["pc", "xbox", "playstation"];
  const platformWaitTimes = {};

  for (const platform of platforms) {
    platformWaitTimes[platform] = await calculateAverageQueueTime(
      platform,
      "solo"
    );
  }

  platforms.sort((a, b) => platformWaitTimes[b] - platformWaitTimes[a]);

  return platforms;
}

async function enforceQueueCooldown(playerId) {
  const lastQueueTime = await new Promise((resolve, reject) => {
    db.get(
      `SELECT queue_entered_at FROM players WHERE id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          logger.error("Error checking last queue time:", err.message);
          return reject(err);
        }
        resolve(row?.queue_entered_at || 0);
      }
    );
  });

  if (Date.now() - lastQueueTime < 30000) {
    // 30-second cooldown
    throw new Error(
      "🚫 You must wait 30 seconds before re-entering the queue."
    );
  }
}

async function handleOrphanedDuos(playerId) {
  const player = await getPlayerById(playerId);

  if (!player || !player.duoPartner) return;

  const partnerStillQueued = await new Promise((resolve, reject) => {
    db.get(
      `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
      [player.duoPartner],
      (err, row) => {
        if (err) {
          logger.error("Error checking duo partner status:", err.message);
          return reject(err);
        }
        resolve(row ? true : false);
      }
    );
  });

  if (!partnerStillQueued) {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE players SET duoPartner = NULL WHERE id = ?`,
        [playerId],
        (err) => {
          if (err) {
            logger.error("Error clearing orphaned duo partner:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });

    logger.info(
      `Duo partner removed for ${playerId} since their partner left the queue.`
    );
  }
}

async function calculateAverageQueueTime(platform, queueType) {
  return new Promise((resolve, reject) => {
    db.all(
      `
      SELECT (queue_left_at - queue_entered_at) AS wait_time
      FROM player_statistics
      WHERE platform = ? 
      AND queue_entered_at IS NOT NULL 
      AND queue_left_at IS NOT NULL 
      AND status = 'completed'
      AND duoPartner IS ${queueType === "solo" ? "NULL" : "NOT NULL"}
      AND (queue_left_at - queue_entered_at) > 60000  -- Ignore wait times <1 minute (likely instant matches)
      AND (queue_left_at - queue_entered_at) < 1800000  -- Ignore extreme outliers >30 minutes
      ORDER BY queue_left_at DESC
      LIMIT 20
      `,
      [platform],
      (err, rows) => {
        if (err) {
          logger.error("Error calculating average queue time:", err.message);
          return reject(err);
        }

        if (rows.length === 0) {
          return resolve(0); // No data available
        }

        const totalTime = rows.reduce((sum, row) => sum + row.wait_time, 0);
        const avgTime = totalTime / rows.length;
        resolve(avgTime);
      }
    );
  });
}

// Helper to update player statuses
async function updatePlayerStatus(playerIds, status) {
  await Promise.all(
    playerIds.map(
      (playerId) =>
        new Promise((resolve, reject) => {
          db.run(
            `UPDATE players SET status = ? WHERE id = ?`,
            [status, playerId],
            (err) => {
              if (err) {
                logger.error(
                  `Error updating player status for ${playerId}:`,
                  err.message
                );
                return reject(err);
              }
              resolve();
            }
          );
        })
    )
  );
}

async function isPlayerInActiveMatch(playerId) {
  try {
    const result = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM players WHERE id = ? AND status = ?`,
        [playerId, "active"],
        (err, row) => {
          if (err) {
            return reject(err);
          }
          resolve(row);
        }
      );
    });

    return !!result;
  } catch (error) {
    logger.error("Error checking if player is in an active match:", error);
    return false;
  }
}

// Helper Functions for adding a player to a match
async function fetchMatchData(textChannelId, voiceChannelId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT playerIds FROM channels WHERE textChannelId = ? OR voiceChannelId = ?`,
      [textChannelId, voiceChannelId],
      (err, row) => {
        if (err) {
          logger.error("Database error fetching match data:", err.message);
          return reject(err);
        }
        resolve(row || null);
      }
    );
  });
}

async function isPlayerInMatch(playerId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM channels WHERE playerIds LIKE ?`,
      [`%${playerId}%`],
      (err, row) => {
        if (err) {
          logger.error("Database error checking player status:", err.message);
          return reject(err);
        }
        resolve(!!row);
      }
    );
  });
}

async function updateMatchPlayers(textChannelId, voiceChannelId, playerIds) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE channels SET playerIds = ? WHERE textChannelId = ? OR voiceChannelId = ?`,
      [playerIds.join(","), textChannelId, voiceChannelId],
      (err) => {
        if (err) {
          logger.error("Database error updating player IDs:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

async function updateChannelPermissions(channel, userId, permissions) {
  try {
    await channel.permissionOverwrites.create(userId, permissions);
  } catch (err) {
    logger.error(
      `Error setting permissions for user ${userId} in channel ${channel.name}:`,
      err.message
    );
    throw new Error(
      `Failed to update permissions for <@${userId}> in ${channel.name}.`
    );
  }
}

//helper functions for removing players from the match
async function fetchPlayerById(playerId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, status FROM players WHERE id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          logger.error("Error querying player from database:", err.message);
          return reject(err);
        }
        resolve(row || null);
      }
    );
  });
}

async function fetchPlayerChannels(playerId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT textChannelId, voiceChannelId FROM channels WHERE playerIds LIKE ?`,
      [`%${playerId}%`],
      (err, rows) => {
        if (err) {
          logger.error(
            "Error fetching channels for permission removal:",
            err.message
          );
          return reject(err);
        }
        resolve(rows || []);
      }
    );
  });
}

async function removeChannelPermissions(channel, playerId) {
  try {
    await channel.permissionOverwrites.delete(playerId);
    logger.info(
      `Removed permissions for player ${playerId} in channel ${channel.name}.`
    );
  } catch (err) {
    logger.error(
      `Failed to remove permissions for player ${playerId} in channel ${channel.name}:`,
      err.message
    );
  }
}

async function removePlayerFromMatch(playerId, threadId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT playerIds FROM channels WHERE threadId = ?`,
      [threadId],
      (err, row) => {
        if (err) {
          logger.error("Error fetching match data:", err.message);
          return reject(err);
        }
        if (!row) {
          logger.warn("Match not found in database, skipping removal.");
          return resolve();
        }

        const updatedPlayerIds = row.playerIds
          .split(",")
          .filter((id) => id !== playerId)
          .join(",");

        db.run(
          `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
          [updatedPlayerIds, threadId],
          (err) => {
            if (err) {
              logger.error("Error updating match players:", err.message);
              return reject(err);
            }

            // ✅ Ensure the player's status is updated
            db.run(
              `UPDATE players SET status = NULL, platform = 'unknown', duoPartner = NULL, queue_entered_at = NULL WHERE id = ?`,
              [playerId],

              (err) => {
                if (err) {
                  logger.error("Error updating player status:", err.message);
                  return reject(err);
                }
                resolve();
              }
            );
          }
        );
      }
    );
  });
}

async function fetchEmptyChannels() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT textChannelId, voiceChannelId FROM channels WHERE playerIds = '' OR playerIds IS NULL`,
      (err, rows) => {
        if (err) {
          logger.error(
            "Error fetching empty channels for cleanup:",
            err.message
          );
          return reject(err);
        }
        resolve(rows || []);
      }
    );
  });
}

//!nuke helper function #1
async function deleteBotThreadsAndVoiceChannels(guild) {
  try {
    // ✅ Fetch all active threads in channels related to matchmaking
    const allThreads = await guild.channels.fetchActiveThreads();
    const botThreads = allThreads.threads.filter(
      (thread) =>
        thread.name.startsWith("match-") && thread.ownerId === client.user.id
    );

    for (const thread of botThreads.values()) {
      await thread
        .delete("Nuke command executed")
        .catch((err) =>
          logger.error(`Failed to delete thread (${thread.name}):`, err.message)
        );
    }

    // ✅ Fetch and delete only bot-created voice channels
    const botVoiceChannels = guild.channels.cache.filter(
      (channel) =>
        channel.type === ChannelType.GuildVoice &&
        (channel.name.startsWith("match-voice-") ||
          channel.parent?.name?.toLowerCase().includes("matches"))
    );

    for (const voiceChannel of botVoiceChannels.values()) {
      await voiceChannel
        .delete("Nuke command executed")
        .catch((err) =>
          logger.error(
            `Failed to delete voice channel (${voiceChannel.name}):`,
            err.message
          )
        );
    }

    logger.info(
      "✅ All matchmaking-related threads and voice channels deleted."
    );
  } catch (error) {
    logger.error(
      "❌ Error deleting matchmaking-related threads and voice channels:",
      error.message
    );
    throw new Error(
      "Failed to delete bot-created matchmaking threads and voice channels."
    );
  }
}

//!nuke helper function #2
async function clearDatabaseTables() {
  try {
    // ✅ Remove all queued players
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM players`, (err) => {
        if (err) {
          logger.error("❌ Error clearing players table:", err.message);
          return reject(err);
        }
        resolve();
      });
    });

    // ✅ Remove all active matches
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM channels`, (err) => {
        if (err) {
          logger.error("❌ Error clearing channels table:", err.message);
          return reject(err);
        }
        resolve();
      });
    });

    logger.info("✅ Queue and match data successfully cleared.");
  } catch (error) {
    logger.error("❌ Error clearing database tables:", error.message);
    throw new Error("Failed to clear database tables.");
  }
}

//get's the player id from database and supplies it where needed
async function getPlayerById(playerId, fields = "*") {
  try {
    return await new Promise((resolve, reject) => {
      db.get(
        `SELECT ${fields} FROM players WHERE id = ?`,
        [playerId],
        (err, row) => {
          if (err) {
            logger.error(
              `Error fetching player ${playerId} from database:`,
              err.message
            );
            return reject(err);
          }
          resolve(row || null); // Return null if no player is found
        }
      );
    });
  } catch (error) {
    logger.error(
      `Unexpected error in getPlayerById(${playerId}):`,
      error.message
    );
    throw new Error("Failed to fetch player data from the database.");
  }
}

async function deletePlayer(playerId) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM players WHERE id = ?`, [playerId], (err) => {
      if (err) {
        logger.error("Error deleting player from database:", err.message);
        return reject(err);
      }
      logger.info(`Player ${playerId} has been removed from the database.`);
      resolve();
    });
  });
}

// helper functions for !botstats
async function fetchBotStatistics() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM bot_statistics`, [], (err, rows) => {
      if (err) {
        logger.error("Error fetching bot statistics:", err.message);
        return reject(err);
      }
      resolve(rows || []);
    });
  });
}

async function fetchTopPlayers(limit) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, matches_played, queue_entries_solo, queue_entries_duo FROM player_statistics 
       ORDER BY matches_played DESC 
       LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) {
          logger.error("Error fetching top players:", err.message);
          return reject(err);
        }
        resolve(rows || []);
      }
    );
  });
}

async function fetchAverageQueueTimes() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT p.platform,
              CASE WHEN p.duoPartner IS NULL THEN 'solo' ELSE 'duo' END AS queue_type,
              AVG(ps.queue_left_at - ps.queue_entered_at) AS avg_time
       FROM players p
       JOIN player_statistics ps ON p.id = ps.id
       WHERE ps.queue_entered_at IS NOT NULL AND ps.queue_left_at IS NOT NULL
       GROUP BY p.platform, queue_type`,
      [],
      (err, rows) => {
        if (err) {
          logger.error("Error fetching average queue times:", err.message);
          return reject(err);
        }
        resolve(rows || []);
      }
    );
  });
}
async function trackUniqueUser(userId) {
  try {
    const isTracked = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM player_statistics WHERE id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            logger.error("Error checking if user is unique:", err.message);
            return reject(err);
          }
          resolve(!!row); // Resolve to true if row exists, otherwise false
        }
      );
    });

    if (!isTracked) {
      // Increment the unique_users stat
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO bot_statistics (stat_key, stat_value)
           VALUES ('unique_users', 1)
           ON CONFLICT(stat_key) DO UPDATE SET 
             stat_value = stat_value + 1`,
          [],
          (err) => {
            if (err) {
              logger.error(
                "Error incrementing unique_users statistic:",
                err.message
              );
              return reject(err);
            }
            resolve();
          }
        );
      });
    }
  } catch (error) {
    logger.error("Error in trackUniqueUser:", error.message);
  }
}

//helper functions for player statistics
async function fetchPlayerStatistics(playerId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM player_statistics WHERE id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          logger.error("Error fetching player statistics:", err.message);
          return reject(err);
        }
        resolve(row || null);
      }
    );
  });
}

async function fetchMostCommonDuoPartner(playerId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT partner_id, MAX(pair_count) as count 
       FROM duo_partner_counts 
       WHERE player_id = ?`,
      [playerId],
      (err, row) => {
        if (err) {
          logger.error("Error fetching most common duo partner:", err.message);
          return reject(err);
        }
        resolve(row || null);
      }
    );
  });
}
// Track failed ready checks
async function trackFailedReadyCheck(playerId) {
  return new Promise((resolve, reject) => {
    db.run(
      `
          INSERT INTO player_statistics (id, failed_ready_checks)
          VALUES (?, 1)
          ON CONFLICT(id) DO UPDATE SET failed_ready_checks = failed_ready_checks + 1
      `,
      [playerId],
      (err) => {
        if (err) {
          logger.error("Error tracking failed ready check:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

// Track longest match time for a player
async function trackLongestMatchTime(playerId, matchTime) {
  return new Promise((resolve, reject) => {
    db.run(
      `
          UPDATE player_statistics
          SET longest_match_time = MAX(longest_match_time, ?)
          WHERE id = ?
      `,
      [matchTime, playerId],
      (err) => {
        if (err) {
          logger.error("Error tracking longest match time:", err.message);
          return reject(err);
        }
        resolve();
      }
    );
  });
}
//helper functions for clearing statistics
async function clearAllStatistics() {
  try {
    // Clear player statistics
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM player_statistics`, (err) => {
        if (err) {
          logger.error("Error clearing player statistics:", err.message);
          return reject(err);
        }
        logger.info("Cleared all player statistics.");
        resolve();
      });
    });

    // Clear duo partner counts
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM duo_partner_counts`, (err) => {
        if (err) {
          logger.error("Error clearing duo partner statistics:", err.message);
          return reject(err);
        }
        logger.info("Cleared all duo partner statistics.");
        resolve();
      });
    });
  } catch (error) {
    logger.error("Error clearing all statistics:", error.message);
    throw error;
  }
}

async function clearPlayerStatistics(playerId) {
  try {
    // Clear individual player statistics
    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM player_statistics WHERE id = ?`,
        [playerId],
        (err) => {
          if (err) {
            logger.error(
              `Error clearing player statistics for player ${playerId}:`,
              err.message
            );
            return reject(err);
          }
          logger.info(
            `Cleared statistics for player ${playerId} in player_statistics.`
          );
          resolve();
        }
      );
    });

    // Clear individual duo partner statistics
    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM duo_partner_counts WHERE player_id = ? OR partner_id = ?`,
        [playerId, playerId],
        (err) => {
          if (err) {
            logger.error(
              `Error clearing duo partner statistics for player ${playerId}:`,
              err.message
            );
            return reject(err);
          }
          logger.info(`Cleared duo partner statistics for player ${playerId}.`);
          resolve();
        }
      );
    });
  } catch (error) {
    logger.error(
      `Error clearing statistics for player ${playerId}:`,
      error.message
    );
    throw error;
  }
}
// event listener for bot commands
client.on("messageCreate", async (message) => {
  if (message.author.bot) return; // Ignore bot messages

  const args = message.content.split(" "); // Split message into command and arguments
  const command = args[0]; // Extract the command (e.g., "!add")

  const commandHandler = commands[command]; // Find the corresponding handler

  if (message.channel.isThread()) {
    db.run(
      `UPDATE channels SET lastActivity = ? WHERE threadId = ?`,
      [Date.now(), message.channel.id],
      (err) => {
        if (err) {
          logger.error(
            `Failed to update lastActivity for thread ${message.channel.name}:`,
            err.message
          );
        }
      }
    );
    logger.info(`Updated lastActivity for thread: ${message.channel.name}`);
  }

  if (message.channel.name.startsWith("match-")) {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO player_statistics (id, messages_sent)
           VALUES (?, 1)
           ON CONFLICT(id) DO UPDATE SET messages_sent = messages_sent + 1`,
        [message.author.id],
        (err) => {
          if (err) {
            logger.error("Error updating message statistics:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });
  }
  if (commandHandler) {
    try {
      await commandHandler(message, args); // Pass message and arguments to the handler
    } catch (error) {
      logger.error(`Error executing command ${command}:`, error.message);
      message.reply("An error occurred while executing the command.");
    }
  }
});

// bot commands
const commands = {
  "!start": async (message) => {
    try {
      const buttonJoin = new ButtonBuilder()
        .setCustomId("join_queue")
        .setLabel("Enter Nightreign Matchmaking Queue")
        .setStyle(ButtonStyle.Primary);

      const buttonRemove = new ButtonBuilder()
        .setCustomId("remove_from_queue")
        .setLabel("Remove me from Queue")
        .setStyle(ButtonStyle.Danger);

      const buttonCheckStatus = new ButtonBuilder()
        .setCustomId("check_queue_status")
        .setLabel("Check my Queue Status")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(
        buttonJoin,
        buttonRemove,
        buttonCheckStatus
      );

      const embed = new EmbedBuilder()
        .setTitle("Welcome to the Nightreign Matchmaking!")
        .setDescription(
          "Click the button below to enter the matchmaking queue."
        )
        .setColor("#7289DA")
        .setThumbnail("https://your-image-link.com");

      await message.channel.send({ embeds: [embed], components: [row] });
    } catch (error) {
      logger.error("Error handling !start command:", error.message);
      message.reply(
        "An error occurred while displaying the queue interface. Please try again."
      );
    }
    return; // Stop further execution
  },

  "!ready": async (message) => {
    try {
      const thread = message.channel;
      if (!thread.isThread()) {
        return message.reply(
          "You can only use this command inside a match thread."
        );
      }

      // Ensure activeReadyChecks is defined
      if (!activeReadyChecks) activeReadyChecks = new Map();

      // ✅ Fetch match data
      const dbResult = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, lastReadyCheck FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => {
            if (err) return reject(err);
            resolve(row);
          }
        );
      });

      if (!dbResult) {
        return message.reply("This match is not in the database.");
      }

      const { playerIds, lastReadyCheck } = dbResult;
      const players = playerIds.split(",");
      const now = Date.now();
      const cooldown = 15 * 60 * 1000; // 15-minute cooldown

      // ✅ Check if a ready check is already active
      if (activeReadyChecks.has(thread.id)) {
        const readyCheckData = activeReadyChecks.get(thread.id);
        readyCheckData.readyPlayers.add(message.author.id);
        return message.reply(`✅ **You are marked as ready!**`);
      }

      // ✅ Admins can bypass cooldown
      const isAdmin = message.member.permissions.has(
        PermissionFlagsBits.ManageChannels
      );

      if (!isAdmin && now - lastReadyCheck < cooldown) {
        return message.reply(
          "A ready check was already conducted recently. Please wait before trying again."
        );
      }

      // ✅ Update cooldown in DB
      db.run(`UPDATE channels SET lastReadyCheck = ? WHERE threadId = ?`, [
        now,
        thread.id,
      ]);

      // ✅ Start Ready Check
      activeReadyChecks.set(thread.id, { readyPlayers: new Set() });
      await initiateReadyCheck(thread, players);
    } catch (error) {
      logger.error(`Error handling !ready command: ${error.message}`);
    }
  },

  //allows players in active matches to pull 1 or 2 players from the queue to keep playing.
  "!search": async (message, args) => {
    try {
      if (!message.channel?.isThread()) {
        logger.warn(`⚠️ !search attempted outside of a match thread.`);
        return message.channel?.send(
          "❌ `!search` must be used inside an active match thread."
        );
      }

      const thread = message.channel;
      const requestedPlayers = parseInt(args[1], 10);

      if (
        isNaN(requestedPlayers) ||
        requestedPlayers < 1 ||
        requestedPlayers > 2
      ) {
        logger.warn(
          `⚠️ Invalid number of players requested in !search: ${args[1]}`
        );
        return thread.send(
          "Usage: `!search <1 or 2>` to find replacement players."
        );
      }

      // ✅ Fetch match details
      logger.info(`Fetching match details for thread ID: ${thread.id}`);
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => {
            if (err) {
              logger.error(
                `❌ SQL Error in !search (Fetching match details): ${err.message}`
              );
              return reject(err);
            }
            resolve(row);
          }
        );
      });

      if (!match) {
        logger.warn(`⚠️ No match found for thread ID: ${thread.id}`);
        return thread.send("❌ This match no longer exists.");
      }

      let playerIds = match.playerIds.split(",").filter(Boolean);
      const maxPlayers = 3;
      if (playerIds.length >= maxPlayers) {
        logger.warn(`⚠️ !search attempted when match already has 3 players.`);
        return thread.send("⚠️ This match already has 3 players.");
      }

      const remainingSlots = maxPlayers - playerIds.length;
      const neededPlayers = Math.min(requestedPlayers, remainingSlots);

      // ✅ Get the match platform
      logger.info(`Fetching platform for player ID: ${playerIds[0]}`);
      const platform = await new Promise((resolve, reject) => {
        db.get(
          `SELECT platform FROM players WHERE id = ?`,
          [playerIds[0]], // Use the first active player to determine platform
          (err, row) => {
            if (err) {
              logger.error(`❌ SQL Error fetching platform: ${err.message}`);
              return reject(err);
            }
            resolve(row?.platform || null);
          }
        );
      });

      if (!platform) {
        logger.warn(`⚠️ Platform not found for thread ID: ${thread.id}`);
        return thread.send("❌ Error retrieving platform type.");
      }

      // ✅ Fetch queued players
      logger.info(
        `Fetching up to ${neededPlayers} queued players for platform: ${platform}`
      );
      const queuedPlayers = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id FROM players WHERE platform = ? AND status = 'queued' ORDER BY queue_entered_at ASC LIMIT ?`,
          [platform, neededPlayers],
          (err, rows) => {
            if (err) {
              logger.error(
                `❌ SQL Error fetching queued players: ${err.message}`
              );
              return reject(err);
            }
            resolve(rows.map((row) => row.id));
          }
        );
      });

      if (!queuedPlayers || queuedPlayers.length === 0) {
        logger.warn(
          `⚠️ No available queued players found for platform: ${platform}`
        );
        return thread.send("❌ No replacement players found.");
      }

      // ✅ Update match with new players
      playerIds.push(...queuedPlayers);
      logger.info(
        `Updating match with new players: ${queuedPlayers.join(", ")}`
      );

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
          [playerIds.join(","), thread.id],
          (err) => {
            if (err) {
              logger.error(
                `❌ SQL Error updating match players: ${err.message}`
              );
              return reject(err);
            }
            resolve();
          }
        );
      });

      // ✅ Add players to the thread and set permissions safely
      for (const playerId of queuedPlayers) {
        try {
          // ✅ Add the player to the private thread
          await thread.members.add(playerId);
          logger.info(
            `✅ Successfully added ${playerId} to thread ${thread.id}`
          );

          // ✅ Check if player can see the thread before modifying permissions
          const member = await thread.guild.members.fetch(playerId);
          if (thread.members.cache.has(playerId)) {
            logger.info(
              `✅ ${playerId} can already see the thread. Skipping permission update.`
            );
          } else {
            const threadChannel = thread.guild.channels.cache.get(thread.id);
            if (threadChannel && threadChannel.permissionOverwrites) {
              await threadChannel.permissionOverwrites.edit(playerId, {
                ViewChannel: true,
                SendMessages: true,
              });
              logger.info(
                `✅ Successfully updated thread permissions for ${playerId}`
              );
            } else {
              logger.warn(
                `⚠️ thread.permissionOverwrites is undefined for thread ${thread.id}. Skipping permission update.`
              );
            }
          }
        } catch (error) {
          logger.error(
            `❌ Error adding ${playerId} to thread: ${error.message}`
          );
        }
      }

      // ✅ Add Players to Voice Channel (if exists)
      if (match.voiceChannelId) {
        const voiceChannel = message.guild.channels.cache.get(
          match.voiceChannelId
        );
        if (voiceChannel) {
          for (const playerId of queuedPlayers) {
            try {
              await voiceChannel.permissionOverwrites.edit(playerId, {
                ViewChannel: true,
                Connect: true,
                Speak: true,
              });
              logger.info(
                `✅ Updated voice channel permissions for ${playerId}`
              );
            } catch (error) {
              logger.error(
                `❌ Error updating voice channel permissions for ${playerId}: ${error.message}`
              );
            }
          }
        } else {
          logger.warn(`⚠️ Voice channel ${match.voiceChannelId} not found.`);
        }
      }

      // ✅ Mention the added players
      const playerMentions = queuedPlayers.map((id) => `<@${id}>`).join(", ");
      return thread.send(
        `✅ Successfully added ${playerMentions} to the match.`
      );
    } catch (error) {
      logger.error(
        `❌ Unexpected error in !search command: ${error.message}`,
        error.stack
      );
      return message.channel?.send(
        "❌ An error occurred while searching for players."
      );
    }
  },

  // kick command to kick inactive or unruly player
  "!kick": async (message, args) => {
    try {
      if (!message.channel.isThread()) {
        return message.reply(
          "You can only use `!kick` inside an active match thread."
        );
      }

      const thread = message.channel;
      const memberMention = message.mentions.members.first();

      if (!memberMention) {
        return message.reply("Usage: `!kick @player` to initiate a kick vote.");
      }

      const playerId = memberMention.id;

      // ✅ Fetch match data
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => {
            if (err) {
              logger.error("Error fetching match data:", err.message);
              return reject(err);
            }
            resolve(row);
          }
        );
      });

      if (!match) {
        return message.reply("This match no longer exists.");
      }

      let playerIds = match.playerIds.split(",").filter(Boolean);

      if (!playerIds.includes(playerId)) {
        return message.reply("That player is not part of this match.");
      }

      if (playerIds.length <= 2) {
        return message.reply("You cannot kick the last remaining player.");
      }

      // ✅ Start a vote for the kick
      const collectedVotes = new Set();
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_kick_${playerId}`)
          .setLabel(`Kick ${memberMention.user.username}`)
          .setStyle(ButtonStyle.Danger)
      );

      const voteMessage = await thread.send({
        content: `A vote to kick <@${playerId}> has started. 2/3 players must vote to remove them.`,
        components: [actionRow],
      });

      // ✅ Create a button interaction collector
      const collector = voteMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000, // 60 seconds
      });

      collector.on("collect", async (interaction) => {
        if (
          !playerIds.includes(interaction.user.id) ||
          interaction.user.id === playerId
        ) {
          return interaction
            .reply({
              content:
                "You are not part of this match or cannot vote to kick yourself.",
              flags: 64,
            })
            .catch(() => {});
        }

        collectedVotes.add(interaction.user.id);

        if (collectedVotes.size >= 2) {
          collector.stop();
          await message.channel.send(
            `✅ <@${playerId}> has been kicked from the match.`
          );

          // ✅ Remove the player from the match (Update `channels` table)
          playerIds = playerIds.filter((id) => id !== playerId);
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
              [playerIds.join(","), thread.id],
              (err) => {
                if (err) {
                  logger.error("Error updating match players:", err.message);
                  return reject(err);
                }
                resolve();
              }
            );
          });

          // ✅ Remove Player from Database if They Are Not in a Queue
          await new Promise((resolve, reject) => {
            db.run(
              `DELETE FROM players WHERE id = ? AND status != 'queued'`,
              [playerId],
              (err) => {
                if (err) {
                  logger.error(
                    "Error deleting player after removal:",
                    err.message
                  );
                  return reject(err);
                }
                resolve();
              }
            );
          });

          // ✅ Remove player from thread (Handle errors gracefully)
          try {
            await thread.members.remove(playerId);
          } catch (err) {
            logger.warn(
              `⚠️ Could not remove player ${playerId} from thread: ${err.message}`
            );
          }

          // ✅ Remove thread view permissions if applicable
          if (thread?.permissionOverwrites) {
            try {
              await thread.permissionOverwrites.edit(playerId, {
                ViewChannel: false,
              });
            } catch (err) {
              logger.warn(
                `⚠️ Could not update thread permissions for ${playerId}: ${err.message}`
              );
            }
          }

          // ✅ Remove Player from Voice Channel (if exists)
          if (match.voiceChannelId) {
            const voiceChannel = message.guild.channels.cache.get(
              match.voiceChannelId
            );
            if (voiceChannel) {
              try {
                await voiceChannel.permissionOverwrites.edit(playerId, {
                  ViewChannel: false,
                  Connect: false,
                });
              } catch (err) {
                logger.warn(
                  `⚠️ Could not update voice channel permissions for ${playerId}: ${err.message}`
                );
              }
            }
          }

          // ✅ Automatically start a search for a replacement
          await message.channel.send(
            "🔍 Starting search for a replacement player..."
          );
          await message.channel.send(`!search 1`);
        } else {
          return interaction
            .reply({
              content: `Waiting for another player to confirm. (${collectedVotes.size}/2 confirmations received)`,
              flags: 64,
            })
            .catch(() => {});
        }
      });

      collector.on("end", (collected) => {
        if (collected.size < 2) {
          thread.send(
            "Vote to kick the player expired with insufficient confirmations."
          );
        }
      });
    } catch (error) {
      logger.error("Error handling !kick command:", error.message);
      return message.reply("An error occurred while handling the kick vote.");
    }
  },

  //reports the player status, in queue, in match, blacklisted etc.
  "!status": async (message, args) => {
    try {
      // ✅ Argument Validation
      if (args.length < 2) {
        return message.reply(
          "Usage: `!status @User` (e.g., `!status @Player`)."
        );
      }

      const memberMention = message.mentions.members.first();
      if (!memberMention) {
        return message.reply(
          "Please mention a valid user to check their status."
        );
      }

      const playerId = memberMention.id;
      let statusMessage = `**Status for <@${playerId}>:**\n\n`;

      // ✅ Check if the user is in the queue
      const queueData = await new Promise((resolve, reject) => {
        db.get(
          `SELECT platform, status, duoPartner FROM players WHERE id = ?`,
          [playerId],
          (err, row) => {
            if (err) {
              logger.error("Error checking queue status:", err.message);
              return reject(err);
            }
            resolve(row);
          }
        );
      });

      let queueType = "Solo";

      if (queueData) {
        if (queueData.duoPartner) {
          // ✅ Check if the duo partner is still in the queue
          const partnerStillQueued = await new Promise((resolve, reject) => {
            db.get(
              `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
              [queueData.duoPartner],
              (err, row) => {
                if (err) {
                  logger.error(
                    "Error checking duo partner status:",
                    err.message
                  );
                  return reject(err);
                }
                resolve(row ? true : false);
              }
            );
          });
          // ✅ If the duo partner left, remove the duo link and mark the player as solo
          if (!partnerStillQueued) {
            await new Promise((resolve, reject) => {
              db.run(
                `UPDATE players SET duoPartner = NULL WHERE id = ? AND duoPartner IS NOT NULL`,
                [playerId], // Use `playerId` in `!status`, and `user.id` in `check_queue_status`
                (err) => {
                  if (err) {
                    logger.error(
                      "Error clearing orphaned duo partner:",
                      err.message
                    );
                    return reject(err);
                  }
                  resolve();
                }
              );
            });

            logger.info(
              `Duo partner removed for ${playerId} since their partner left the queue.`
            );
          } else {
            queueType = `Duo (with <@${player.duoPartner}>)`;
          }
        }

        statusMessage += `🔹 **Queue Status:** ${queueData.status.toUpperCase()}\n`;
        statusMessage += `🔹 **Platform:** ${queueData.platform.toUpperCase()}\n`;
        statusMessage += `🔹 **Queue Type:** ${queueType}\n\n`;
      } else {
        statusMessage += "🔹 **Queue Status:** Not in queue.\n\n";
      }

      // ✅ Check if the user is in an active match
      const matchData = await new Promise((resolve, reject) => {
        db.get(
          `SELECT threadId, playerIds, voiceChannelId FROM channels WHERE playerIds LIKE ?`,
          [`%${playerId}%`],
          (err, row) => {
            if (err) {
              logger.error("Error checking active match status:", err.message);
              return reject(err);
            }
            resolve(row);
          }
        );
      });

      if (
        matchData &&
        queueData?.status !== "inactive" &&
        matchData.playerIds.includes(playerId)
      ) {
        const teammates =
          matchData.playerIds
            .split(",")
            .filter((id) => id !== playerId)
            .map((id) => `<@${id}>`)
            .join(", ") || "No teammates";

        statusMessage += `🔹 **Active Match:** Yes\n`;
        statusMessage += `🔹 **Match Thread:** <#${matchData.threadId}>\n`;
        statusMessage += `🔹 **Teammates:** ${teammates}\n`;
        statusMessage += `🔹 **Voice Channel:** ${
          matchData.voiceChannelId ? `<#${matchData.voiceChannelId}>` : "None"
        }\n\n`;
      } else {
        statusMessage += "🔹 **Active Match:** Not in a match.\n\n";
      }

      // ✅ Check if the user is blacklisted
      const isBlacklisted = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM blacklist WHERE id = ?`,
          [playerId],
          (err, row) => {
            if (err) {
              logger.error("Error checking blacklist status:", err.message);
              return reject(err);
            }
            resolve(row ? true : false);
          }
        );
      });

      if (isBlacklisted) {
        statusMessage += "🚫 **This user is blacklisted from matchmaking.**\n";
      }

      return message.reply(statusMessage);
    } catch (error) {
      logger.error("Error handling !status command:", error.message);
      return message.reply(
        "An error occurred while retrieving the user's status."
      );
    }
  },

  //command to queue a player as a solo on a specific platform
  "!queue": async (message, args) => {
    try {
      // ✅ If no arguments are provided, display usage instructions
      if (args.length < 2) {
        return message.reply(
          "**Queue Commands:**\n" +
            "`!queue @User <platform>` - Add a user to the queue (e.g., `!queue @User pc`).\n" +
            "`!queue list` - Lists all users currently in the queue.\n" +
            "`!queue number` - Shows the number of queued users by platform.\n" +
            "`!queue lock` - **(Admin Only)** Disable queue entry.\n" +
            "`!queue unlock` - **(Admin Only)** Enable queue entry.\n" +
            "`!queue clear` - **(Admin Only)** Wipes all players from the queue."
        );
      }

      // ✅ Handle Queue Lock/Unlock Commands
      if (["lock", "unlock"].includes(args[1].toLowerCase())) {
        if (
          !message.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
          return message.reply(
            "🚫 **You do not have permission to use this command.**"
          );
        }

        const queueLocked = args[1].toLowerCase() === "lock" ? 1 : 0;

        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO settings (key, value) VALUES ('queue_locked', ?) 
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [queueLocked],
            (err) => {
              if (err) {
                logger.error("Error updating queue lock status:", err.message);
                return reject(err);
              }
              resolve();
            }
          );
        });

        return message.reply(
          queueLocked
            ? "🚫 **Queue entry is now disabled.** Players cannot enter the queue until re-enabled."
            : "✅ **Queue entry is now enabled.** Players can enter the queue again."
        );
      }

      // ✅ Check if Queue is Locked
      const queueLocked = await new Promise((resolve, reject) => {
        db.get(
          `SELECT value FROM settings WHERE key = 'queue_locked'`,
          [],
          (err, row) => {
            if (err) {
              logger.error("Error checking queue lock status:", err.message);
              return reject(err);
            }
            resolve(row ? parseInt(row.value) : 0);
          }
        );
      });

      if (queueLocked) {
        return message.reply(
          "🚫 **Queue entry is currently disabled.** Please wait until it is re-enabled."
        );
      }

      // ✅ Handle "!queue list"
      if (args[1].toLowerCase() === "list") {
        const queuedUsers = await new Promise((resolve, reject) => {
          db.all(
            `SELECT id, platform FROM players WHERE status = 'queued'`,
            [],
            (err, rows) => {
              if (err) {
                logger.error("Error retrieving queued users:", err.message);
                return reject(err);
              }
              resolve(rows);
            }
          );
        });

        if (queuedUsers.length === 0) {
          return message.reply("There are currently no players in the queue.");
        }

        let queueList = "**Queued Players:**\n";
        queuedUsers.forEach((player, index) => {
          queueList += `${index + 1}. <@${
            player.id
          }> - **${player.platform.toUpperCase()}**\n`;
        });

        return message.reply(queueList);
      }

      // ✅ Handle "!queue number"
      if (args[1].toLowerCase() === "number") {
        const queueStats = await new Promise((resolve, reject) => {
          db.all(
            `SELECT platform, COUNT(*) AS count FROM players WHERE status = 'queued' GROUP BY platform`,
            [],
            (err, rows) => {
              if (err) {
                logger.error("Error retrieving queue statistics:", err.message);
                return reject(err);
              }
              resolve(rows);
            }
          );
        });

        let totalQueue = 0;
        let queueStatsMessage = "**Queue Stats:**\n";
        queueStats.forEach((row) => {
          totalQueue += row.count;
          queueStatsMessage += `🔹 **${row.platform.toUpperCase()}**: ${
            row.count
          } players\n`;
        });

        queueStatsMessage += `\n**Total Players in Queue:** ${totalQueue}`;

        return message.reply(queueStatsMessage);
      }
      // ✅ Handle "!queue clear"
      if (args[1].toLowerCase() === "clear") {
        if (
          !message.member.permissions.has(PermissionFlagsBits.Administrator)
        ) {
          return message.reply(
            "🚫 **You do not have permission to use this command.**"
          );
        }

        // ✅ Ask for confirmation via text
        const confirmMessage = await message.reply(
          "⚠️ **Are you sure you want to clear the queue?** Type `yes` to confirm or `no` to cancel."
        );

        try {
          // ✅ Wait for the admin's response
          const filter = (msg) =>
            msg.author.id === message.author.id &&
            ["yes", "no"].includes(msg.content.toLowerCase());
          const collected = await message.channel.awaitMessages({
            filter,
            max: 1,
            time: 10000,
            errors: ["time"],
          });

          const response = collected.first().content.toLowerCase();

          if (response === "yes") {
            // ✅ Clear all queued players
            await new Promise((resolve, reject) => {
              db.run(`DELETE FROM players WHERE status = 'queued'`, (err) => {
                if (err) {
                  logger.error("❌ Error clearing queue:", err.message);
                  return reject(err);
                }
                resolve();
              });
            });

            logger.info("✅ Queue successfully cleared by an admin.");
            return message.channel.send(
              "✅ **Queue has been cleared.** All players have been removed."
            );
          } else {
            return message.channel.send(
              "❌ **Queue clearing canceled.** No players were removed."
            );
          }
        } catch (error) {
          return message.channel.send(
            "⏳ **Queue clear request timed out.** No players were removed."
          );
        }
      }

      // ✅ Standard Queue Entry
      const memberMention = message.mentions.members.first();
      if (!memberMention) {
        return message.reply("🚫 Please mention a valid user to queue.");
      }

      // ✅ Normalize platform input
      const platformInput = args[2]?.toLowerCase();
      const platformAliases = {
        ps: "playstation",
        ps5: "playstation",
        ps4: "playstation",
        xbox: "xbox",
        x: "xbox",
        pc: "pc",
        steam: "pc",
      };
      const platform = platformAliases[platformInput] || platformInput;

      if (!platform || !["pc", "xbox", "playstation"].includes(platform)) {
        return message.reply(
          "🚫 Invalid platform. Use `pc`, `xbox`, or `playstation`."
        );
      }

      const playerId = memberMention.id;

      // ✅ Check if the player is already queued
      const existingQueueStatus = await new Promise((resolve, reject) => {
        db.get(
          `SELECT status, duoPartner FROM players WHERE id = ?`,
          [playerId],
          (err, row) => {
            if (err) {
              logger.error("Error checking queue status:", err.message);
              return reject(err);
            }
            resolve(row);
          }
        );
      });

      if (existingQueueStatus && existingQueueStatus.status === "queued") {
        return message.reply(
          `🚫 ${memberMention.user.username} is already in the queue.`
        );
      }

      // ✅ Check if the player's duo partner is already queued
      if (existingQueueStatus && existingQueueStatus.duoPartner) {
        const duoPartnerStatus = await new Promise((resolve, reject) => {
          db.get(
            `SELECT status FROM players WHERE id = ?`,
            [existingQueueStatus.duoPartner],
            (err, row) => {
              if (err) {
                logger.error(
                  "Error checking duo partner queue status:",
                  err.message
                );
                return reject(err);
              }
              resolve(row ? row.status : null);
            }
          );
        });

        if (duoPartnerStatus === "queued") {
          return message.reply(
            `🚫 ${memberMention.user.username} cannot queue because their duo partner <@${existingQueueStatus.duoPartner}> is already in the queue.`
          );
        }
      }

      // ✅ Check if the user is blacklisted
      const isBlacklisted = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM blacklist WHERE id = ?`,
          [playerId],
          (err, row) => {
            if (err) {
              logger.error("Error checking blacklist:", err.message);
              return reject(err);
            }
            resolve(row ? true : false);
          }
        );
      });

      if (isBlacklisted) {
        return message.reply(
          `🚫 ${memberMention.user.username} is blacklisted and cannot enter the queue.`
        );
      }

      // ✅ Fetch platform from DB if missing
      if (!platform) {
        platform = await new Promise((resolve, reject) => {
          db.get(
            `SELECT platform FROM players WHERE id = ?`,
            [playerId],
            (err, row) => {
              if (err) {
                logger.error(
                  "Error fetching platform in !status:",
                  err.message
                );
                return reject(err);
              }
              resolve(row ? row.platform : null);
            }
          );
        });

        if (!platform) {
          logger.warn(
            `⚠️ Platform is still undefined for player ${playerId}. Defaulting to 'pc'.`
          );
          platform = "pc";
        }
      }

      // ✅ Add the player to the queue
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO players (id, platform, status, queue_entered_at) 
         VALUES (?, ?, ?, ?) 
         ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, status = excluded.status, queue_entered_at = excluded.queue_entered_at`,
          [playerId, platform, "queued", Date.now()],
          (err) => {
            if (err) {
              logger.error("Error adding player to the queue:", err.message);
              return reject(err);
            }
            resolve();
          }
        );
      });

      // ✅ Get queue position AFTER the player has been added
      const queuePosition = await getQueuePosition(playerId, platform);
      const avgWaitTime = await calculateAverageQueueTime(platform, "solo");

      message.reply(
        `<@${playerId}> has been added to the **${platform.toUpperCase()}** queue.\n` +
          `**Queue Position:** ${queuePosition}\n` +
          `**Estimated Wait Time: 🕒** ${Math.round(
            (avgWaitTime * queuePosition) / 60
          )} minutes.`
      );

      // ✅ Optionally trigger matchmaking after adding the player DEPRECATED FOR NOW TO PREVENT DUPLICATE THREADS
      // await runMatchmaking();
    } catch (error) {
      logger.error(`Error handling !queue command: ${error.message}`, error);
      message.reply(
        "❌ An error occurred while processing the queue command. Please try again."
      );
    }
  },

  //command to end the match and delete thread/vc and remove match/players from database so they can re-enter queue
  "!end": async (message) => {
    try {
      let thread = message.channel;

      // ✅ Fetch the thread if it's not cached
      if (!thread || !thread.isThread()) {
        try {
          thread = await message.client.channels.fetch(message.channelId);
        } catch (err) {
          logger.error("Error fetching thread:", err.message);
          return message.reply(
            "Error: Unable to fetch the thread. It may have been deleted or is no longer accessible."
          );
        }
      }

      if (!thread || !thread.isThread()) {
        return message.reply(
          "Error: This thread is not accessible or has already been deleted."
        );
      }

      // ✅ Check if the user has ManageChannels permission
      const isAdmin = message.member.permissions.has(
        PermissionFlagsBits.ManageChannels
      );

      // ✅ Fetch match information (INCLUDING voiceChannelId)
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => {
            if (err) {
              logger.error("Error fetching match information:", err.message);
              return reject(err);
            }
            resolve(row);
          }
        );
      });

      if (!match) {
        return message.reply(
          "This thread is not part of an active match or no match found."
        );
      }

      const { playerIds, voiceChannelId } = match;
      const players = playerIds.split(",");

      // ✅ Admin Mode: Immediately end the match
      if (isAdmin) {
        await thread
          .send("Match deletion will commence in **10 seconds**...")
          .catch(() => {});

        for (let i = 10; i > 0; i--) {
          await thread.send(`**${i}...**`).catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
        }

        await cleanupMatch({ thread, voiceChannelId });
        return;
      }

      // ✅ Player Vote Mode: Require a confirmation button
      const button = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_match_end")
          .setLabel("Confirm Match End")
          .setStyle(ButtonStyle.Danger)
      );

      const replyMessage = await message.reply({
        content: `A vote to end the match has been initiated by <@${message.author.id}>.\nA second player with access to this thread must confirm to end the match.`,
        components: [button],
      });

      // ✅ Create a button interaction collector for voting
      const collector = replyMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000, // 60 seconds
      });

      const collectedUsers = new Set();

      collector.on("collect", async (interaction) => {
        if (!players.includes(interaction.user.id)) {
          return interaction
            .reply({
              content:
                "You are not part of this match and cannot confirm ending it.",
              flags: 64,
            })
            .catch(() => {});
        }

        collectedUsers.add(interaction.user.id);

        if (collectedUsers.size >= 2) {
          collector.stop();
          logger.info(`Match ${thread.name} ending via 2/3 player vote.`);

          await thread
            .send(
              "The vote has passed to end the match. Match deletion will commence in **10 seconds**..."
            )
            .catch(() => {});

          for (let i = 10; i > 0; i--) {
            await thread.send(`**${i}...**`).catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
          }

          await cleanupMatch({ thread, voiceChannelId });
          return;
        } else {
          return interaction
            .reply({
              content: `Waiting for another player to confirm. (${collectedUsers.size}/2 confirmations received)`,
              flags: 64,
            })
            .catch(() => {});
        }
      });

      collector.on("end", async (collected) => {
        if (collected.size < 2) {
          const updatedThread = await message.guild.channels
            .fetch(thread.id)
            .catch(() => null);
          if (updatedThread) {
            updatedThread
              .send(
                "Vote to end the match expired with insufficient confirmations."
              )
              .catch(() => {});
          }
        }
      });
    } catch (error) {
      logger.error("Unexpected error in !end command:", error.message);
      return message.reply(
        "An unexpected error occurred while ending the match. Please try again or contact an administrator."
      );
    }
  },
  // command for a player to leave a match if they are in an active match
  "!leave": async (message) => {
    try {
      const playerId = message.author.id;
      const thread = message.channel;

      // ✅ Fetch match data
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => {
            if (err) {
              logger.error("Error fetching match data:", err.message);
              return reject(err);
            }
            resolve(row);
          }
        );
      });

      if (!match) {
        return message.reply("This match no longer exists.");
      }

      let playerIds = match.playerIds.split(",").filter(Boolean);
      if (!playerIds.includes(playerId)) {
        return message.reply("You are not part of this match.");
      }

      // ✅ Remove Player from Match
      playerIds = playerIds.filter((id) => id !== playerId);
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
          [playerIds.join(","), thread.id],
          (err) => {
            if (err) {
              logger.error("Error updating match players:", err.message);
              return reject(err);
            }
            resolve();
          }
        );
      });

      // ✅ Remove Player from Thread & Permissions
      await thread.members.remove(playerId);
      await thread.permissionOverwrites.edit(playerId, { ViewChannel: false });

      // ✅ Remove Player from Voice Channel (if exists)
      if (match.voiceChannelId) {
        const voiceChannel = message.guild.channels.cache.get(
          match.voiceChannelId
        );
        if (voiceChannel) {
          await voiceChannel.permissionOverwrites
            .edit(playerId, {
              ViewChannel: false,
              Connect: false,
            })
            .catch(() => {});
        }
      }

      // ✅ Handle Remaining Players
      if (playerIds.length === 0) {
        // If all players leave, delete match
        await cleanupMatch({ thread, voiceChannelId: match.voiceChannelId });
        return;
      } else {
        // Show options to remaining players
        const actionRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("end_match_now")
            .setLabel("End Match Immediately")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("find_replacement")
            .setLabel("Find Replacement from Queue")
            .setStyle(ButtonStyle.Primary)
        );

        await thread.send({
          content: `<@${playerIds.join(
            ">, <@"
          )}>: A player has left. Would you like to end the match or search for a replacement?`,
          components: [actionRow],
        });
      }

      return;
    } catch (error) {
      logger.error("Error handling !leave command:", error.message);
      return message.reply("An error occurred while leaving the match.");
    }
  },

  "!warn_vc": async (message, args) => {
    const voiceChannel = message.member.voice.channel;

    if (!voiceChannel) {
      return message.reply(
        "❌ You must be in a voice channel to use this command!"
      );
    }

    // Join all arguments as a custom TTS message, or use fallback
    const customMessage = args.slice(1).join(" ");
    const ttsMessage =
      customMessage || "This voice channel will be deleted in 10 seconds.";

    await announceVCWarning(voiceChannel, ttsMessage);
  },

  "!setmatchmakinginterval": async (message, args) => {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply(
        "🚫 **You do not have permission to use this command.**"
      );
    }

    const newInterval = parseInt(args[1]);
    if (isNaN(newInterval) || newInterval < 5000 || newInterval > 600000) {
      return message.reply(
        "🚫 **Invalid interval. Please specify a time between 5000 (5s) and 600000 (10 min) milliseconds.**"
      );
    }

    try {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE settings SET value = ? WHERE key = 'matchmaking_interval'`,
          [newInterval],
          (err) => {
            if (err) {
              logger.error(
                "❌ Error updating matchmaking interval:",
                err.message
              );
              return reject(err);
            }
            resolve();
          }
        );
      });

      // ✅ Clear the previous interval and restart matchmaking in real time
      clearInterval(matchmakingLoop);
      matchmakingInterval = newInterval;
      startMatchmakingLoop(); // ✅ Restart loop immediately

      message.reply(
        `⏳ **Matchmaking interval updated to ${newInterval / 1000} seconds.**`
      );
      logger.info(
        `✅ Matchmaking interval updated in real-time to ${newInterval}ms`
      );
    } catch (error) {
      logger.error("❌ Error setting matchmaking interval:", error.message);
      message.reply(
        "❌ An error occurred while updating the matchmaking interval."
      );
    }
  },

  "!pausematchmaking": async (message) => {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply(
        "🚫 **You do not have permission to use this command.**"
      );
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE settings SET value = '1' WHERE key = 'matchmaking_paused'`,
        [],
        (err) => {
          if (err) {
            logger.error("Error pausing matchmaking:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });

    message.reply(
      "⏸️ **Matchmaking has been paused.** Players can still queue, but no matches will be created."
    );
  },

  "!resumematchmaking": async (message) => {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply(
        "🚫 **You do not have permission to use this command.**"
      );
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE settings SET value = '0' WHERE key = 'matchmaking_paused'`,
        [],
        (err) => {
          if (err) {
            logger.error("Error resuming matchmaking:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });

    message.reply(
      "▶️ **Matchmaking has resumed.** Matches will be created again based on the queue."
    );
  },

  // command to add a player to an existing match/thread/vc
  "!add": async (message) => {
    try {
      logger.info(
        `!add command initiated by ${message.author.tag} in thread ${message.channel.id}`
      );

      // ✅ Permission Check
      if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        logger.warn(
          `⚠️ User ${message.author.tag} attempted !add without permission.`
        );
        return message.reply("You do not have permission to use this command.");
      }

      // ✅ Argument Validation
      const args = message.content.split(" ");
      if (args.length < 2) {
        logger.warn(`⚠️ !add command was used without mentioning a user.`);
        return message.reply(
          "Please mention the user you want to add (e.g., `!add @User`)."
        );
      }

      const memberMention = message.mentions.members.first();
      if (!memberMention) {
        logger.warn(`⚠️ !add command failed - No valid user mentioned.`);
        return message.reply("User not found. Please mention a valid user.");
      }

      const playerId = memberMention.id;
      const thread = message.channel;

      // ✅ Ensure `thread` exists and is fetched correctly
      if (!thread || !thread.isThread()) {
        try {
          thread = await message.client.channels.fetch(message.channelId);
        } catch (fetchError) {
          logger.error(`❌ Failed to fetch thread: ${fetchError.message}`);
          return message.reply(
            "Error: Unable to fetch the thread. It may have been deleted or is no longer accessible."
          );
        }
      }

      if (!thread || !thread.isThread()) {
        return message.reply(
          "Error: This thread is not accessible or has already been deleted."
        );
      }

      // ✅ Check if the user is blacklisted
      logger.info(`Checking blacklist status for ${playerId}`);
      const isBlacklisted = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM blacklist WHERE id = ?`,
          [playerId],
          (err, row) => {
            if (err) {
              logger.error(
                `❌ SQL Error in !add (Checking blacklist): ${err.message}`
              );
              return reject(err);
            }
            resolve(row ? true : false);
          }
        );
      });

      if (isBlacklisted) {
        logger.warn(`🚫 User ${playerId} is blacklisted and cannot be added.`);
        return message.reply(
          `🚫 ${memberMention.user.username} is blacklisted and cannot be added to a match.`
        );
      }

      // ✅ Fetch match data
      logger.info(`Fetching match data for thread ${thread.id}`);
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => {
            if (err) {
              logger.error(
                `❌ SQL Error in !add (Fetching match data): ${err.message}`
              );
              return reject(err);
            }
            resolve(row);
          }
        );
      });

      if (!match) {
        logger.warn(`⚠️ No active match found for thread ${thread.id}`);
        return message.reply(
          "This thread is not part of an active match or no match found."
        );
      }

      // ✅ Add User to the Match
      const playerIds = match.playerIds.split(",").filter(Boolean);
      if (playerIds.includes(playerId)) {
        logger.warn(
          `⚠️ Attempted to add player ${playerId} who is already in the match.`
        );
        return message.reply(
          `${memberMention.user.username} is already part of this match.`
        );
      }

      playerIds.push(playerId);

      logger.info(`Updating match with new player: ${playerId}`);
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
          [playerIds.join(","), thread.id],
          (err) => {
            if (err) {
              logger.error(
                `❌ SQL Error in !add (Updating match players): ${err.message}`
              );
              return reject(err);
            }
            resolve();
          }
        );
      });

      // ✅ Add Player to Thread & Set Correct Permissions
      try {
        await thread.members.add(playerId);
        logger.info(`✅ Successfully added ${playerId} to thread ${thread.id}`);

        // ✅ Ensure `thread.permissionOverwrites` exists before using `.edit()`
        if (thread?.permissionOverwrites) {
          await thread.permissionOverwrites.edit(playerId, {
            ViewChannel: true,
            SendMessages: true,
          });
          logger.info(
            `✅ Successfully updated thread permissions for ${playerId}`
          );
        } else {
          logger.warn(
            `⚠️ thread.permissionOverwrites is undefined for thread ${thread.id}`
          );
        }
      } catch (error) {
        logger.error(`❌ Error adding ${playerId} to thread: ${error.message}`);
      }

      // ✅ Add Player to Voice Channel (if exists)
      if (match.voiceChannelId) {
        const voiceChannel = message.guild.channels.cache.get(
          match.voiceChannelId
        );
        if (voiceChannel) {
          try {
            await voiceChannel.permissionOverwrites.edit(playerId, {
              ViewChannel: true,
              Connect: true,
              Speak: true,
            });
            logger.info(`✅ Updated voice channel permissions for ${playerId}`);
          } catch (error) {
            logger.error(
              `❌ Error updating voice channel permissions for ${playerId}: ${error.message}`
            );
          }
        } else {
          logger.warn(`⚠️ Voice channel ${match.voiceChannelId} not found.`);
        }
      }

      return message.reply(
        `✅ ${memberMention.user.username} has been successfully added to the match and granted appropriate permissions.`
      );
    } catch (error) {
      logger.error(
        `❌ Unexpected error in !add command: ${error.message}`,
        error.stack
      );
      return message.reply(
        "An unexpected error occurred while adding the user. Please try again or contact an administrator."
      );
    }
  },

  //command to remove a player from a thread/vc/active match and database
  "!remove": async (message) => {
    try {
      // ✅ Permission Check
      if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return message.reply("You do not have permission to use this command.");
      }

      // ✅ Argument Validation
      const args = message.content.split(" ");
      if (args.length < 2) {
        return message.reply(
          "Please mention the user you want to remove (e.g., `!remove @User`)."
        );
      }

      const memberMention = message.mentions.members.first();
      if (!memberMention) {
        return message.reply("User not found. Please mention a valid user.");
      }

      const playerId = memberMention.id;
      const thread = message.channel;

      // ✅ Fetch match data
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => {
            if (err) {
              logger.error("Error fetching match data:", err.message);
              return reject(err);
            }
            resolve(row);
          }
        );
      });

      if (!match) {
        return message.reply(
          "This thread is not part of an active match or no match found."
        );
      }

      // ✅ Remove User from Match (`channels` table)
      let playerIds = match.playerIds.split(",").filter(Boolean);
      if (!playerIds.includes(playerId)) {
        return message.reply(
          `${memberMention.user.username} is not part of this match.`
        );
      }

      const updatedPlayerIds = playerIds.filter((id) => id !== playerId);

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
          [updatedPlayerIds.join(","), thread.id],
          (err) => {
            if (err) {
              logger.error("Error updating match players:", err.message);
              return reject(err);
            }
            resolve();
          }
        );
      });

      // ✅ Remove Player from Database (`players` table)
      await new Promise((resolve, reject) => {
        db.run(`DELETE FROM players WHERE id = ?`, [playerId], (err) => {
          if (err) {
            logger.error("Error deleting player after removal:", err.message);
            return reject(err);
          }
          resolve();
        });
      });

      // ✅ Remove Player from Thread
      try {
        await thread.members.remove(playerId);
      } catch (err) {
        logger.warn(
          `⚠️ Could not remove player ${playerId} from thread: ${err.message}`
        );
      }

      // ✅ Remove View Permissions for Thread
      if (thread?.permissionOverwrites) {
        try {
          await thread.permissionOverwrites.edit(playerId, {
            ViewChannel: false,
            SendMessages: false,
          });
        } catch (err) {
          logger.warn(
            `⚠️ Could not update thread permissions for ${playerId}: ${err.message}`
          );
        }
      }

      // ✅ Remove Player from Voice Channel (if exists)
      if (match.voiceChannelId) {
        const voiceChannel = message.guild.channels.cache.get(
          match.voiceChannelId
        );
        if (voiceChannel) {
          try {
            await voiceChannel.permissionOverwrites.edit(playerId, {
              ViewChannel: false,
              Connect: false,
            });
          } catch (err) {
            logger.warn(
              `⚠️ Could not update voice channel permissions for ${playerId}: ${err.message}`
            );
          }
        }
      }

      return message.reply(
        `✅ ${memberMention.user.username} has been successfully removed from the match and cannot view the thread or join the voice channel.`
      );
    } catch (error) {
      logger.error("Unexpected error in !remove command:", error.message);
      return message.reply(
        "An unexpected error occurred while removing the user. Please try again or contact an administrator."
      );
    }
  },

  // blacklist and unblacklist command
  "!blacklist": async (message, args) => {
    try {
      // **Ensure the user has admin permissions**
      if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return message.reply("You do not have permission to use this command.");
      }

      // **List the blacklist if no user is mentioned**
      if (args.length < 2) {
        const blacklistedPlayers = await new Promise((resolve, reject) => {
          db.all(
            `SELECT id, username, added_at FROM blacklist`,
            [],
            (err, rows) => {
              if (err) {
                logger.error("Error retrieving blacklist:", err.message);
                return reject(err);
              }
              resolve(rows);
            }
          );
        });

        if (blacklistedPlayers.length === 0) {
          return message.reply("No players are currently blacklisted.");
        }

        let response = "**Blacklisted Players:**\n";
        blacklistedPlayers.forEach((player) => {
          response += `🔹 <@${player.id}> (${
            player.username
          }) - Added: <t:${Math.floor(player.added_at / 1000)}:R>\n`;
        });

        return message.reply(response);
      }

      // **Blacklist or Unblacklist a Player**
      const memberMention = message.mentions.members.first();
      if (!memberMention) {
        return message.reply(
          "Please mention a valid user to blacklist/unblacklist."
        );
      }

      const playerId = memberMention.id;
      const username = memberMention.user.username;

      // Check if the player is already blacklisted
      const isBlacklisted = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM blacklist WHERE id = ?`,
          [playerId],
          (err, row) => {
            if (err) {
              logger.error("Error checking blacklist:", err.message);
              return reject(err);
            }
            resolve(row ? true : false);
          }
        );
      });

      if (isBlacklisted) {
        // **Unblacklist the player**
        await new Promise((resolve, reject) => {
          db.run(`DELETE FROM blacklist WHERE id = ?`, [playerId], (err) => {
            if (err) {
              logger.error("Error removing from blacklist:", err.message);
              return reject(err);
            }
            resolve();
          });
        });

        return message.reply(
          `✅ <@${playerId}> has been removed from the blacklist and can now queue again.`
        );
      } else {
        // **Blacklist the player**
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO blacklist (id, username, added_at) VALUES (?, ?, ?)`,
            [playerId, username, Date.now()],
            (err) => {
              if (err) {
                logger.error("Error adding to blacklist:", err.message);
                return reject(err);
              }
              resolve();
            }
          );
        });

        return message.reply(
          `🚫 <@${playerId}> has been blacklisted from matchmaking.`
        );
      }
    } catch (error) {
      logger.error("Error handling !blacklist command:", error.message);
      message.reply(
        "An error occurred while processing the blacklist command."
      );
    }
  },
  //command to delete all bot created threads, voice channels, and wipe all active match/player id's from database, should leave statistics instact
  "!nuke": async (message) => {
    try {
      // Permission Check
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply("You do not have permission to use this command.");
      }

      // Confirmation Prompt
      await message.reply({
        content:
          "⚠️ **WARNING:** This will clear all queued/active players and delete all bot-created threads and voice channels.\nStatistics data will remain untouched.\nType `!confirmnuke` to proceed.",
        flags: 64,
      });
    } catch (error) {
      logger.error("Error initializing !nuke command:", error.message);
      return message.reply(
        "An error occurred while attempting to start the nuke process. Please try again."
      );
    }
  },
  //command to confirm passing nuke function, can just jump to !confirmnuke if you're sure
  "!confirmnuke": async (message) => {
    try {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply("You do not have permission to use this command.");
      }

      // Fetch the channel dynamically to avoid cache issues
      const channel = await client.channels.fetch(message.channel.id);
      if (!channel) {
        logger.error("Channel not found during !confirmnuke execution.");
        return;
      }

      await channel.send(
        "🧹 **Clearing queued/active players and threads. Please wait...**"
      );

      // Delete All Bot-Created Threads and Voice Channels
      await deleteBotThreadsAndVoiceChannels(message.guild);

      // Clear Queue and Match Data
      await clearDatabaseTables();

      // Success Message
      await channel.send(
        "✅ **Queue and match data cleared successfully. Statistics data remains intact.**"
      );
    } catch (error) {
      logger.error("Error executing !confirmnuke command:", error.message);

      try {
        const channel = await client.channels.fetch(message.channel.id);
        if (channel) {
          await channel.send(
            "❌ An error occurred during the nuke process. Please check the logs for details."
          );
        }
      } catch (nestedError) {
        logger.error("Error sending error message:", nestedError.message);
      }
    }
  },

  //supposed to be used if a player is somehow stuck in an active match or queue and not functioning, should force remove them from the db
  "!clear": async (message) => {
    try {
      // Permission Check
      if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return message.reply("You do not have permission to use this command.");
      }

      // Argument Validation
      const args = message.content.split(" ");
      if (args.length < 2) {
        return message.reply(
          "Please mention the user you want to clear (e.g., `!clear @User`)."
        );
      }

      const memberMention = message.mentions.members.first();
      if (!memberMention) {
        return message.reply("User not found. Please mention a valid user.");
      }

      const playerId = memberMention.id;

      // Check if the Player Exists in the Database
      const player = await getPlayerById(playerId);
      if (!player) {
        return message.reply(
          `${memberMention.user.username} is not currently in the database.`
        );
      }

      // Remove Player from Database
      await deletePlayer(playerId);

      // Success Message
      return message.reply(
        `${memberMention.user.username} has been cleared from the database. They can now re-enter the queue or be added to a match.`
      );
    } catch (error) {
      logger.error("Unexpected error in !clear command:", error.message);
      return message.reply(
        "An unexpected error occurred while clearing the user. Please try again or contact an administrator."
      );
    }
  },

  //reports general statistics collated from all users
  "!botstats": async (message) => {
    try {
      // Fetch statistics and top players
      const stats = await fetchBotStatistics();
      if (!stats.length) return message.reply("No bot statistics available.");

      const topPlayers = await fetchTopPlayers(20);
      const avgQueueTimes = await fetchAverageQueueTimes();

      const platforms = ["pc", "xbox", "playstation"];
      const platformQueueTimes = platforms.reduce((acc, platform) => {
        acc[platform] = {
          solo:
            (avgQueueTimes.find(
              (q) => q.platform === platform && q.queue_type === "solo"
            )?.avg_time || 0) / 1000,
          duo:
            (avgQueueTimes.find(
              (q) => q.platform === platform && q.queue_type === "duo"
            )?.avg_time || 0) / 1000,
        };
        return acc;
      }, {});

      // Format statistics
      const statMap = Object.fromEntries(
        stats.map((row) => [row.stat_key, row.stat_value])
      );
      const avgMatchLength = statMap.total_match_time
        ? (
            statMap.total_match_time /
            statMap.total_matches_created /
            1000
          ).toFixed(2)
        : "N/A";

      // Generate platform and queue time stats
      const platformStats = `
- **Matches Per Platform:**
  - PC: ${statMap.matches_created_pc || 0}
  - Xbox: ${statMap.matches_created_xbox || 0}
  - PlayStation: ${statMap.matches_created_playstation || 0}
- **Average Queue Times by Platform:**
`;

      const queueTimeStats = Object.entries(platformQueueTimes)
        .map(
          ([platform, times]) =>
            `  - **${platform.toUpperCase()}**:
      - Solo: ${times.solo.toFixed(2)} seconds
      - Duo: ${times.duo.toFixed(2)} seconds`
        )
        .join("\n");

      // Generate top player stats
      const topPlayerStats =
        topPlayers.length > 0
          ? topPlayers
              .map(
                (player, index) =>
                  `${index + 1}. <@${player.id}> - ${
                    player.matches_played
                  } matches (Solo: ${player.queue_entries_solo || 0}, Duo: ${
                    player.queue_entries_duo || 0
                  })`
              )
              .join("\n")
          : "No players found.";

      // Build the response
      const response = `
**Bot Statistics:**
- **Unique Users:** ${statMap.unique_users || 0}
- **Total Queue Entries:** ${statMap.total_queue_entries || 0}
  - Solo Queue Entries: ${statMap.queue_entries_solo || 0}
  - Duo Queue Entries: ${statMap.queue_entries_duo || 0}
- **Total Matches Created:** ${statMap.total_matches_created || 0}
- **Average Match Length:** ${avgMatchLength} seconds
- **Longest Match Length:** ${(statMap.longest_match_time / 1000 || 0).toFixed(
        2
      )} seconds
${platformStats}${queueTimeStats}

**Top 20 Players by Matches Played:**
${topPlayerStats}
`;

      message.reply(response);
    } catch (error) {
      logger.error("Error in !botstats command:", error.message);
      message.reply("An error occurred while fetching bot statistics.");
    }
  },

  "!statistics": async (message) => {
    const args = message.content.split(" ");
    const memberMention = message.mentions.members.first();

    if (!memberMention) {
      return message.reply(
        "Please mention a user to view their statistics (e.g., `!statistics @User`)."
      );
    }

    const playerId = memberMention.id;

    try {
      // Fetch player statistics
      const stats = await fetchPlayerStatistics(playerId);
      if (!stats) {
        return message.reply(
          `${memberMention.user.username} has no recorded statistics.`
        );
      }

      // Fetch the player's most common duo partner
      const mostCommonDuoPartner = await fetchMostCommonDuoPartner(playerId);

      const hoursInVC = (stats.vc_time / 3600).toFixed(2); // Convert seconds to hours
      const duoPartnerInfo = mostCommonDuoPartner
        ? `<@${mostCommonDuoPartner.partner_id}> (${mostCommonDuoPartner.count} matches)`
        : "N/A";

      // Build response
      const response = `
**Statistics for ${memberMention.user.username}:**
- **Queue Entries (Total):** ${stats.queue_entries || 0}
  - **Solo Queue Entries:** ${stats.queue_entries_solo || 0}
  - **Duo Queue Entries:** ${stats.queue_entries_duo || 0}
- **Matches Played:** ${stats.matches_played || 0}
- **Top Platform:** ${stats.top_platform || "N/A"}
- **Hours in VC:** ${hoursInVC} hours
- **Messages Sent:** ${stats.messages_sent || 0}
- **Most Common Duo Partner:** ${duoPartnerInfo}
    `;

      message.reply(response);
    } catch (error) {
      logger.error("Error in !statistics command:", error.message);
      return message.reply(
        "An error occurred while fetching statistics. Please try again."
      );
    }
  },

  //command that will wipe the statistics database, can specify for a specific player or for all players/bot as well
  "!clearstats": async (message) => {
    try {
      // Permission Check
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply("You do not have permission to use this command.");
      }

      const args = message.content.split(" ");

      if (args.length < 2) {
        return message.reply(
          "Usage: `!clearstats <@User>` to clear individual player statistics, or `!clearstats all` to clear all statistics."
        );
      }

      if (args[1] === "all") {
        // Clear all statistics
        await clearAllStatistics();
        return message.reply("✅ **All player statistics have been cleared.**");
      } else {
        const memberMention = message.mentions.members.first();
        if (!memberMention) {
          return message.reply(
            "Please mention a user to clear their statistics (e.g., `!clearstats @User`)."
          );
        }

        const playerId = memberMention.id;

        // Clear individual player statistics
        await clearPlayerStatistics(playerId);

        return message.reply(
          `✅ **Statistics for ${memberMention.user.username} have been cleared.**`
        );
      }
    } catch (error) {
      logger.error("Error in !clearstats command:", error.message);
      return message.reply(
        "An error occurred while clearing statistics. Please try again."
      );
    }
  },
  "!help": async (message) => {
    const commandList = Object.keys(commands)
      .map((cmd) => `- **${cmd}**`)
      .join("\n");
    message.reply(`Here are the available commands:\n${commandList}`);
  },
};

//giga interaction create event listener for buttons
client.on("interactionCreate", async (interaction) => {
  if (
    !interaction.isButton() &&
    interaction.type !== InteractionType.ModalSubmit
  )
    return;

  const thread = interaction.channel;
  const { customId, user } = interaction;
  const playerId = user.id;

  logger.info(`Handling button interaction: ${customId}`);

  switch (customId) {
    // JOIN QUEUE BUTTON
    case "join_queue":
      try {
        // ✅ Check if the queue is locked
        const queueLocked = await new Promise((resolve, reject) => {
          db.get(
            `SELECT value FROM settings WHERE key = 'queue_locked'`,
            [],
            (err, row) => {
              if (err) {
                logger.error("Error checking queue lock status:", err.message);
                return reject(err);
              }
              resolve(row ? parseInt(row.value) : 0);
            }
          );
        });

        if (queueLocked) {
          return interaction
            .reply({
              content:
                "🚫 **Queue entry is currently disabled.** Please wait until it is re-enabled.",
              flags: 64, // Keeps the response private
            })
            .catch(() => {});
        }
        // ✅ Check if the user is blacklisted
        const isBlacklisted = await new Promise((resolve, reject) => {
          db.get(
            `SELECT id FROM blacklist WHERE id = ?`,
            [playerId],
            (err, row) => {
              if (err) {
                logger.error("Error checking blacklist:", err.message);
                return reject(err);
              }
              resolve(row ? true : false);
            }
          );
        });

        if (isBlacklisted) {
          return interaction
            .reply({
              content:
                "🚫 You are blacklisted from matchmaking and cannot enter the queue.",
              flags: 64, // Keeps the response private
            })
            .catch(() => {});
        }

        // ✅ Check if the user is already in an active match
        if (await isPlayerInActiveMatch(playerId)) {
          return interaction
            .reply({
              content:
                "You are already in an active match! Please wait until your current match ends.",
              flags: 64,
            })
            .catch(() => {});
        }

        // ✅ Show platform selection for non-blacklisted users
        const platformButtons = [
          new ButtonBuilder()
            .setCustomId("platform_playstation")
            .setLabel("PlayStation")
            .setEmoji("<:ps:972112725448724480>")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("platform_xbox")
            .setLabel("Xbox")
            .setEmoji("<:xbox_round:972112725352276018>")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("platform_pc")
            .setLabel("PC")
            .setEmoji("<:steam_pr:958049880188805220>")
            .setStyle(ButtonStyle.Secondary),
        ];

        await interaction
          .reply({
            content:
              "Which platform would you like to enter Nightreign matchmaking on?",
            components: [new ActionRowBuilder().addComponents(platformButtons)],
            flags: 64, // Keeps the response private
          })
          .catch(() => {});
      } catch (error) {
        logger.error("Error handling join_queue button:", error.message);
        return interaction
          .reply({
            content: "An error occurred while processing your queue request.",
            flags: 64,
          })
          .catch(() => {});
      }
      break;

    //ready check button
    case "ready_check":
      try {
        const thread = interaction.channel;

        // ✅ Immediately acknowledge the interaction (Prevents "Interaction Failed")
        await interaction.deferReply({ flags: 64 }).catch(() => {});

        // Ensure activeReadyChecks is defined
        if (!activeReadyChecks) activeReadyChecks = new Map();

        // ✅ Fetch match data
        const dbResult = await new Promise((resolve, reject) => {
          db.get(
            `SELECT playerIds, lastReadyCheck FROM channels WHERE threadId = ?`,
            [thread.id],
            (err, row) => {
              if (err) return reject(err);
              resolve(row);
            }
          );
        });

        if (!dbResult) {
          return interaction.editReply({
            content: "❌ This match is not in the database.",
          });
        }

        const { playerIds, lastReadyCheck } = dbResult;
        const players = playerIds.split(",");
        const now = Date.now();
        const cooldown = 15 * 60 * 1000; // 15 minutes cooldown

        // ✅ Admins can bypass cooldown
        const isAdmin = interaction.member.permissions.has(
          PermissionFlagsBits.ManageChannels
        );

        if (!isAdmin && now - lastReadyCheck < cooldown) {
          return interaction.editReply({
            content:
              "A ready check was already conducted recently. Please wait before trying again.",
          });
        }

        // ✅ Check if a ready check is already active
        if (activeReadyChecks.has(thread.id)) {
          return interaction.editReply({
            content: "A ready check is already in progress for this match.",
          });
        }

        // ✅ Update cooldown in DB
        db.run(`UPDATE channels SET lastReadyCheck = ? WHERE threadId = ?`, [
          now,
          thread.id,
        ]);

        // ✅ Start Ready Check
        activeReadyChecks.set(thread.id, { readyPlayers: new Set() });
        await initiateReadyCheck(thread, players);

        // ✅ Send response after initiating ready check
        await interaction.editReply({
          content: "✅ Ready check initiated. Please confirm your readiness.",
        });
      } catch (error) {
        logger.error("❌ Error handling `ready_check` button:", error.message);
        await interaction
          .editReply({
            content: "❌ An error occurred while processing the ready check.",
          })
          .catch(() => {});
      }
      break;

    //find replacement
    case "find_replacement":
      try {
        const thread = interaction.channel;

        // Fetch match data
        const match = await new Promise((resolve, reject) => {
          db.get(
            `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
            [thread.id],
            (err, row) => {
              if (err) {
                logger.error("Error fetching match data:", err.message);
                return reject(err);
              }
              resolve(row);
            }
          );
        });

        if (!match) {
          return interaction.reply({
            content: "This match no longer exists.",
            flags: 64,
          });
        }

        let playerIds = match.playerIds.split(",").filter(Boolean);

        if (playerIds.length >= 3) {
          return interaction.reply({
            content: "This match already has 3 active players.",
            flags: 64,
          });
        }

        // Send a message to prompt players to use !search
        return interaction.reply({
          content: `To find replacement players, type \`!search 1\` or \`!search 2\` depending on how many players need to be replaced.`,
          flags: 64,
        });
      } catch (error) {
        logger.error("Error handling find_replacement button:", error.message);
      }
      break;

    //leavematch button handlers
    case "leave_match":
      try {
        const userId = interaction.user.id;
        const threadId = interaction.channel.id;

        await interaction.deferReply({ flags: 64 }).catch(() => {});

        // ✅ Remove from match database
        await removePlayerFromMatch(userId, threadId);

        // ✅ Remove from thread
        await interaction.channel.members.remove(userId).catch(() => {});

        // ✅ Revoke permissions for thread and VC (if exists)
        if (channel?.permissionoverwrites) {
          await interaction.channel.permissionOverwrites
            .create(userId, {
              ViewChannel: false,
              SendMessages: false,
            })
            .catch(() => {});
        }
        // ✅ Remove from VC if applicable
        const voiceChannelId = await new Promise((resolve, reject) => {
          db.get(
            `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
            [threadId],
            (err, row) => {
              if (err) {
                logger.error("Error fetching voice channel:", err.message);
                return reject(err);
              }
              resolve(row ? row.voiceChannelId : null);
            }
          );
        });

        if (voiceChannelId) {
          const voiceChannel =
            interaction.guild.channels.cache.get(voiceChannelId);
          if (voiceChannel) {
            await voiceChannel.permissionOverwrites
              .create(userId, {
                ViewChannel: false,
                Connect: false,
                Speak: false,
              })
              .catch(() => {});
            await voiceChannel.members
              .get(userId)
              ?.voice.disconnect()
              .catch(() => {});
          }
        }

        // ✅ Handle Remaining Players
        if (playerIds.length === 0) {
          // If all players leave, delete match
          await cleanupMatch({ thread, voiceChannelId: match.voiceChannelId });
          return;
        } else {
          // Show options to remaining players
          const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("end_match_now")
              .setLabel("End Match Immediately")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId("find_replacement")
              .setLabel("Find Replacement from Queue")
              .setStyle(ButtonStyle.Primary)
          );

          await thread.send({
            content: `<@${playerIds.join(
              ">, <@"
            )}>: A player has left. Would you like to end the match or search for a replacement?`,
            components: [actionRow],
          });
        }

        return interaction
          .reply({
            content: "✅ You have successfully left the match.",
            flags: 64,
          })
          .catch(() => {});
      } catch (error) {
        logger.error("Error handling leave_match button:", error.message);
      }
      break;

    // leave queue button handlers
    case customId.startsWith("leave_queue_") ? customId : null:
      try {
        const partnerId = customId.replace("leave_queue_", "");

        // ✅ Ensure the user pressing the button is the correct partner
        if (interaction.user.id !== partnerId) {
          return interaction
            .reply({
              content: "This button is not for you.",
              flags: 64,
            })
            .catch(() => {});
        }

        // ✅ Check if the user is still in the queue
        const isStillQueued = await new Promise((resolve, reject) => {
          db.get(
            `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
            [partnerId],
            (err, row) => {
              if (err) {
                logger.error("Error checking queue status:", err.message);
                return reject(err);
              }
              resolve(!!row);
            }
          );
        });

        if (!isStillQueued) {
          return interaction
            .reply({
              content: "You are no longer in the queue.",
              flags: 64,
            })
            .catch(() => {});
        }

        // ✅ Remove partner from queue
        await new Promise((resolve, reject) => {
          db.run(
            `DELETE FROM players WHERE id = ? AND status = 'queued'`,
            [partnerId],
            (err) => {
              if (err) {
                logger.error(
                  "Error removing duo partner from queue:",
                  err.message
                );
                return reject(err);
              }
              resolve();
            }
          );
        });

        await interaction
          .reply({
            content: "✅ You have successfully left the queue.",
            flags: 64,
          })
          .catch(() => {});
      } catch (error) {
        logger.error("Error handling leave_queue button:", error.message);
      }
      break;

    /** ✅ PLATFORM SELECTION BUTTONS ✅ **/
    case "platform_pc":
    case "platform_xbox":
    case "platform_playstation":
      try {
        // ✅ Check if the queue is locked
        const queueLocked = await new Promise((resolve, reject) => {
          db.get(
            `SELECT value FROM settings WHERE key = 'queue_locked'`,
            [],
            (err, row) => {
              if (err) {
                logger.error("Error checking queue lock status:", err.message);
                return reject(err);
              }
              resolve(row ? parseInt(row.value) : 0);
            }
          );
        });

        if (queueLocked) {
          return interaction
            .reply({
              content:
                "🚫 **Queue entry is currently disabled.** Please wait until it is re-enabled.",
              flags: 64, // Keeps the response private
            })
            .catch(() => {});
        }
        const platform = customId.replace("platform_", "").toLowerCase();
        playerPlatformSelection[playerId] = platform;

        const player = await getPlayerById(playerId);

        if (player) {
          const queueType = player.duoPartner ? "Duo" : "Solo";
          return interaction
            .reply({
              content: `You're already queued as **${queueType}** on platform **${player.platform}**. If you'd like to change your queue status, please leave the queue and re-enter.`,
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId("remove_from_queue")
                    .setLabel("Leave Queue")
                    .setStyle(ButtonStyle.Danger)
                ),
              ],
              flags: 64,
            })
            .catch(() => {});
        }

        await interaction
          .reply({
            content: "Would you like to queue solo or with a friend?",
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId("duo_no")
                  .setLabel("Queue Solo")
                  .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                  .setCustomId("duo_yes")
                  .setLabel("Queue with a Friend")
                  .setStyle(ButtonStyle.Primary)
              ),
            ],
            flags: 64,
          })
          .catch(() => {});
      } catch (error) {
        logger.error("Error handling platform selection:", error.message);
        return interaction
          .reply({
            content: "An error occurred while selecting your platform.",
            flags: 64,
          })
          .catch(() => {});
      }
      return;

    /** ✅ SOLO QUEUE BUTTON ✅ **/
    case "duo_no":
      await handleSoloQueue(interaction);
      return;

    /** ✅ DUO QUEUE BUTTON ✅ **/
    case "duo_yes":
      await handleDuoQueue(interaction);
      return;

    /** ✅ DUO MODAL SUBMISSION ✅ **/
    case "duo_partner_modal":
      await handleDuoQueueModal(interaction);
      return;

    /** ✅ CREATE VOICE CHANNEL BUTTON ✅ **/
    case "create_voice_channel":
      try {
        await interaction.deferReply({ flags: 64 }).catch(() => {});

        const dbResult = await new Promise((resolve, reject) => {
          db.get(
            `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
            [thread.id],
            (err, row) => {
              if (err) return reject(err);
              resolve(row);
            }
          );
        });

        if (!dbResult || !dbResult.playerIds) {
          return interaction
            .editReply({ content: "No players found for this match." })
            .catch(() => {});
        }

        const { playerIds, voiceChannelId } = dbResult;
        const players = playerIds.split(",");

        if (voiceChannelId) {
          return interaction
            .editReply({
              content:
                "A voice channel has already been created for this match.",
            })
            .catch(() => {});
        }

        const parentChannel = thread.parent;
        if (!parentChannel || !parentChannel.parent) {
          return interaction
            .editReply({
              content: "Parent category for this thread could not be found.",
            })
            .catch(() => {});
        }

        const totalChannels = interaction.guild.channels.cache.size;
        const channelLimitReached = totalChannels >= 500;

        if (channelLimitReached) {
          return interaction
            .editReply({
              content:
                "⚠️ Unable to create a voice channel. The server has reached the maximum channel limit (500).",
            })
            .catch(() => {});
        }

        // ✅ Create the voice channel
        const voiceChannel = await interaction.guild.channels.create({
          name: `match-voice-${players.join("-")}`,
          type: ChannelType.GuildVoice,
          parent: parentChannel.parent.id,
        });

        logger.info(`✅ Voice channel created: ${voiceChannel.name}`);

        // ✅ Store the voice channel ID in the database
        db.run(
          `UPDATE channels SET voiceChannelId = ? WHERE threadId = ?`,
          [voiceChannel.id, thread.id],
          (err) => {
            if (err) {
              logger.error(
                `❌ Failed to update database with voice channel ID: ${err.message}`
              );
            }
          }
        );

        // ✅ Set permissions for players
        for (const playerId of players) {
          await voiceChannel.permissionOverwrites.create(playerId, {
            ViewChannel: true,
            Connect: true,
            Speak: true,
          });
        }

        // ✅ Hide channel from everyone else
        await voiceChannel.permissionOverwrites.create(
          interaction.guild.roles.everyone,
          {
            ViewChannel: false,
            Connect: false,
          }
        );

        // ✅ Send success message
        await thread.send({
          content: ` ✅ Voice Channel has been created! Click [Join Voice](https://discord.com/channels/${thread.guild.id}/${voiceChannel.id}) to join.,`,
        });

        await interaction.followUp({
          content: "Voice Channel has been created!",
        });
      } catch (error) {
        logger.error(
          `❌ Error handling create_voice_channel button: ${error.message}`
        );
        return interaction
          .editReply({
            content: "❌ An error occurred while creating the voice channel.",
          })
          .catch(() => {});
      }
      break;

    /** ✅ END MATCH BUTTON ✅ **/
    case "end_match":
      try {
        logger.info(`End match button pressed in thread: ${thread.name}`);

        const dbResult = await new Promise((resolve, reject) => {
          db.get(
            `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
            [thread.id],
            (err, row) => {
              if (err) return reject(err);
              resolve(row);
            }
          );
        });

        if (!dbResult) {
          return interaction
            .reply({
              content: "No match found in the database for this thread.",
              flags: 64,
            })
            .catch(() => {});
        }

        const { playerIds, voiceChannelId } = dbResult;
        const playerList = playerIds.split(",");

        // ✅ Admin Mode: Instantly end the match
        if (
          interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)
        ) {
          logger.info(`Admin ending match: ${thread.name}`);
          await cleanupMatch({ thread, voiceChannelId });
          return interaction
            .reply({ content: "Match ended by admin." })
            .catch(() => {});
        }

        // ✅ Player Vote Mode
        const collectedUsers = new Set();
        const buttonCollector = thread.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 60000,
        });

        buttonCollector.on("collect", async (buttonInteraction) => {
          if (!playerList.includes(buttonInteraction.user.id)) {
            return buttonInteraction
              .reply({
                content:
                  "You are not part of this match and cannot confirm ending it.",
                flags: 64,
              })
              .catch(() => {});
          }

          collectedUsers.add(buttonInteraction.user.id);

          if (collectedUsers.size >= 2) {
            buttonCollector.stop();
            logger.info(`Match ${thread.name} ending via 2/3 player vote.`);
            await cleanupMatch({ thread, voiceChannelId });
            return;
          } else {
            return buttonInteraction
              .reply({
                content: `Waiting for another player to confirm. (${collectedUsers.size}/2 confirmations received)`,
                flags: 64,
              })
              .catch(() => {});
          }
        });

        buttonCollector.on("end", async (collected) => {
          if (collected.size < 2) {
            const updatedThread = await interaction.guild.channels
              .fetch(thread.id)
              .catch(() => null);
            if (updatedThread) {
              updatedThread
                .send(
                  "Vote to end the match expired with insufficient confirmations."
                )
                .catch(() => {});
            }
          }
        });
      } catch (error) {
        logger.error("Error handling end_match button:", error.message);
      }
      break;

    /** ✅ REMOVE FROM QUEUE BUTTON ✅ **/
    case "remove_from_queue":
      try {
        const playerId = user.id;

        const player = await getPlayerById(playerId);

        if (!player) {
          return interaction
            .reply({
              content: "You're not currently in the matchmaking queue.",
              flags: 64,
            })
            .catch(() => {});
        }

        if (player.status === "active") {
          return interaction
            .reply({
              content: "You are in an active match and cannot leave the queue.",
              flags: 64,
            })
            .catch(() => {});
        }

        let partnerMessage = ""; // Will be sent to the duo partner if needed
        let partnerId = null;
        const partnerMember = interaction.guild.members.cache.get(partnerId);

        // ✅ If the player has a duo partner, notify them and remove the duo link
        if (player.duoPartner) {
          partnerId = player.duoPartner;

          // ✅ Remove the duo partner connection
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE players SET duoPartner = NULL WHERE id = ? OR id = ?`,
              [playerId, partnerId],
              (err) => {
                if (err) {
                  logger.error("Error clearing duo partner:", err.message);
                  return reject(err);
                }
                resolve();
              }
            );
          });

          logger.info(
            `Duo partnership cleared for ${playerId} and ${partnerId}`
          );

          // ✅ Check if the duo partner is still in the server
          const partnerMember = interaction.guild.members.cache.get(partnerId);

          if (partnerMember) {
            // ✅ Send the notification **in the same channel where the "Leave Queue" button was pressed**
            await interaction
              .followUp({
                content: `⚠️ <@${partnerId}>, your duo partner has **left the queue**. You are now queued as a **solo** and will be matched with other players.\n\nIf you would like to leave the queue, click below.`,
                components: [
                  new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                      .setCustomId(`leave_queue_${partnerId}`)
                      .setLabel("Leave Queue")
                      .setStyle(ButtonStyle.Danger)
                  ),
                ],
                flags: 64, // Ensures only the mentioned partner sees the message
              })
              .catch((err) =>
                logger.error(
                  `Failed to send duo partner message: ${err.message}`
                )
              );
          } else {
            logger.warn(
              `Partner ${partnerId} has left the server. Skipping notification.`
            );
          }
        }

        // ✅ Remove player from queue
        await new Promise((resolve, reject) => {
          db.run(
            `DELETE FROM players WHERE id = ? AND status = ?`,
            [playerId, "queued"],
            (err) => {
              if (err) {
                logger.error("Error removing player from queue:", err.message);
                return reject(err);
              }
              resolve();
            }
          );
        });

        // ✅ Send confirmation message
        await interaction
          .reply({
            content: "✅ You've been removed from the matchmaking queue.",
            flags: 64,
          })
          .catch((err) =>
            logger.error(
              `Failed to send queue removal confirmation: ${err.message}`
            )
          );
      } catch (error) {
        logger.error("Error handling remove_from_queue button:", error.message);
      }
      break;

    //end match now
    case "end_match_now":
      try {
        const thread = interaction.channel;
        const guild = interaction.guild;

        await interaction.deferReply({ flags: 64 }).catch(() => {});

        // ✅ Fetch match data
        const dbResult = await new Promise((resolve, reject) => {
          db.get(
            `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
            [thread.id],
            (err, row) => {
              if (err) return reject(err);
              resolve(row);
            }
          );
        });

        if (!dbResult) {
          return interaction
            .editReply({ content: "❌ No active match found." })
            .catch(() => {});
        }

        const { voiceChannelId } = dbResult;

        // ✅ Remove match entry from database
        await new Promise((resolve, reject) => {
          db.run(
            `DELETE FROM channels WHERE threadId = ?`,
            [thread.id],
            (err) => {
              if (err) return reject(err);
              resolve();
            }
          );
        });

        // ✅ Notify the thread
        await thread
          .send(
            "⚠️ **Match has been force-ended by a player. The match will end shortly.**"
          )
          .catch(() => {});

        // ✅ Remove all players from the match
        const threadMembers = thread.members.cache.map((m) => m.id);
        for (const playerId of threadMembers) {
          await thread.members.remove(playerId).catch(() => {});
          await thread.permissionOverwrites
            .create(playerId, {
              ViewChannel: false,
              SendMessages: false,
            })
            .catch(() => {});
        }

        // ✅ Delete Voice Channel if it exists
        if (voiceChannelId) {
          const voiceChannel = guild.channels.cache.get(voiceChannelId);
          if (voiceChannel) {
            await voiceChannel.delete().catch(() => {});
          }
        }

        // ✅ Delete the thread after a short delay
        setTimeout(async () => {
          await thread.delete().catch(() => {});
        }, 5000);
      } catch (error) {
        logger.error("❌ Error handling end_match_now:", error.message);
        await interaction
          .editReply({ content: "❌ Error ending match." })
          .catch(() => {});
      }
      break;

    /** ✅ CHECK QUEUE STATUS BUTTON ✅ **/
    case "check_queue_status":
      try {
        const player = await getPlayerById(user.id);

        if (!player) {
          return interaction
            .reply({
              content:
                "You're not currently in the matchmaking queue or an active match.",
              flags: 64,
            })
            .catch(() => {});
        }

        const platform = player.platform.toUpperCase();
        let queueType = "Solo";
        let queueDetails = `🔹 **Platform:** ${platform}\n`;

        // ✅ If the player has a duo partner, ensure they are still in the queue
        if (player.duoPartner) {
          const partnerStillQueued = await new Promise((resolve, reject) => {
            db.get(
              `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
              [player.duoPartner],
              (err, row) => {
                if (err) {
                  logger.error(
                    "Error checking duo partner status:",
                    err.message
                  );
                  return reject(err);
                }
                resolve(row ? true : false);
              }
            );
          });

          if (!partnerStillQueued) {
            await new Promise((resolve, reject) => {
              db.run(
                `UPDATE players SET duoPartner = NULL WHERE id = ? AND duoPartner IS NOT NULL`,
                [user.id],
                (err) => {
                  if (err) {
                    logger.error(
                      "Error clearing orphaned duo partner:",
                      err.message
                    );
                    return reject(err);
                  }
                  resolve();
                }
              );
            });

            logger.info(
              `Duo partner removed for ${user.id} since their partner left the queue.`
            );
          } else {
            queueType = `Duo (with <@${player.duoPartner}>)`;
            queueDetails += `🔹 **Duo Partner:** <@${player.duoPartner}>\n`;
          }
        }

        // ✅ Fetch queue position
        const queuePosition = await getQueuePosition(player.platform);

        // ✅ Fetch estimated wait time
        const avgWaitTime = await calculateAverageQueueTime(
          player.platform,
          player.duoPartner ? "duo" : "solo"
        );
        const estimatedWait =
          avgWaitTime > 0
            ? `${Math.round((avgWaitTime * queuePosition) / 60)} minutes`
            : "N/A";

        queueDetails += `🔹 **Queue Type:** ${queueType}\n`;
        queueDetails += `🔹 **Queue Position:** ${queuePosition}\n`;
        queueDetails += `🔹 **Estimated Wait Time:** ${estimatedWait}\n`;

        // ✅ If the player is already in an active match
        if (player.status === "active") {
          return interaction
            .reply({
              content: `⚔️ You are currently in an **active match** on **${platform}**.`,
              flags: 64,
            })
            .catch(() => {});
        }

        // ✅ Send queue details
        interaction
          .reply({
            content: `📝 **Queue Status:**\n${queueDetails}`,
            flags: 64,
          })
          .catch(() => {});
      } catch (error) {
        logger.error(
          "Error handling check_queue_status button:",
          error.message
        );
      }
      break;
  }
});

async function handleSoloQueue(interaction) {
  const playerId = interaction.user.id;
  const platform = playerPlatformSelection[playerId];

  try {
    if (!platform) {
      return interaction.reply({
        content:
          "❌ Platform selection is missing. Please select your platform again.",
        flags: 64,
      });
    }

    try {
      await enforceQueueCooldown(playerId);
    } catch (error) {
      return interaction.reply({
        content: error.message,
        flags: 64,
      });
    }

    const player = await getPlayerById(playerId);

    if (player) {
      if (player.status === "active") {
        return interaction.reply({
          content: `❌ You are currently in an active match on platform **${player.platform}**. Please finish or leave your current match before re-entering the queue.`,
          flags: 64,
        });
      }

      const platformMap = {
        pc: "PC",
        xbox: "Xbox",
        playstation: "PlayStation",
      };
      const formattedPlatform =
        platformMap[player.platform?.toLowerCase()] || "Unknown Platform";
      const queueType = player.duoPartner ? "Duo" : "Solo";

      let message = `You're currently queued as **${queueType}** on platform **${formattedPlatform}**.`;
      if (player.duoPartner) {
        message += ` Your duo partner is <@${player.duoPartner}>.`;
      }

      return interaction.reply({
        content: `${message}\nIf you'd like to change your queue status or platform, please leave the queue and re-enter with your preferred selections.`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("remove_from_queue")
              .setLabel("Leave Queue")
              .setStyle(ButtonStyle.Danger)
          ),
        ],
        flags: 64,
      });
    }

    // ✅ Add the player to the solo queue safely
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO players (id, platform, status, queue_entered_at) 
               VALUES (?, ?, ?, ?) 
               ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, status = excluded.status, queue_entered_at = excluded.queue_entered_at`,
          [playerId, platform, "queued", Date.now()],
          (err) => {
            if (err) {
              logger.error(
                "Error inserting player into solo queue:",
                err.message
              );
              return reject(err);
            }
            resolve();
          }
        );
      });
    } catch (error) {
      return interaction.reply({
        content:
          "❌ An error occurred while adding you to the queue. Please try again.",
        flags: 64,
      });
    }

    // ✅ Get queue position safely
    let queuePosition;
    try {
      queuePosition = await getQueuePosition(platform);
    } catch (error) {
      logger.error(
        `Error calculating queue position for platform ${platform}:`,
        error.message
      );
      return interaction.reply({
        content:
          "❌ An error occurred while calculating your queue position. Please try again later.",
        flags: 64,
      });
    }

    // ✅ Get estimated wait time safely
    let avgWaitTime;
    try {
      avgWaitTime = await calculateAverageQueueTime(platform, "solo");
    } catch (error) {
      logger.error(
        `Error calculating average wait time for platform ${platform}:`,
        error.message
      );
      avgWaitTime = 0; // Fallback to 0 minutes if error occurs
    }

    await interaction.reply({
      content: `✅ You've been added to the **Solo** queue for **${platform}**.  
              **Queue Position:** ${queuePosition}  
              **Estimated Wait Time:🕒** ${Math.round(
                (avgWaitTime * queuePosition) / 60000
              )} minutes. Please click below to leave the queue.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("remove_from_queue")
            .setLabel("Leave Queue")
            .setStyle(ButtonStyle.Danger)
        ),
      ],
      flags: 64,
    });

    // ✅ Update statistics safely
    const timestamp = Date.now();
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO player_statistics (id, queue_entries, queue_entries_solo, queue_entered_at)
               VALUES (?, 1, 1, ?)
               ON CONFLICT(id) DO UPDATE SET
                 queue_entries = queue_entries + 1,
                 queue_entries_solo = queue_entries_solo + 1,
                 queue_entered_at = excluded.queue_entered_at`,
          [playerId, timestamp],
          (err) => {
            if (err) {
              logger.error(
                "Error updating player statistics for solo queue:",
                err.message
              );
              return reject(err);
            }
            resolve();
          }
        );
      });
    } catch (error) {
      logger.error(
        `Error updating statistics for player ${playerId}:`,
        error.message
      );
    }

    // ✅ Run matchmaking safely
    try {
      await runMatchmaking();
    } catch (error) {
      logger.error(
        `Error running matchmaking after solo queue:`,
        error.message
      );
    }

    // ✅ Update queue statistics & tracking
    try {
      await updateQueueStatistics(playerId, platform, true);
      await incrementBotStatistic("total_queue_entries");
      await incrementBotStatistic(`queue_entries_${platform.toLowerCase()}`);
      await trackUniqueUser(playerId);
    } catch (error) {
      logger.error(`Error updating bot statistics:`, error.message);
    }
  } catch (error) {
    logger.error("Unexpected error in handleSoloQueue:", error.message);
    if (!interaction.replied) {
      await interaction.reply({
        content:
          "❌ An unexpected error occurred while processing your solo queue request.",
        flags: 64,
      });
    }
  }
}

async function matchSoloPlayer(platform, soloPlayerId) {
  try {
    // ✅ Check for a Duo to Match with Solo
    const duoToMatch = await findDuoForSolo(platform, soloPlayerId);
    if (duoToMatch) {
      const partnerId = await new Promise((resolve, reject) => {
        db.get(
          `SELECT duoPartner FROM players WHERE id = ?`,
          [duoToMatch],
          (err, row) => {
            if (err) {
              logger.error("Error fetching duo partner:", err.message);
              return reject(err);
            }
            resolve(row?.duoPartner || null);
          }
        );
      });

      // ✅ Check if the duo partner is still in the queue
      const partnerStillQueued = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
          [partnerId],
          (err, row) => {
            if (err) {
              logger.error("Error checking duo partner status:", err.message);
              return reject(err);
            }
            resolve(row ? true : false);
          }
        );
      });

      if (partnerStillQueued) {
        // ✅ Start match with Solo + Duo
        await startMatch(platform, [soloPlayerId, duoToMatch, partnerId]);
        await updatePlayerStatus(
          [soloPlayerId, duoToMatch, partnerId],
          "active"
        );
        logger.info(`Matched Duo + Solo on ${platform} and created a thread.`);
        return;
      } else {
        // ✅ If the duo partner left, remove the duo connection and treat them as solo
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE players SET duoPartner = NULL WHERE id = ?`,
            [duoToMatch],
            (err) => {
              if (err) {
                logger.error("Error clearing orphaned duo:", err.message);
                return reject(err);
              }
              resolve();
            }
          );
        });

        logger.info(
          `Duo partner left queue. Converting ${duoToMatch} to solo.`
        );
      }
    }

    // ✅ Check for 3 Solo players (including possibly orphaned duo members)
    const matchedPlayers = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id FROM players WHERE platform = ? AND status = ? AND duoPartner IS NULL LIMIT 3`,
        [platform, "queued"],
        (err, rows) => {
          if (err) {
            logger.error("Error fetching solo players:", err.message);
            return reject(err);
          }
          resolve(rows.map((row) => row.id));
        }
      );
    });

    if (matchedPlayers.length === 3) {
      await startMatch(platform, matchedPlayers);
      await updatePlayerStatus(matchedPlayers, "active");
      logger.info(
        `Matched 3 Solo Players on ${platform} and created a thread.`
      );
    }
  } catch (error) {
    logger.error("Error in matchSoloPlayer:", error.message);
  }
}

async function handleDuoQueueModal(interaction) {
  try {
    const friendUsername = interaction.fields.getTextInputValue(
      "duo_partner_username"
    );
    const guild = interaction.guild;
    const userId = interaction.user.id;

    // ✅ Enforce Queue Cooldown
    try {
      await enforceQueueCooldown(userId);
    } catch (error) {
      return interaction.reply({
        content: error.message,
        flags: 64,
      });
    }

    // ✅ Fetch the friend's member object
    const friend = await guild.members
      .fetch({ query: friendUsername, limit: 1 })
      .then((members) =>
        members.find((member) => member.user.username === friendUsername)
      );

    if (!friend) {
      return interaction.reply({
        content:
          "User not found. Ensure their username is correct and they are in this server.",
        flags: 64,
      });
    }

    const friendId = friend.id;
    const platform = playerPlatformSelection[userId];

    if (!platform) {
      return interaction.reply({
        content:
          "❌ Platform selection is missing. Please select your platform again.",
        flags: 64,
      });
    }
    // ✅ Check if the duo partner (friend) is blacklisted
    const isFriendBlacklisted = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM blacklist WHERE id = ?`,
        [friendId],
        (err, row) => {
          if (err) {
            logger.error("Error checking blacklist status:", err.message);
            return reject(err);
          }
          resolve(!!row);
        }
      );
    });

    if (isFriendBlacklisted) {
      return interaction.reply({
        content: `🚫 Your friend <@${friendId}> is blacklisted and cannot enter the queue.`,
        flags: 64,
      });
    }
    // ✅ Check if P1 (the initiator) is already in the solo queue
    const isUserSoloQueued = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM players WHERE id = ? AND status = 'queued' AND duoPartner IS NULL`,
        [userId],
        (err, row) => {
          if (err) {
            logger.error("Error checking solo queue status:", err.message);
            return reject(err);
          }
          resolve(row ? true : false);
        }
      );
    });

    if (isUserSoloQueued) {
      return interaction.reply({
        content:
          "🚫 You are already in the solo queue. Please leave the solo queue before joining as a duo.",
        flags: 64,
      });
    }

    // ✅ Check if P2 (the friend) is already in the solo queue
    const isFriendSoloQueued = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM players WHERE id = ? AND status = 'queued' AND duoPartner IS NULL`,
        [friendId],
        (err, row) => {
          if (err) {
            logger.error(
              "Error checking friend's solo queue status:",
              err.message
            );
            return reject(err);
          }
          resolve(row ? true : false);
        }
      );
    });

    if (isFriendSoloQueued) {
      return interaction.reply({
        content: `🚫 Your friend <@${friendId}> is already in the solo queue. They must leave the solo queue before joining as a duo.`,
        flags: 64,
      });
    }

    // ✅ Validate both user's and friend's statuses
    const userPlayer = await getPlayerById(userId);
    if (userPlayer && userPlayer.status === "active") {
      return interaction.reply({
        content:
          "You are currently in an active match. Please finish or leave your match before entering the queue.",
        flags: 64,
      });
    }

    const friendPlayer = await getPlayerById(friendId);
    if (friendPlayer) {
      if (friendPlayer.status === "active") {
        return interaction.reply({
          content: `Your friend <@${friendId}> is currently in an active match and cannot join the queue.`,
          flags: 64,
        });
      }
      if (friendPlayer.duoPartner && friendPlayer.duoPartner !== userId) {
        return interaction.reply({
          content: `Your friend <@${friendId}> is already queued with another partner.`,
          flags: 64,
        });
      }
    }

    // ✅ Add both players to the duo queue (Single Query)
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO players (id, platform, status, duoPartner, queue_entered_at) VALUES 
       (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,

        [
          userId,
          platform,
          "queued",
          friendId,
          Date.now(),
          friendId,
          platform,
          "queued",
          userId,
          Date.now(),
        ],

        (err) => {
          if (err) {
            logger.error("❌ Error inserting duo queue entries:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });

    // ✅ Update player statistics
    const timestamp = Date.now();
    await updateQueueStatistics(userId, platform, false);
    await updateQueueStatistics(friendId, platform, false);
    await trackUniqueUser(userId);
    await trackUniqueUser(friendId);

    // ✅ Get queue position & estimated wait time
    const queuePosition = await getQueuePosition(userId, platform);
    const avgWaitTime = await calculateAverageQueueTime(platform, "duo");

    // ✅ Success message
    await interaction.reply({
      content: `✅ You and <@${friendId}> have been added to the **Duo** queue for **${platform.toUpperCase()}**.  
              **Queue Position:** ${queuePosition}  
              **Estimated Wait Time:🕒** ${Math.round(
                avgWaitTime / 60000
              )} minutes.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("remove_from_queue")
            .setLabel("Leave Queue")
            .setStyle(ButtonStyle.Danger)
        ),
      ],
      flags: 64,
    });
  } catch (error) {
    logger.error("Error in handleDuoQueueModal:", error.message);
    return interaction.reply({
      content: "An error occurred while processing your duo queue entry.",
      flags: 64,
    });
  }
}

async function handleDuoQueue(interaction) {
  const playerId = interaction.user.id;
  const platform = playerPlatformSelection[playerId];

  try {
    const player = await getPlayerById(playerId);

    // ✅ Prevent re-queueing if the player is already in an active match
    if (player && player.status === "active") {
      return interaction.reply({
        content: `You are currently in an active match on platform **${player.platform}**. Please finish or leave your current match before entering the queue.`,
        flags: 64,
      });
    }

    // ✅ Show current queue status if the player is already queued
    if (player) {
      const platformMap = {
        pc: "PC",
        xbox: "Xbox",
        playstation: "PlayStation",
      };
      const formattedPlatform =
        platformMap[player.platform?.toLowerCase()] || "Unknown Platform";
      const queueType = player.duoPartner ? "Duo" : "Solo";

      let message = `You're currently queued as **${queueType}** on platform **${formattedPlatform}**.`;
      if (player.duoPartner) {
        message += ` Your duo partner is <@${player.duoPartner}>.`;
      }

      return interaction.reply({
        content: `${message}\nIf you'd like to change your queue status or platform, please leave the queue first.`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("remove_from_queue")
              .setLabel("Leave Queue")
              .setStyle(ButtonStyle.Danger)
          ),
        ],
        flags: 64,
      });
    }

    // ✅ Ensure platform is selected
    if (!platform) {
      return interaction.reply({
        content: "You need to select a platform before entering the queue.",
        flags: 64,
      });
    }

    // ✅ Prompt user to enter partner name via Modal
    const modal = new ModalBuilder()
      .setCustomId("duo_partner_modal")
      .setTitle("Enter Your Duo Partner's UNIQUE Username");

    const usernameInput = new TextInputBuilder()
      .setCustomId("duo_partner_username")
      .setLabel("Friend's UNIQUE Discord Username")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const actionRow = new ActionRowBuilder().addComponents(usernameInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
  } catch (error) {
    logger.error("Error handling duo queue:", error.message);
    await interaction.reply({
      content: "An error occurred while processing your duo queue request.",
      flags: 64,
    });
  }
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

async function findDuoForSolo(platform, soloPlayerId) {
  try {
    // Fetch eligible duos directly from the database
    const duoResults = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, duoPartner FROM players 
         WHERE platform = ? AND status = ? AND duoPartner IS NOT NULL AND id != ?`,
        [platform, "queued", soloPlayerId],
        (err, rows) => {
          if (err) {
            logger.error("Error querying duo players:", err.message);
            return reject(err);
          }
          resolve(rows);
        }
      );
    });

    // Check for active status of both duo members
    for (const { id: duoId, duoPartner } of duoResults) {
      const isDuoActive = await getPlayerStatus(duoId);
      const isPartnerActive = await getPlayerStatus(duoPartner);

      if (isDuoActive !== "active" && isPartnerActive !== "active") {
        return duoId; // Return the duo leader's ID
      }
    }

    // No eligible duo found
    return null;
  } catch (error) {
    logger.error("Error finding duo for solo:", error.message);
    return null;
  }
}
// resolves channel perm errors
async function setChannelPermissions(channel, playerId) {
  try {
    await channel.permissionOverwrites.create(playerId, {
      [PermissionFlagsBits.ViewChannel]: true,
      [PermissionFlagsBits.SendMessages]: true,
      [PermissionFlagsBits.Connect]: true,
    });
  } catch (error) {
    logger.error(
      `Error setting permissions for player ${playerId} in channel ${channel.name}:`,
      error.message
    );
  }
}

// Start a match and create a private thread with buttons
async function startMatch(platform, players) {
  if (!players || players.length === 0) {
    logger.warn("⚠️ startMatch was called with an empty match list.");
    return;
  }

  try {
    const guild = client.guilds.cache.first();
    const platformChannel = await getOrCreatePlatformChannel(guild, platform);

    // ✅ Check if a match for these players already exists
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
      logger.warn(
        `⚠️ Attempted to start a duplicate match for players: ${players.join(
          ", "
        )}`
      );
      return;
    }

    // ✅ Create the match thread as PRIVATE and disable invites
    const thread = await platformChannel.threads.create({
      name: `match-${players.join("-")}`,
      autoArchiveDuration: 1440,
      type: ChannelType.GuildPrivateThread, // 🔥 Ensure it's private
      invitable: false, // 🔥 Disable invites
      reason: `Creating private match thread for ${players.join(", ")}`,
    });

    if (!thread) {
      logger.error("❌ Failed to create match thread.");
      return;
    }

    logger.info(`✅ Created private thread: ${thread.name} (ID: ${thread.id})`);

    // ✅ Ensure database entry before proceeding
    const dbInsertSuccess = await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO channels (id, threadId, voiceChannelId, playerIds, lastActivity, lastReadyCheck) VALUES (?, ?, ?, ?, ?, ?)`,
        [thread.id, thread.id, null, players.join(","), Date.now(), 0],
        (err) => {
          if (err) {
            logger.error(
              `❌ Failed to insert match into database for thread ${thread.id}:`,
              err.message
            );
            return reject(err);
          }
          logger.info(
            `✅ Successfully inserted match into database for thread ${thread.id}.`
          );
          resolve(true);
        }
      );
    }).catch(() => false);

    if (!dbInsertSuccess) {
      logger.error("❌ Database insertion failed, aborting match creation.");
      await thread.delete().catch(() => {});
      return;
    }

    // ✅ Add players to the thread using a safe method
    for (const playerId of players) {
      await safeAddToThread(thread, playerId);
    }

    // ✅ Add interactive buttons for match management
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
        .join(", ")}\n
                    **Use the buttons below to manage the match.**`,
      components: [buttons],
    });
  } catch (error) {
    logger.error(
      `❌ Error starting match: ${error.message} | Stack: ${error.stack}`
    );
  }
}

// Helper to get or create platform-specific text channels
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

// insures mapping of created channels is to the correct category, prevents duplicate categories
async function getOrCreateCategory(guild, platform) {
  try {
    // Check if the category already exists
    let category = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name.toLowerCase() === `nightreign-${platform.toLowerCase()}`
    );

    // Create the category if it doesn't exist
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

// Helper to set channel permissions
async function setChannelPermissions(channel, playerId) {
  try {
    await channel.permissionOverwrites.create(playerId, {
      ViewChannel: true,
      SendMessages: true,
      Connect: true,
    });
  } catch (error) {
    logger.error(
      `Error setting permissions for player ${playerId} in channel ${channel.name}:`,
      error
    );
  }
}

async function insertMatchIntoDatabase(textChannelId, voiceChannelId, players) {
  await new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO channels (id, textChannelId, voiceChannelId, playerIds, lastActivity) VALUES (?, ?, ?, ?, ?)`,
      [
        textChannelId,
        textChannelId,
        voiceChannelId,
        players.join(","),
        Date.now(),
      ],
      (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      }
    );
  });
}

// clean up inactive matches function scans for matches to clean up then executes cleanupmatch
setInterval(cleanupMatches, 1 * 1500 * 1000); // Run every 5 minutes CHANGE BACK!!

async function cleanupMatch({ thread, voiceChannelId }) {
  try {
    const dbResult = await new Promise((resolve, reject) => {
      db.get(
        `SELECT playerIds FROM channels WHERE threadId = ?`,
        [thread.id],
        (err, row) => {
          if (err) {
            logger.error("Error fetching match information:", err.message);
            return reject(err);
          }
          resolve(row);
        }
      );
    });

    if (!dbResult) {
      logger.warn(`No match found for thread: ${thread.name}`);
      return;
    }

    const players = dbResult.playerIds.split(",");

    // **Remove players from the database so they can re-enter the queue**
    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM players WHERE id IN (${players.map(() => "?").join(",")})`,
        players,
        (err) => {
          if (err) {
            logger.error("Error deleting players from database:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });

    // **Delete the thread**
    if (thread) {
      await thread
        .delete("Cleaning up inactive match")
        .catch((err) =>
          logger.error(`Failed to delete thread (${thread.id}):`, err.message)
        );
    }

    // **Fetch the latest voice channel reference**
    const fetchedVoiceChannel = thread.guild.channels.cache.get(voiceChannelId);

    if (fetchedVoiceChannel) {
      logger.info(
        `Attempting to delete voice channel: ${fetchedVoiceChannel.name}`
      );

      // **Warn users before disconnecting**
      await fetchedVoiceChannel
        .send(
          "⚠️ This voice channel will be deleted in 5 seconds due to inactivity."
        )
        .catch(() => {});

      // **Wait 5 seconds before disconnecting users**
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const members = [...fetchedVoiceChannel.members.values()];
      for (const member of members) {
        try {
          await member.voice.disconnect();
          logger.info(
            `Disconnected ${member.user.tag} from ${fetchedVoiceChannel.name}`
          );
        } catch (err) {
          logger.error(
            `Error disconnecting ${member.user.tag}: ${err.message}`
          );
        }
      }

      // **Wait for disconnections to complete before deleting**
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Small delay to ensure users disconnect

      // **Delete the voice channel**
      await fetchedVoiceChannel
        .delete("Cleaning up inactive match")
        .then(() => {
          logger.info(
            `Successfully deleted voice channel: ${fetchedVoiceChannel.name}`
          );
        })
        .catch((err) => {
          logger.error(
            `Failed to delete voice channel (${fetchedVoiceChannel.id}):`,
            err.message
          );
        });
    } else {
      logger.warn(`Voice channel ${voiceChannelId} not found.`);
    }

    // **Remove the match record from the database**
    await new Promise((resolve, reject) => {
      db.run(`DELETE FROM channels WHERE threadId = ?`, [thread.id], (err) => {
        if (err) {
          logger.error(
            "Error deleting channel entry from database:",
            err.message
          );
          return reject(err);
        }
        resolve();
      });
    });

    logger.info(
      `Successfully cleaned up thread: ${thread.name} and associated voice channel.`
    );
  } catch (error) {
    logger.error("Error in cleanupMatch function:", error.message);
  }
}

// function that scans for inactive threads and then triggers cleanup if applicable
async function cleanupMatches() {
  console.log("Running periodic cleanup...");

  client.guilds.cache.forEach(async (guild) => {
    const allThreads = guild.channels.cache.filter((channel) =>
      channel.isThread()
    );

    for (const thread of allThreads.values()) {
      try {
        const dbResult = await new Promise((resolve, reject) => {
          db.get(
            `SELECT playerIds, voiceChannelId, lastActivity FROM channels WHERE threadId = ?`,
            [thread.id],
            (err, row) => {
              if (err) {
                logger.error("Error fetching match data:", err.message);
                return reject(err);
              }
              resolve(row);
            }
          );
        });

        if (!dbResult) {
          logger.warn(`No database entry found for thread: ${thread.name}`);
          continue;
        }

        const { playerIds, voiceChannelId, lastActivity } = dbResult;
        const now = Date.now();

        // **Fetch the most recent message in the thread**
        const lastMessage = await thread.messages
          .fetch({ limit: 1 })
          .then((messages) => messages.first())
          .catch(() => null);

        const lastMessageTimestamp = lastMessage
          ? lastMessage.createdTimestamp
          : lastActivity;

        const inactivityPeriod = (now - lastMessageTimestamp) / (1000 * 90); // Convert ms to minutes

        logger.info(
          `Checking thread: ${
            thread.name
          } | Inactive for: ${inactivityPeriod.toFixed(
            2
          )} minutes | VoiceChannelID: ${voiceChannelId}`
        );

        // **Check if a voice channel is associated and active**
        if (voiceChannelId) {
          const voiceChannel = guild.channels.cache.get(voiceChannelId);
          if (voiceChannel) {
            logger.info(
              `Found voice channel: ${voiceChannel.name} | Members: ${voiceChannel.members.size}`
            );

            if (voiceChannel.members.size > 0) {
              logger.info(
                `Skipping cleanup: Voice channel ${voiceChannel.name} is active with ${voiceChannel.members.size} users.`
              );
              continue; // Skip cleanup if users are in voice
            } else {
              logger.info(
                `Voice channel ${voiceChannel.name} is empty. Proceeding with cleanup.`
              );
            }
          } else {
            logger.warn(
              `Voice channel ID ${voiceChannelId} not found in guild cache.`
            );
          }
        } else {
          logger.info(
            `No voice channel associated with thread: ${thread.name}`
          );
        }

        // **Cleanup only if thread is inactive and VC is empty**
        if (inactivityPeriod > 1) {
          logger.info(
            `Thread ${thread.name} is inactive for ${inactivityPeriod.toFixed(
              2
            )} minutes. Cleaning up...`
          );
          await cleanupMatch({ thread, voiceChannelId });
        } else {
          logger.info(`Skipping cleanup for thread: ${thread.name}`);
        }
      } catch (error) {
        logger.error(`Error during cleanup for thread ${thread.name}:`, error);
      }
    }
  });
}

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

// matchmaking function loop runs every 10 seconds to try to matchmake players
async function runMatchmaking() {
  if (isMatchmakingRunning) {
    logger.warn(
      "🚨 Matchmaking is already running, skipping duplicate execution."
    );
    return;
  }

  isMatchmakingRunning = true; // Lock matchmaking execution
  try {
    // ✅ Check if matchmaking is paused
    matchmakingPaused = await new Promise((resolve, reject) => {
      db.get(
        `SELECT value FROM settings WHERE key = 'matchmaking_paused'`,
        [],
        (err, row) => {
          if (err) {
            logger.error(
              "Error checking matchmaking pause status:",
              err.message
            );
            return reject(err);
          }
          resolve(row ? parseInt(row.value) === 1 : false);
        }
      );
    });

    if (matchmakingPaused) {
      logger.info(
        "🚫 Matchmaking is currently paused. No matches will be created."
      );
      return;
    }

    logger.info("Running matchmaking loop...");
    console.log("Attempting Matchmaking...");

    const guild = client.guilds.cache.first();
    const totalQueuedPlayers = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) AS count FROM players WHERE status = 'queued'`,
        [],
        (err, row) => {
          if (err) return reject(err);
          resolve(row ? row.count : 0);
        }
      );
    });

    if (totalQueuedPlayers === 0) {
      logger.info(
        "🚫 No players in queue. Matchmaking paused until players enter the queue."
      );
      return;
    }

    // ✅ 1. Prioritize platforms based on queue wait times
    const prioritizedPlatforms = await prioritizePlatformsByQueueTime();

    for (const platform of prioritizedPlatforms) {
      try {
        // ✅ 2. Fetch queued players **sorted by queue time** (longest-waiting first)
        const queuedPlayers = await new Promise((resolve, reject) => {
          db.all(
            `SELECT id, duoPartner FROM players WHERE platform = ? AND status = 'queued' ORDER BY queue_entered_at ASC`,
            [platform],
            (err, rows) => {
              if (err) {
                logger.error("Error fetching queued players:", err.message);
                return reject(err);
              }
              resolve(rows);
            }
          );
        });

        if (queuedPlayers.length === 0) {
          logger.info(`No players in queue for platform ${platform}`);
          continue;
        }

        // ✅ 3. Handle orphaned duos before matchmaking
        for (const player of queuedPlayers) {
          await handleOrphanedDuos(player.id);
        }

        // ✅ 4. Check available thread spaces BEFORE matchmaking
        const threadLimitReached =
          guild.channels.cache.filter((c) => c.isThread()).size >= 1000;

        if (threadLimitReached) {
          logger.warn(
            `🚨 Matchmaking paused for ${platform} - Thread limit reached!`
          );
          continue; // Prevent matchmaking if no thread slots are available
        }

        // ✅ 5. Categorize players into solos and duos
        const solos = [];
        const duos = new Map();

        for (const player of queuedPlayers) {
          const isMember = await guild.members
            .fetch(player.id)
            .then(() => true)
            .catch(() => false);
          if (!isMember) {
            logger.warn(`Skipping ${player.id} - Not in the Discord server.`);
            continue;
          }

          if (player.duoPartner) {
            duos.set(player.id, player.duoPartner);
          } else {
            solos.push(player.id);
          }
        }

        // ✅ 6. If there are fewer than 3 total players for this platform, move to the next platform
        if (solos.length + duos.size * 2 < 3) {
          logger.info(
            `Skipping platform ${platform} - Not enough players to form a match.`
          );
          continue;
        }

        // ✅ 7. Perform matchmaking based on available players
        while (solos.length >= 1 || duos.size > 0) {
          let match = []; // Ensure match is always defined as an array

          if (duos.size > 0 && solos.length > 0) {
            // ✅ Match a Duo + Solo first
            const [duoId, partnerId] = duos.entries().next().value;
            const soloId = solos.shift();
            duos.delete(duoId);

            match = [soloId, duoId, partnerId];
          } else if (solos.length >= 3) {
            // ✅ Match 3 solos together
            match = solos.splice(0, 3);
          } else {
            break; // No valid matches remaining
          }

          if (!match || match.length === 0) {
            logger.warn("⚠️ Match array is empty. Skipping match creation.");
            continue;
          }

          // ✅ 8. Check if this match already exists
          const existingMatch = await new Promise((resolve, reject) => {
            db.get(
              `SELECT threadId FROM channels 
               WHERE (playerIds LIKE ? OR playerIds LIKE ? OR playerIds LIKE ?) 
               AND threadId IS NOT NULL LIMIT 1`,
              [`%${match[0]}%`, `%${match[1]}%`, `%${match[2]}%`],
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
            logger.warn(
              `⚠️ Duplicate match prevented for players: ${match.join(", ")}`
            );
            continue;
          }

          // ✅ 9. Remove players from the queue **before creating the match**
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE players SET status = 'active' WHERE id IN (${match
                .map(() => "?")
                .join(",")})`,
              match,
              (err) => {
                if (err) {
                  logger.error("Error updating player status:", err.message);
                  return reject(err);
                }
                resolve();
              }
            );
          });

          // ✅ 10. Try to create a match
          if (!match || match.length < 3) {
            logger.error(`🚨 Match variable is undefined or invalid: ${match}`);
            continue; // Prevents the bot from calling startMatch with undefined match
          }
          try {
            await startMatch(platform, match);
            logger.info(
              `✅ Matched players on ${platform}: ${match.join(", ")}`
            );
          } catch (error) {
            logger.error(
              `🚨 Failed to create a thread for match ${match.join(", ")}: ${
                error.message
              }`
            );

            // // // 🔥 Rollback: Reset players to 'queued' since the match failed
            // await new Promise((resolve, reject) => {
            //   db.run(
            //     `UPDATE players SET status = 'queued', queue_entered_at = ? WHERE id IN (${match
            //       .map(() => "?")
            //       .join(",")})`,
            //     [Date.now(), ...match], // Re-adds them to the queue properly
            //     (err) => {
            //       if (err) {
            //         logger.error(
            //           "Error rolling back players to queued status:",
            //           err.message
            //         );
            //         return reject(err);
            //       }
            //       logger.warn(
            //         `🔄 Players reset to "queued" and placed back into matchmaking: ${match.join(
            //           ", "
            //         )}`
            //       );
            //       resolve();
            //     }
            //   );
            // });
          }
        }
      } catch (error) {
        logger.error(
          `Error in matchmaking for platform ${platform}: ${error.message}`
        );
      }
    }
  } catch (error) {
    logger.error("Unexpected error in runMatchmaking:", error.message);
  } finally {
    isMatchmakingRunning = false; // Unlock matchmaking execution
  }
}

// ✅ Function to Start or Restart the Matchmaking Loop
async function startMatchmakingLoop() {
  if (matchmakingLoop) clearInterval(matchmakingLoop);

  matchmakingLoop = setInterval(runMatchmaking, matchmakingInterval);
  logger.info(
    `🚀 Matchmaking loop started (Interval: ${matchmakingInterval}ms)`
  );
}

// ✅ Load settings on startup and start matchmaking loop
loadMatchmakingSettings().then(startMatchmakingLoop);

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

async function getMostCommonDuoPartner(playerId) {
  try {
    const result = await new Promise((resolve, reject) => {
      db.get(
        `SELECT partner_id, MAX(pair_count) as count 
         FROM duo_partner_counts 
         WHERE player_id = ?`,
        [playerId],
        (err, row) => {
          if (err) {
            logger.error(
              "Error fetching most common duo partner:",
              err.message
            );
            return reject(err);
          }
          resolve(row || null);
        }
      );
    });

    return result
      ? { partnerId: result.partner_id, count: result.count }
      : null;
  } catch (error) {
    logger.error("Error in getMostCommonDuoPartner:", error.message);
    return null;
  }
}

//general bot statistics
async function incrementBotStatistic(statKey, incrementBy = 1) {
  try {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO bot_statistics (stat_key, stat_value)
         VALUES (?, ?)
         ON CONFLICT(stat_key) DO UPDATE SET 
           stat_value = stat_value + ?`,
        [statKey, incrementBy, incrementBy],
        (err) => {
          if (err) {
            logger.error("Error incrementing bot statistic:", err.message);
            return reject(err);
          }
          resolve();
        }
      );
    });
    console.log(`Incremented statistic: ${statKey} by ${incrementBy}`);
  } catch (error) {
    logger.error("Error in incrementBotStatistic:", error.message);
  }
}

//tracks players who leave the server, removes them from the queue or from an active match and replaces them if appropriate
client.on("guildMemberRemove", async (member) => {
  const playerId = member.id;

  // ✅ Remove from Queue
  await new Promise((resolve, reject) => {
    db.run(`DELETE FROM players WHERE id = ?`, [playerId], (err) => {
      if (err) {
        logger.error(
          `Error removing player ${playerId} from queue:`,
          err.message
        );
        return reject(err);
      }
      resolve();
    });
  });

  // ✅ Check if player was in a match
  const match = await new Promise((resolve, reject) => {
    db.get(
      `SELECT threadId FROM channels WHERE playerIds LIKE ?`,
      [`%${userId}%`],
      (err, row) => {
        if (err) {
          logger.error("Error checking match status:", err.message);
          return reject(err);
        }
        resolve(row ? row.threadId : null);
      }
    );
  });

  if (!match) return; // ✅ Player wasn't in a match

  // ✅ Remove from match
  await removePlayerFromMatch(userId, match);

  // ✅ Notify the match thread
  const thread = client.channels.cache.get(match);
  if (thread) {
    await thread.send(
      `⚠️ **<@${userId}> left the server and has been removed from the match.**`
    );

    // ✅ Attempt to replace player
    await thread.send(`🔍 **Searching for a replacement...**`);
    await commands["!search"](thread, [`!search`, "1"]);
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
  await loadMatchmakingSettings();
});
