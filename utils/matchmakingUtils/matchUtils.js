const db = require("../../database");
const {
  addToTotalMatchTime,
  trackLongestMatchTime,
  incrementMatchesPlayed,
  addToPlayerMatchTime,
  trackQueueLeaveTimestamp,
} = require("../playerstatshelper");

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { updateGlobalLongestMatch } = require("../botstatshelper");

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
    console.error("Error checking if player is in an active match:", error);
    return false;
  }
}

async function cleanupMatch({
  thread,
  voiceChannelId,
  closedByUserOrBot = { id: "system", username: "Auto Cleanup" },
  closureReason = "Inactivity",
}) {
  try {
    if (!thread?.id || !thread.guild) {
      console.warn("cleanupMatch called with invalid or missing thread.");
      return;
    }

    const matchInfo = await new Promise((resolve, reject) => {
      db.get(
        `SELECT match_id, created_at FROM matches WHERE thread_id = ?`,
        [thread.id],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    const match_id = matchInfo?.match_id;
    const createdAt = matchInfo?.created_at;
    if (!match_id || !createdAt) {
      console.warn(
        `⚠️ Missing match_id or created_at for thread: ${thread.name}`
      );
      return;
    }

    const now = Date.now();
    const matchDuration = now - createdAt;

    const playerStatuses = await new Promise((resolve, reject) => {
      db.all(
        `SELECT playerId, status FROM match_players WHERE match_id = ?`,
        [match_id],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    const activePlayers = playerStatuses
      .filter((p) => p.status === "active")
      .map((p) => p.playerId);

    // Set leave_in_progress = 1 for all players
    await new Promise((res, rej) =>
      db.run(
        `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ?`,
        [match_id],
        (err) => (err ? rej(err) : res())
      )
    );

    for (const { playerId, status } of playerStatuses) {
      let finalStatus = status;

      if (status === "active") {
        finalStatus = closureReason.toLowerCase().includes("inactivity")
          ? "inactivematchended"
          : "matchended";

        // Update match_players with final status
        await new Promise((res, rej) =>
          db.run(
            `UPDATE match_players SET status = ? WHERE match_id = ? AND playerId = ?`,
            [finalStatus, match_id, playerId],
            (err) => (err ? rej(err) : res())
          )
        );
      }

      // Insert into match_events
      await new Promise((res, rej) =>
        db.run(
          `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
           VALUES (?, ?, ?, 'match_cleanup', ?, ?, ?)`,
          [match_id, thread.id, playerId, now, closureReason, finalStatus],
          (err) => (err ? rej(err) : res())
        )
      );

      // Remove from match_players
      await new Promise((res, rej) =>
        db.run(
          `DELETE FROM match_players WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId],
          (err) => (err ? rej(err) : res())
        )
      );

      // Remove from players table
      await new Promise((res, rej) =>
        db.run(`DELETE FROM players WHERE id = ?`, [playerId], (err) =>
          err ? rej(err) : res()
        )
      );

      // Update statistics
      try {
        await incrementMatchesPlayed(playerId);
        await trackLongestMatchTime(playerId, matchDuration);
        await addToPlayerMatchTime(playerId, matchDuration);
        await trackQueueLeaveTimestamp(playerId);
      } catch (err) {
        console.warn(
          `⚠️ Failed to update stats for ${playerId}: ${err.message}`
        );
      }
    }

    await addToTotalMatchTime(matchDuration);
    await updateGlobalLongestMatch(matchDuration);

    await generateMatchTranscript(thread, closedByUserOrBot, closureReason);

    try {
      await thread.delete("Cleaning up match");
      console.info(`🧹 Successfully deleted thread: ${thread.name}`);
    } catch (err) {
      console.error(
        `❌ Could not delete thread ${thread.id} (${thread.name}): ${err.message}`
      );
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
            console.info(`🔌 Disconnected ${member.user.tag}`);
          } catch (err) {
            console.warn(
              `⚠️ Could not disconnect ${member.user.tag}: ${err.message}`
            );
          }
        }

        await new Promise((r) => setTimeout(r, 2000));
        await vc.delete("Cleaning up inactive match");
        console.info(`✅ Deleted voice channel: ${vc.name}`);
      } catch (err) {
        console.error(`❌ VC cleanup failed: ${err.message}`);
      }
    }

    await new Promise((res, rej) =>
      db.run(`DELETE FROM channels WHERE threadId = ?`, [thread.id], (err) =>
        err ? rej(err) : res()
      )
    );

    await new Promise((res, rej) =>
      db.run(`DELETE FROM matches WHERE match_id = ?`, [match_id], (err) =>
        err ? rej(err) : res()
      )
    );

    console.info(`✅ Match cleanup complete for thread: ${thread.name}`);
  } catch (error) {
    console.error("❌ Unhandled error in cleanupMatch:", error);
  }
}

async function cleanupMatches(client) {
  console.info("🧹 Running periodic cleanup...");

  client.guilds.cache.forEach(async (guild) => {
    const allThreads = guild.channels.cache.filter((channel) =>
      channel.isThread()
    );

    for (const thread of allThreads.values()) {
      try {
        const dbResult = await new Promise((resolve, reject) => {
          db.get(
            `SELECT voiceChannelId, lastActivity FROM channels WHERE threadId = ?`,
            [thread.id],
            (err, row) => (err ? reject(err) : resolve(row))
          );
        });

        if (!dbResult) {
          console.warn(`⚠️ No DB entry for thread: ${thread.name}`);
          continue;
        }

        const { voiceChannelId, lastActivity } = dbResult;
        const now = Date.now();

        const lastMessage = await thread.messages
          .fetch({ limit: 1 })
          .then((msgs) => msgs.first())
          .catch(() => null);

        const lastMessageTimestamp =
          lastMessage?.createdTimestamp || lastActivity;
        const minutesInactive = (now - lastMessageTimestamp) / 60000;

        if (voiceChannelId) {
          const vc = guild.channels.cache.get(voiceChannelId);
          if (vc && vc.members.size > 0) {
            console.info(
              `🎤 Skipping: ${vc.name} has ${vc.members.size} users`
            );
            continue;
          }
        }

        if (minutesInactive > 5) {
          console.info(
            `🕒 Cleaning up thread ${
              thread.name
            } (inactive ${minutesInactive.toFixed(2)} min)`
          );
          await cleanupMatch({ thread, voiceChannelId });
        } else {
          console.info(
            `⌛ Skipping: ${
              thread.name
            } is only inactive ${minutesInactive.toFixed(2)} min`
          );
        }
      } catch (err) {
        console.error(`❌ Cleanup failed for thread ${thread.name}:`, err);
      }
    }
  });
}

async function generateMatchTranscript(
  thread,
  closedBy,
  closureReason = "Unknown"
) {
  try {
    const createdAt = thread.createdTimestamp;
    const closedAt = Date.now();

    const match_id = await new Promise((resolve, reject) => {
      db.get(
        `SELECT match_id FROM matches WHERE thread_id = ?`,
        [thread.id],
        (err, row) => (err ? reject(err) : resolve(row?.match_id))
      );
    });

    const activePlayers = await new Promise((resolve, reject) => {
      db.all(
        `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
        [match_id],
        (err, rows) =>
          err ? reject(err) : resolve(rows.map((r) => `<@${r.playerId}>`))
      );
    });

    const messages = await fetchAllMessages(thread);
    const formatted = messages.map((msg) => ({
      user_id: msg.author.id,
      username: msg.author.username,
      avatar_url: msg.author.displayAvatarURL({ dynamic: true }),
      message:
        msg.content?.trim() || msg.attachments.size > 0
          ? msg.content || "(Image/GIF attached)"
          : "(No content)",
      timestamp: msg.createdTimestamp,
      attachment_url: msg.attachments.first()?.proxyURL || null,
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
    }));

    const playerIdsCSV = activePlayers
      .map((m) => m.replace(/[<@!>]/g, ""))
      .join(",");
    const transcriptId = `match_${match_id}_${Date.now()}`;

    db.run(
      `INSERT INTO transcripts (
        id, match_id, thread_id, user_id, username, closed_by, closed_by_username,
        closure_reason, created_at, closed_at, player_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ]
    );

    for (const msg of formatted) {
      db.run(
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

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("📜 Match Closed")
      .addFields(
        { name: "🧵 Thread", value: `<#${thread.id}>`, inline: true },
        { name: "🆔 Match ID", value: match_id, inline: true },
        { name: "🔒 Closed By", value: `<@${closedBy.id}>`, inline: true },
        {
          name: "🎮 Players",
          value: activePlayers.length > 0 ? activePlayers.join(", ") : "None",
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
      logChannel
        .send({ embeds: [embed], components: [row] })
        .catch(console.error);
    } else {
      console.warn("⚠️ Transcript log channel not found.");
    }
  } catch (error) {
    console.error("❌ Error generating match transcript:", error);
  }
}

async function fetchAllMessages(channel) {
  const allMessages = [];
  let lastId;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const fetched = await channel.messages.fetch(options);
    if (fetched.size === 0) break;

    allMessages.push(...fetched.values());
    lastId = fetched.last().id;
  }

  return allMessages.reverse();
}

module.exports = {
  isPlayerInActiveMatch,
  cleanupMatch,
  cleanupMatches,
  generateMatchTranscript,
  fetchAllMessages,
};
