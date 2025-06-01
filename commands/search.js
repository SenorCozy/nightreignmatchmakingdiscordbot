// commands/search.js
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const db = require("../database");
const logger = require("../logger");
const { safeSend } = require("../utils/matchmakingUtils/matchUtils");
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
        : safeSend(thread, msg);
    }

    let matchInfo;
    try {
      matchInfo = await db.getAsync(
        `SELECT matches.match_id, channels.voiceChannelId
         FROM matches
         LEFT JOIN channels ON matches.thread_id = channels.threadId
         WHERE matches.thread_id = ?`,
        [thread.id]
      );
    } catch (err) {
      logger.errorWrapper("DB error fetching match/VC in /search", err, {
        threadId: thread.id,
      });
      return interaction?.reply({
        content: "❌ Failed to retrieve match data.",
        flags: 64,
      });
    }

    const match_id = matchInfo?.match_id;
    const voiceChannelId = matchInfo?.voiceChannelId;

    if (!match_id) {
      const msg = "❌ Match ID not found for this thread.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : safeSend(thread, msg);
    }

    let activePlayers = [];
    try {
      activePlayers = await db
        .allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id]
        )
        .then((rows) => rows.map((r) => r.playerId));
    } catch (err) {
      logger.errorWrapper("DB error fetching active players", err, {
        match_id,
      });
      return interaction?.reply({
        content: "❌ Failed to load active player list.",
        flags: 64,
      });
    }

    const maxPlayers = 3;
    const remainingSlots = maxPlayers - activePlayers.length;
    const neededPlayers = Math.min(requestedPlayers, remainingSlots);

    if (neededPlayers <= 0) {
      const msg = "⚠️ This match already has 3 players.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : safeSend(thread, msg);
    }

    if (!activePlayers.length) {
      const msg = "❌ Cannot infer platform: no active players in match.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : safeSend(thread, msg);
    }

    let platform;
    try {
      platform = await db
        .getAsync(`SELECT platform FROM players WHERE id = ?`, [
          activePlayers[0],
        ])
        .then((row) => row?.platform || null);
    } catch (err) {
      logger.errorWrapper("DB error fetching platform", err, {
        playerId: activePlayers[0],
      });
    }

    if (!platform) {
      const msg = "❌ Error retrieving platform type.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : safeSend(thread, msg);
    }

    let queuedPlayers = [];
    try {
      queuedPlayers = await db
        .allAsync(
          `SELECT id FROM players WHERE platform = ? AND status = 'queued' ORDER BY queue_entered_at ASC LIMIT ?`,
          [platform, neededPlayers]
        )
        .then((rows) => rows.map((r) => r.id));
    } catch (err) {
      logger.errorWrapper("DB error fetching queued players", err, {
        platform,
      });
      return interaction?.reply({
        content: "❌ Could not fetch queue.",
        flags: 64,
      });
    }

    if (!queuedPlayers.length) {
      const msg = "⚠️ No available queued players found.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : safeSend(thread, msg);
    }

    const now = Date.now();
    const placeholders = queuedPlayers.map(() => "?").join(", ");

    try {
      await db.runAsync(
        `UPDATE players SET status = 'active' WHERE id IN (${placeholders}) AND status = 'queued'`,
        queuedPlayers
      );
    } catch (err) {
      logger.errorWrapper(
        "DB error updating player statuses to 'active'",
        err,
        {
          queuedPlayers,
        }
      );
    }

    for (const playerId of queuedPlayers) {
      try {
        await db.runAsync(
          `INSERT INTO match_players (match_id, threadId, playerId, status, joined_at)
           VALUES (?, ?, ?, 'active', ?)
           ON CONFLICT(match_id, playerId)
           DO UPDATE SET status = 'active', joined_at = excluded.joined_at, threadId = excluded.threadId`,
          [match_id, thread.id, playerId, now]
        );

        await db.runAsync(
          `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
           VALUES (?, ?, ?, 'join', ?, ?, 'active')`,
          [match_id, thread.id, playerId, now, "added by /search"]
        );

        await db.runAsync(
          `INSERT OR IGNORE INTO player_statistics (id) VALUES (?)`,
          [playerId]
        );

        await incrementMatchesPlayed(playerId);
        await trackQueueLeaveTimestamp(playerId);
      } catch (err) {
        logger.warn("⚠️ Failed to update match/player records", {
          playerId,
          error: err.message,
        });
      }
    }

    for (const playerId of queuedPlayers) {
      try {
        const alreadyInThread = thread.members.cache.has(playerId);
        if (!alreadyInThread) {
          await thread.members.add(playerId);
        }

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
        logger.warn("⚠️ Failed to add player to thread/VC", {
          playerId,
          error: err.message,
        });
      }
    }

    const mentions = queuedPlayers.map((id) => `<@${id}>`).join(", ");
    const msg = `✅ Successfully added ${mentions} to the match.`;

    return interaction
      ? await interaction.reply({ content: msg, flags: 64 })
      : await safeSend(thread, msg);
  } catch (error) {
    logger.errorWrapper("❌ Error in searchForPlayers", error);
    const msg = "❌ An error occurred while searching for players.";
    try {
      return interaction
        ? await interaction.reply({ content: msg, flags: 64 })
        : await safeSend(thread, msg);
    } catch (fallbackErr) {
      logger.warn("⚠️ Failed to send fallback error message", {
        error: fallbackErr.message,
      });
    }
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Pull 1 or 2 players from the queue into your match")
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
