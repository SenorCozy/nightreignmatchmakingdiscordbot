const { SlashCommandBuilder } = require("discord.js");
const db = require("../database");
const {
  incrementMatchesPlayed,
  trackQueueLeaveTimestamp,
} = require("../utils/playerstatshelper");

async function searchForPlayers(thread, requestedPlayers, interaction = null) {
  try {
    if (!thread?.isThread()) {
      const msg = "❌ This command must be used inside an active match thread.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : thread.send(msg);
    }

    // Get match info and voice channel
    let matchInfo;
    try {
      matchInfo = await new Promise((resolve, reject) => {
        db.get(
          `SELECT matches.match_id, channels.voiceChannelId
             FROM matches
             LEFT JOIN channels ON matches.thread_id = channels.threadId
             WHERE matches.thread_id = ?`,
          [threadId],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });
    } catch (err) {
      throw new Error(`Failed to retrieve match info: ${err.message}`);
    }

    const match_id = matchInfo?.match_id;
    const voiceChannelId = matchInfo?.voiceChannelId;
    if (!match_id) {
      const msg = "❌ Match ID not found for this thread.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : thread.send(msg);
    }

    let activePlayers = [];
    try {
      activePlayers = await new Promise((resolve, reject) => {
        db.all(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id],
          (err, rows) =>
            err ? reject(err) : resolve(rows.map((r) => r.playerId))
        );
      });
    } catch (err) {
      throw new Error(`Failed to retrieve active players: ${err.message}`);
    }

    const maxPlayers = 3;
    const remainingSlots = maxPlayers - activePlayers.length;
    const neededPlayers = Math.min(requestedPlayers, remainingSlots);

    if (neededPlayers <= 0) {
      const msg = "⚠️ This match already has 3 players.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : thread.send(msg);
    }

    if (!activePlayers.length) {
      const msg = "❌ Cannot infer platform: no active players in match.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : thread.send(msg);
    }

    let platform;
    try {
      platform = await new Promise((resolve, reject) => {
        db.get(
          `SELECT platform FROM players WHERE id = ?`,
          [activePlayers[0]],
          (err, row) => (err ? reject(err) : resolve(row?.platform || null))
        );
      });
    } catch (err) {
      throw new Error(`Failed to determine platform: ${err.message}`);
    }

    if (!platform) {
      const msg = "❌ Error retrieving platform type.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : thread.send(msg);
    }

    let queuedPlayers = [];
    try {
      queuedPlayers = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id FROM players WHERE platform = ? AND status = 'queued' ORDER BY queue_entered_at ASC LIMIT ?`,
          [platform, neededPlayers],
          (err, rows) => (err ? reject(err) : resolve(rows.map((r) => r.id)))
        );
      });
    } catch (err) {
      throw new Error(`Failed to fetch queued players: ${err.message}`);
    }

    if (!queuedPlayers.length) {
      const msg = "⚠️ No available queued players found.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : thread.send(msg);
    }

    const placeholders = queuedPlayers.map(() => "?").join(", ");
    const now = Date.now();

    try {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE players SET status = 'active' WHERE id IN (${placeholders}) AND status = 'queued'`,
          queuedPlayers,
          (err) => (err ? reject(err) : resolve())
        );
      });
    } catch (err) {
      throw new Error(`Failed to promote players to active: ${err.message}`);
    }

    for (const playerId of queuedPlayers) {
      try {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO match_players (match_id, threadId, playerId, status, joined_at)
             VALUES (?, ?, ?, 'active', ?)
             ON CONFLICT(match_id, playerId) DO UPDATE SET status = 'active', joined_at = excluded.joined_at, threadId = excluded.threadId`,
            [match_id, thread.id, playerId, now],
            (err) => (err ? reject(err) : resolve())
          );
        });

        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO match_events 
             (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
             VALUES (?, ?, ?, 'join', ?, ?, 'active')`,
            [match_id, thread.id, playerId, now, "added by /search"],
            (err) => (err ? reject(err) : resolve())
          );
        });

        await new Promise((resolve, reject) => {
          db.run(
            `INSERT OR IGNORE INTO player_statistics (id) VALUES (?)`,
            [playerId],
            (err) => (err ? reject(err) : resolve())
          );
        });

        await incrementMatchesPlayed(playerId);
        await trackQueueLeaveTimestamp(playerId);
      } catch (err) {
        console.warn(
          `⚠️ Failed to insert or update player ${playerId}: ${err.message}`
        );
      }
    }

    for (const playerId of queuedPlayers) {
      try {
        await thread.members.add(playerId);

        if (voiceChannelId) {
          const vc = thread.guild.channels.cache.get(voiceChannelId);
          if (vc) {
            await vc.permissionOverwrites.edit(playerId, {
              ViewChannel: true,
              Connect: true,
              Speak: true,
            });
          }
        }
      } catch (err) {
        console.warn(
          `⚠️ Failed to add player ${playerId} to thread or VC: ${err.message}`
        );
      }
    }

    const mentions = queuedPlayers.map((id) => `<@${id}>`).join(", ");
    const responseMsg = `✅ Successfully added ${mentions} to the match.`;

    return interaction
      ? interaction.reply({ content: responseMsg, flags: 64 })
      : thread.send(responseMsg);
  } catch (error) {
    console.error("❌ Error in searchForPlayers:", error);
    const msg = "❌ An error occurred while searching for players.";
    return interaction
      ? interaction.reply({ content: msg, flags: 64 })
      : thread.send(msg);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription(
      "Pull 1 or 2 players from the queue into your active match thread"
    )
    .addIntegerOption((option) =>
      option
        .setName("count")
        .setDescription("Number of players to pull (1 or 2)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(2)
    ),
  async execute(interaction) {
    const count = interaction.options.getInteger("count");
    await searchForPlayers(interaction.channel, count, interaction);
  },
  searchForPlayers,
};
