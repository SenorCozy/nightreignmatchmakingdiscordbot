const { SlashCommandBuilder } = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const { safeSend } = require("../utils/matchmakingUtils/matchUtils");
const {
  incrementMatchesPlayed,
  trackQueueLeaveTimestamp,
} = require("../utils/playerstatshelper");
const { incrementBotStatistic } = require("../utils/statistics");

async function searchForPlayers(thread, requestedPlayers, interaction = null) {
  try {
    logger.info("🔍 Starting /search command", {
      threadId: thread?.id,
      requestedPlayers,
    });

    if (!thread?.isThread()) {
      const msg = "❌ This command must be used inside an active match thread.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : safeSend(thread, msg);
    }

    const matchInfo = await db.getAsync(
      `SELECT matches.match_id, channels.voiceChannelId
       FROM matches
       LEFT JOIN channels ON matches.thread_id = channels.threadId
       WHERE matches.thread_id = ?`,
      [thread.id]
    );

    const match_id = matchInfo?.match_id;
    const voiceChannelId = matchInfo?.voiceChannelId;
    if (!match_id) {
      logger.warn("❌ No match_id found for this thread", {
        threadId: thread.id,
      });
      const msg = "❌ Match ID not found for this thread.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : safeSend(thread, msg);
    }

    const activePlayers = await db
      .allAsync(
        `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
        [match_id]
      )
      .then((rows) => rows.map((r) => r.playerId));

    const maxPlayers = 3;
    const remainingSlots = maxPlayers - activePlayers.length;
    const neededPlayers = Math.min(requestedPlayers, remainingSlots);
    if (neededPlayers <= 0) {
      logger.info("⚠️ Match already full", { match_id });
      const msg = "⚠️ This match already has 3 players.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : safeSend(thread, msg);
    }

    if (activePlayers.length === 0) {
      const msg = "❌ Cannot infer platform: no active players in match.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : safeSend(thread, msg);
    }

    const platform = await db
      .getAsync(`SELECT platform FROM players WHERE id = ?`, [activePlayers[0]])
      .then((row) => row?.platform || null);

    if (!platform) {
      logger.error("❌ Failed to retrieve platform for active player", {
        playerId: activePlayers[0],
      });
      const msg = "❌ Error retrieving platform type.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : safeSend(thread, msg);
    }

    const matchDetails = await db.getAsync(
      `SELECT shared_nightlords FROM matches WHERE match_id = ?`,
      [match_id]
    );
    let matchNightlords = [];

    try {
      matchNightlords = JSON.parse(matchDetails?.shared_nightlords || "[]");
    } catch (err) {
      logger.warn("⚠️ Failed to parse shared_nightlords", {
        rawValue: matchDetails?.shared_nightlords,
        error: err.message,
      });
    }

    const remainingPrefs = await db.allAsync(
      `SELECT q.vc_ok FROM match_players m JOIN queue_preferences q ON m.playerId = q.player_id
       WHERE m.match_id = ? AND m.status = 'active'`,
      [match_id]
    );

    const majorityVcPreferred =
      remainingPrefs.filter((p) => p.vc_ok === 1).length >=
      Math.ceil(remainingPrefs.length / 2);

    logger.debug("🧮 Majority VC preference:", {
      majorityVcPreferred,
      remainingPrefs,
    });

    const queuedPlayers = await db.allAsync(
      `SELECT p.id, q.nightlords, q.vc_ok FROM players p
       LEFT JOIN queue_preferences q ON p.id = q.player_id
       WHERE p.platform = ? AND p.status = 'queued'`,
      [platform]
    );

    const scoredCandidates = queuedPlayers
      .map((player) => {
        const playerNightlords = player.nightlords?.split(",") || [];
        const sharedCount = playerNightlords.filter((boss) =>
          matchNightlords.includes(boss)
        ).length;

        if (sharedCount === 0) {
          logger.debug("⛔ Skipping player — no shared Nightlords", {
            playerId: player.id,
            playerNightlords,
            matchNightlords,
          });
          return null;
        }

        const vcMatch = Number(player.vc_ok) === (majorityVcPreferred ? 1 : 0);

        return {
          id: player.id,
          sharedCount,
          vcMatch,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.sharedCount !== a.sharedCount)
          return b.sharedCount - a.sharedCount;
        return Number(b.vcMatch) - Number(a.vcMatch);
      });

    logger.info("🎯 Scored candidates for match", {
      match_id,
      candidates: scoredCandidates,
    });

    const selectedCandidates = scoredCandidates.slice(0, neededPlayers);
    const addedPlayerIds = selectedCandidates.map((c) => c.id);

    if (addedPlayerIds.length === 0) {
      const msg =
        "⚠️ No suitable queued players found based on Nightlord preferences.";
      return interaction
        ? interaction.reply({ content: msg, flags: 64 })
        : safeSend(thread, msg);
    }

    const now = Date.now();
    const placeholders = addedPlayerIds.map(() => "?").join(", ");
    await db.runAsync(
      `UPDATE players SET status = 'active' WHERE id IN (${placeholders}) AND status = 'queued'`,
      addedPlayerIds
    );

    for (const playerId of addedPlayerIds) {
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

      setImmediate(() => {
        incrementMatchesPlayed(playerId);
        trackQueueLeaveTimestamp(playerId);
      });
    }

    for (const playerId of addedPlayerIds) {
      try {
        if (!thread.members.cache.has(playerId)) {
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

    const vcNotRespected = selectedCandidates.some((c) => !c.vcMatch);
    const mentions = addedPlayerIds.map((id) => `<@${id}>`).join(", ");
    let msg = `✅ Successfully added ${mentions} to the match.`;

    if (vcNotRespected) {
      msg += `\n🔇 Voice chat preference **was not fully respected** to complete the match.`;
      await incrementBotStatistic("vc_not_respected");
    } else {
      await incrementBotStatistic("vc_respected");
    }

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
