const db = require("../../database");
const {
  addToTotalMatchTime,
  trackLongestMatchTime,
  incrementMatchesCompleted,
  ensurePlayerStatRow,
  addToPlayerMatchTime,
} = require("../playerstatshelper");

const {
  updateGlobalLongestMatch,
  addToPlatformMatchTime,
  updatePlatformLongestMatchTime,
  incrementPlatformMatchCount,
} = require("../botstatshelper");

const { awardMatchCompletionPoints } = require("../rewardUtils");
const {
  unlockAchievementIfNotEarned,
  awardHighTurnoverAchievements,
  check24hMatchCompletionStreak,
  checkDailyMatchStreakAchievements,
} = require("../../utils/achievementHelpers");
const { evaluateEventProgress } = require("../../utils/eventUtils");
const {
  activeKickVotes,
  matchEndCollectors,
  activeMatchEndVotes,
  kickCollectors,
} = require("../matchVoteState");
const { getReadyCheck, endReadyCheck } = require("../readyCheckState");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const logger = require("../../logger");

const cleanupInProgress = new Set();
const transcriptInProgress = new Set();

async function isPlayerInActiveMatch(playerId) {
  try {
    const result = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id FROM players WHERE id = ? AND status = 'active'`,
        [playerId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });
    return !!result;
  } catch (error) {
    logger.errorWrapper("isPlayerInActiveMatch", error, { playerId });
    return false;
  }
}

async function cleanupMatch({
  thread,
  voiceChannelId,
  closedByUserOrBot = { id: "system", username: "Auto Cleanup" },
  closureReason = "Inactivity",
}) {
  if (!thread?.id || !thread.guild) {
    logger.warn("cleanupMatch called with invalid or missing thread", {
      thread,
    });
    return;
  }

  if (cleanupInProgress.has(thread.id)) {
    logger.warn("⚠️ Duplicate cleanupMatch prevented for thread", {
      threadId: thread.id,
    });
    return;
  }

  cleanupInProgress.add(thread.id);

  try {
    const wasAutoClosed = closureReason.toLowerCase().includes("inactivity");

    // Cancel all collectors
    endReadyCheck(thread.id);
    matchEndCollectors.get(thread.id)?.stop("cleanup");
    matchEndCollectors.delete(thread.id);
    activeMatchEndVotes.delete(thread.id);

    for (const key of [...kickCollectors.keys()]) {
      if (key.startsWith(`${thread.id}:`)) {
        kickCollectors.get(key)?.stop("cleanup");
        kickCollectors.delete(key);
        activeKickVotes.delete(key);
      }
    }

    const matchInfo = await db.getAsync(
      `SELECT match_id, created_at, platform, formation_type FROM matches WHERE thread_id = ?`,
      [thread.id]
    );
    const match_id = matchInfo?.match_id;
    const createdAt = matchInfo?.created_at;
    const platform = matchInfo?.platform || "unknown";
    const formation = matchInfo?.formation_type;

    if (!match_id || !createdAt) {
      logger.warn("Missing match_id or created_at for thread", {
        threadName: thread.name,
      });
      return;
    }

    const now = Date.now();
    const matchDuration = now - new Date(createdAt).getTime();

    await awardMatchCompletionPoints(
      match_id,
      new Date(createdAt).getTime(),
      true,
      null,
      thread.guild ?? thread.client.guilds.cache.first()
    );

    let initialPlayers = global.initialPlayersByMatch?.[thread.id] || [];

    if (!initialPlayers.length) {
      const row = await db.getAsync(
        `SELECT initial_player_ids FROM matches WHERE match_id = ?`,
        [match_id]
      );
      initialPlayers = row?.initial_player_ids?.split(",") || [];
    }

    const playerStatuses = await db.allAsync(
      `SELECT playerId, status FROM match_players WHERE match_id = ?`,
      [match_id]
    );

    const finalPlayers = playerStatuses
      .filter((p) => p.status === "active")
      .map((p) => p.playerId);

    await db.runAsync(
      `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ?`,
      [match_id]
    );

    for (const { playerId, status } of playerStatuses) {
      let finalStatus = status;

      if (status === "active") {
        finalStatus = wasAutoClosed ? "inactivematchended" : "matchended";
        await db.runAsync(
          `UPDATE match_players SET status = ? WHERE match_id = ? AND playerId = ?`,
          [finalStatus, match_id, playerId]
        );
      }

      await db.runAsync(
        `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
         VALUES (?, ?, ?, 'match_cleanup', ?, ?, ?)`,
        [match_id, thread.id, playerId, now, closureReason, finalStatus]
      );
    }

    logger.info(`📝 Generating transcript for match ${match_id}...`);
    await generateMatchTranscript(
      thread,
      closedByUserOrBot,
      closureReason,
      initialPlayers,
      finalPlayers
    );

    delete global.initialPlayersByMatch?.[thread.id];

    // ⏭ Defer all stat, achievement, and event logic
    setImmediate(async () => {
      try {
        for (const { playerId } of playerStatuses) {
          try {
            await ensurePlayerStatRow(playerId);
            await trackLongestMatchTime(playerId, matchDuration);
            await addToPlayerMatchTime(playerId, matchDuration);
            await incrementMatchesCompleted(
              playerId,
              wasAutoClosed ? 0 : matchDuration,
              match_id,
              wasAutoClosed ? 1 : null
            );
          } catch (err) {
            logger.warn("📉 Stat update failed", {
              playerId,
              matchDuration,
              error: err.stack || err.message,
            });
          }
        }

        await awardHighTurnoverAchievements(match_id);

        for (const playerId of finalPlayers) {
          const metadata = {
            matchId: match_id,
            matchDuration,
            platform,
            initialPlayerIds: initialPlayers,
            finalPlayerIds: finalPlayers,
          };

          await Promise.all([
            evaluateEventProgress(playerId, "complete_match", 1, metadata),
            evaluateEventProgress(playerId, "matches_completed", 1, metadata),
            evaluateEventProgress(playerId, "complete_with_user", 1, metadata),
            evaluateEventProgress(
              playerId,
              "complete_long_match",
              matchDuration,
              metadata
            ),
            evaluateEventProgress(
              playerId,
              "complete_1_hour_match",
              matchDuration,
              metadata
            ),
          ]);

          if (formation === "duo") {
            await evaluateEventProgress(
              playerId,
              "matches_completed_duo",
              1,
              metadata
            );
          }

          if (formation === "trio") {
            await evaluateEventProgress(
              playerId,
              "matches_completed_trio",
              1,
              metadata
            );
          }

          await check24hMatchCompletionStreak(playerId);
          await checkDailyMatchStreakAchievements(playerId);
        }

        await Promise.all([
          addToTotalMatchTime(matchDuration),
          updateGlobalLongestMatch(matchDuration),
          addToPlatformMatchTime(platform, matchDuration),
          updatePlatformLongestMatchTime(platform, matchDuration),
          incrementPlatformMatchCount(platform),
        ]);
      } catch (err) {
        logger.errorWrapper("Deferred post-cleanup task failed", err);
      }
    });

    await db.runAsync(`DELETE FROM match_players WHERE match_id = ?`, [
      match_id,
    ]);
    await db.runAsync(
      `DELETE FROM players WHERE id IN (${playerStatuses
        .map(() => "?")
        .join(",")})`,
      playerStatuses.map((p) => p.playerId)
    );
    await db.runAsync(
      `UPDATE matches SET closed_at = ?, closed_by = ?, closure_reason = ? WHERE match_id = ?`,
      [now, closedByUserOrBot.id || "system", closureReason, match_id]
    );
    await db.runAsync(`DELETE FROM channels WHERE threadId = ?`, [thread.id]);

    try {
      await thread.delete("Cleaning up match");
      logger.info(`🧹 Successfully deleted thread: ${thread.name}`);
    } catch (err) {
      logger.errorWrapper("Thread deletion failed", err, {
        threadId: thread.id,
        threadName: thread.name,
      });
    }

    const vc = thread.guild.channels.cache.get(voiceChannelId);
    if (vc) {
      try {
        await vc
          .send("⚠️ This voice channel will be deleted in 5 seconds.")
          .catch(() => {});
        await new Promise((r) => setTimeout(r, 5000));

        for (const member of vc.members.values()) {
          try {
            await member.voice.disconnect();
            logger.info(`🔌 Disconnected ${member.user.tag}`);
          } catch (err) {
            logger.warn("Failed to disconnect VC member", {
              member: member.user.tag,
              error: err.message,
            });
          }
        }

        await new Promise((r) => setTimeout(r, 2000));
        await vc.delete("Cleaning up inactive match");
        logger.info(`✅ Deleted voice channel: ${vc.name}`);
      } catch (err) {
        logger.errorWrapper("VC cleanup failed", err);
      }
    }

    logger.info(`✅ Match cleanup complete for thread: ${thread.name}`);
  } catch (error) {
    logger.errorWrapper("Unhandled error in cleanupMatch", error);
  } finally {
    cleanupInProgress.delete(thread.id);
  }
}

async function cleanupMatches(client) {
  logger.info("🧹 Running periodic cleanup...");

  for (const guild of client.guilds.cache.values()) {
    try {
      const activeMatchThreads = await db.allAsync(
        `SELECT m.match_id, m.thread_id, c.voiceChannelId, c.lastActivity
         FROM matches m
         JOIN channels c ON m.thread_id = c.threadId
         WHERE m.closed_at IS NULL`
      );

      for (const row of activeMatchThreads) {
        const { thread_id, voiceChannelId, lastActivity } = row;
        const thread = await guild.channels.fetch(thread_id).catch(() => null);
        if (!thread?.isThread()) continue;

        const now = Date.now();

        // Try to get the most recent message in the thread
        const lastMessage = await thread.messages
          .fetch({ limit: 1 })
          .then((msgs) => msgs.first())
          .catch(() => null);

        const lastMessageTimestamp =
          lastMessage?.createdTimestamp || lastActivity || 0;
        const minutesInactive = (now - lastMessageTimestamp) / 60000;

        if (voiceChannelId) {
          const vc = guild.channels.cache.get(voiceChannelId);
          if (vc && vc.members.size > 0) {
            logger.info("🎤 Skipping voice channel with active users", {
              threadName: thread.name,
              vcName: vc.name,
              memberCount: vc.members.size,
            });
            continue;
          }
        }

        if (minutesInactive > 90) {
          logger.info("🕒 Match thread inactive — initiating cleanup", {
            threadName: thread.name,
            minutesInactive: minutesInactive.toFixed(2),
          });

          await cleanupMatch({
            thread,
            voiceChannelId,
            closedByUserOrBot: { id: "system", username: "Auto Cleanup" },
            closureReason: "Inactivity",
          });
        } else {
          logger.info("⌛ Match thread still active — skipping", {
            threadName: thread.name,
            minutesInactive: minutesInactive.toFixed(2),
          });
        }
      }
    } catch (err) {
      logger.errorWrapper("❌ Error during cleanupMatches run", err, {
        guildId: guild.id,
        guildName: guild.name,
      });
    }
  }
}

function formatMentions(msg) {
  const mentions = msg.mentions?.users;

  if (mentions?.size > 0) {
    return Array.from(mentions.values())
      .map((u) => `<@${u.id}> (${u.username})`)
      .join(", ");
  }

  // fallback: regex match all mention IDs
  const fallbackMatches = msg.content?.match(/<@!?\d+>/g);
  return fallbackMatches?.join(", ") || "someone";
}

function getSystemMessageDescription(msg) {
  const authorName = msg.author?.username || "A user";
  const mentionedUsers = formatMentions(msg);

  switch (msg.type) {
    case 1:
      return `➕ ${authorName} added ${mentionedUsers} to a group.`;
    case 2:
      return `➖ ${authorName} removed ${mentionedUsers} from the thread.`;
    case 3:
      return `✏️ Channel name changed to: ${msg.content}`;
    case 4:
      return "🖼️ Channel icon updated.";
    case 5:
      return "📌 A message was pinned.";
    case 6:
      return `🎉 ${authorName} joined the server.`;
    case 12:
      return `🧵 ${authorName} created a thread.`;
    case 18:
      return `➕ ${authorName} added ${mentionedUsers} to the thread.`;
    case 19:
      return `➖ ${authorName} removed ${mentionedUsers} from the thread.`;
    case 20:
      return `✅ ${authorName} joined the thread.`;
    case 21:
      return `🚪 ${authorName} left the thread.`;
    default:
      logger.debug("Unknown system message", {
        type: msg.type,
        author: authorName,
        content: msg.content,
      });
      return `ℹ️ Unknown system event (type ${msg.type})`;
  }
}

async function generateMatchTranscript(
  thread,
  closedBy,
  closureReason = "Unknown",
  initialPlayers = [],
  finalPlayers = []
) {
  if (!thread?.id || !thread.guild) {
    logger.warn("generateMatchTranscript called with invalid thread", {
      thread,
    });
    return;
  }

  if (transcriptInProgress.has(thread.id)) {
    logger.warn("⚠️ Duplicate transcript generation prevented", {
      threadId: thread.id,
    });
    return;
  }

  transcriptInProgress.add(thread.id);

  try {
    const freshThread = await thread.client.channels
      .fetch(thread.id)
      .catch(() => null);
    if (!freshThread || freshThread.deleted || freshThread.archived) {
      logger.warn(
        "🛑 Aborting transcript generation — thread no longer exists",
        {
          threadId: thread.id,
        }
      );
      return;
    }

    const createdAt = thread.createdTimestamp;
    const closedAt = Date.now();
    const durationMs = closedAt - createdAt;

    const matchInfo = await db.getAsync(
      `SELECT match_id, platform, formation_type, initial_player_ids FROM matches WHERE thread_id = ?`,
      [thread.id]
    );

    const match_id = matchInfo?.match_id;
    let platform = matchInfo?.platform || "Unknown";
    const formationType = matchInfo?.formation_type || "Unknown";

    const matchDetails = await db.getAsync(
      `SELECT vc_match, shared_nightlords FROM matches WHERE match_id = ?`,
      [match_id]
    );

    const vcRespected = matchDetails?.vc_match;
    const sharedNightlords = matchDetails?.shared_nightlords || null;

    if (!match_id) {
      logger.warn("❌ Missing match_id for thread", {
        threadName: thread.name,
      });
      return;
    }

    // Format platform name
    const platformMap = {
      pc: "PC (Steam)",
      xbox: "XBOX",
      playstation: "Playstation",
    };
    platform = platformMap[platform.toLowerCase()] || platform;

    if (!initialPlayers.length && matchInfo.initial_player_ids) {
      try {
        const raw = matchInfo.initial_player_ids;
        initialPlayers = raw.includes("[")
          ? JSON.parse(raw) // if stored as JSON string
          : raw.split(",");
      } catch {
        initialPlayers = matchInfo.initial_player_ids.split(",");
      }
    }

    const allPlayers = await db.allAsync(
      `SELECT playerId, status FROM match_players WHERE match_id = ?`,
      [match_id]
    );

    const interimPlayers = allPlayers
      .filter(
        (p) =>
          !initialPlayers.includes(p.playerId) &&
          !finalPlayers.includes(p.playerId)
      )
      .map((p) => p.playerId);

    const voiceChannelId = await db
      .getAsync(`SELECT voiceChannelId FROM channels WHERE match_id = ?`, [
        match_id,
      ])
      .then((row) => row?.voiceChannelId || null);

    const matchCount = await db
      .getAsync(`SELECT COUNT(*) AS count FROM matches`)
      .then((row) => row.count);

    const messages = await fetchAllMessages(thread).catch((err) => {
      logger.errorWrapper(
        "Failed to fetch thread messages for transcript",
        err,
        {
          threadId: thread.id,
        }
      );
      return [];
    });

    const formatted = messages
      .map((msg) => {
        const isSystem =
          msg.system ||
          (typeof msg.type === "number" &&
            msg.type !== 0 &&
            !msg.content &&
            !msg.embeds?.length &&
            !msg.interaction);

        const systemText = isSystem ? getSystemMessageDescription(msg) : null;

        if (!msg.author && !systemText) return null;

        return {
          user_id: isSystem ? "system" : msg.author?.id || "unknown",
          username: isSystem
            ? "System Message"
            : msg.author?.username || "Unknown",
          avatar_url: isSystem
            ? "/system-avatar.png"
            : msg.author?.displayAvatarURL({ dynamic: true }) ||
              "/bot-avatar.png",
          message: isSystem
            ? systemText
            : msg.content?.trim() ||
              (msg.attachments.size > 0
                ? "(Image/GIF attached)"
                : "(No content)"),
          timestamp: msg.createdTimestamp,
          attachment_url: msg.attachments.first()?.url || null,
          embed_data:
            msg.embeds.length > 0
              ? JSON.stringify(msg.embeds.map((e) => e.toJSON()))
              : null,
          reactions:
            msg.reactions.cache.size > 0
              ? JSON.stringify(
                  msg.reactions.cache.map((r) => ({
                    emoji: r.emoji.name,
                    count: r.count,
                  }))
                )
              : null,
        };
      })
      .filter(Boolean);

    const transcriptId = `match_${match_id}_${Date.now()}`;
    const playerIdsCSV = allPlayers.map((p) => p.playerId).join(",");

    initialPlayers.sort();
    interimPlayers.sort();
    finalPlayers.sort();

    await db.runAsync(
      `INSERT INTO transcripts (
  id, match_id, thread_id, user_id, username, closed_by, closed_by_username,
  closure_reason, created_at, closed_at, player_ids,
  initial_player_ids, interim_player_ids, final_player_ids, platform,
  vc_respected, shared_nightlords
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transcriptId,
        match_id,
        thread.id,
        thread.ownerId || "unknown",
        thread.owner?.user?.username || "Unknown",
        closedBy.id,
        closedBy.username,
        closureReason,
        createdAt,
        closedAt,
        playerIdsCSV,
        initialPlayers.join(","),
        interimPlayers.join(","),
        finalPlayers.join(","),
        platform,
        vcRespected,
        sharedNightlords,
      ]
    );

    for (const msg of formatted) {
      await db.runAsync(
        `INSERT INTO transcript_messages (
          transcript_id, user_id, username, avatar_url, message, timestamp,
          attachment_url, embed_data, reactions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transcriptId,
          msg.user_id,
          msg.username,
          msg.avatar_url,
          msg.message,
          msg.timestamp,
          msg.attachment_url,
          msg.embed_data,
          msg.reactions,
        ]
      );
    }

    const transcriptUrl = `${process.env.TRANSCRIPT_BASE_URL}/${transcriptId}`;
    const formatTime = (t) => `<t:${Math.floor(t / 1000)}:F>`;
    const durationMin = Math.round(durationMs / 60000);

    // 🎧 VC preference status
    let vcText = "Not specified";
    if (vcRespected === 1) vcText = "Yes ✅";
    else if (vcRespected === 0) vcText = "No ❌";

    // 👹 Shared Nightlords
    const NIGHTLORD_LABELS = {
      tricephalos: "Tricephalos",
      gaping_jaw: "Gaping Jaw",
      sentient_pest: "Sentient Pest",
      augur: "Augur",
      equilibrious_beast: "Equilibrious Beast",
      darkdrift_knight: "Darkdrift Knight",
      fissure: "Fissure in the Fog",
      night_aspect: "Night Aspect",
    };

    const nightlordText = sharedNightlords
      ? sharedNightlords
          .split(",")
          .map((nl) => NIGHTLORD_LABELS[nl] || nl)
          .join(", ")
      : "Not recorded";
    const cleanId = (entry) => {
      try {
        if (typeof entry !== "string") entry = String(entry);
        return entry.replace(/[^0-9]/g, "").trim(); // Keep only digits
      } catch {
        return null;
      }
    };

    const formatMentions = (ids) => {
      if (!ids || ids.length === 0) return "None";

      return (
        ids
          .flatMap((item) =>
            typeof item === "string" && item.includes(",")
              ? item.split(",")
              : [item]
          )
          .map(cleanId)
          .filter((id) => id?.length === 18)
          .map((id) => `<@${id}>`)
          .join(", ") || "None"
      );
    };

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle(`📜 Match #${matchCount} Closed`)
      .addFields(
        { name: "🆔 Match ID", value: match_id, inline: true },
        { name: "🔒 Closed By", value: `<@${closedBy.id}>`, inline: true },
        { name: "🧩 Formation", value: formationType, inline: true },
        { name: "🖥️ Platform", value: platform, inline: true },
        {
          name: "⏱️ Duration",
          value: `${durationMin} minute(s)`,
          inline: true,
        },
        {
          name: "👥 Initial Players",
          value: formatMentions(initialPlayers),
        },
        {
          name: "♻️ Interim Players",
          value: interimPlayers.map((id) => `<@${id}>`).join(", ") || "None",
        },
        {
          name: "✅ Final Players",
          value: finalPlayers.map((id) => `<@${id}>`).join(", ") || "None",
        },
        {
          name: "🔊 Voice Channel",
          value: voiceChannelId ? `<#${voiceChannelId}>` : "Not created",
          inline: true,
        },
        {
          name: "🎧 VC Preference Respected",
          value: vcText,
          inline: true,
        },
        {
          name: "👹 Shared Nightlords",
          value: nightlordText,
        },
        { name: "📄 Reason", value: closureReason },
        { name: "🕓 Created", value: formatTime(createdAt), inline: true },
        { name: "🕓 Closed", value: formatTime(closedAt), inline: true }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("📜 View Online Transcript")
        .setStyle(ButtonStyle.Link)
        .setURL(transcriptUrl)
    );

    const logChannel = thread.guild.channels.cache.get(
      process.env.TRANSCRIPT_CHANNEL_ID
    );

    if (logChannel) {
      await logChannel
        .send({ embeds: [embed], components: [row] })
        .catch((err) =>
          logger.warn("Failed to send transcript embed", { error: err.message })
        );
    } else {
      logger.warn("Transcript log channel not found", {
        transcriptId,
        guildId: thread.guild.id,
      });
    }
  } catch (error) {
    logger.errorWrapper("Error generating match transcript", error, {
      threadId: thread.id,
      closedBy: closedBy.username,
    });
  } finally {
    transcriptInProgress.delete(thread.id);
  }
}

async function fetchAllMessages(channel) {
  const allMessages = [];
  let lastId;

  try {
    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const fetched = await channel.messages.fetch(options);
      if (fetched.size === 0) break;

      const messages = [...fetched.values()];
      allMessages.push(...messages);

      lastId = messages[messages.length - 1].id;
    }
  } catch (error) {
    logger.errorWrapper("Failed to fetch all messages for transcript", error, {
      channelId: channel.id,
    });
  }

  return allMessages.reverse(); // Oldest → Newest
}

async function safeSend(thread, content) {
  try {
    const exists = await thread.client.channels
      .fetch(thread.id)
      .catch(() => null);
    if (!exists || exists.deleted || thread.archived) return false;
    await thread.send(content);
    return true;
  } catch (err) {
    logger.warn("⚠️ Failed to send message during async callback", {
      threadId: thread.id,
      error: err.message,
    });
    return false;
  }
}

module.exports = {
  isPlayerInActiveMatch,
  cleanupMatch,
  cleanupMatches,
  generateMatchTranscript,
  fetchAllMessages,
  safeSend,
  getSystemMessageDescription,
};
