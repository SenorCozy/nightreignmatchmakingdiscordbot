const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");
const { v4: uuidv4 } = require("uuid");
const db = require("../../database");
const logger = require("../../logger");
const {
  safeAddToThread,
  getOrCreatePlatformChannel,
} = require("../threadUtils");
const {
  incrementMatchesPlayed,
  trackQueueLeaveTimestamp,
  incrementPlatformUsage,
} = require("../playerstatshelper");
const { incrementBotStatistic } = require("../statistics");
const {
  evaluateEventProgress,
  checkNewUniquePartners,
  checkRepeatDuo,
  checkRepeatTrio,
} = require("../eventUtils");
const {
  unlockAchievementIfNotEarned,
  checkRepeatPartnerAchievements,
  trackNewUniquePartners,
} = require("../../utils/achievementHelpers");

async function startMatch(
  client,
  platform,
  players,
  formationType = "unknown"
) {
  if (!players || players.length === 0) {
    logger.warn("startMatch was called with an empty match list.");
    return;
  }

  if (formationType === "trio" && players.length !== 3) {
    logger.error("🚨 Trio match was called with incorrect player count", {
      players,
    });
    return;
  }

  try {
    const guild = client.guilds.cache.first();
    const fetchedChannels = await guild.channels.fetch();
    const activeThreads = fetchedChannels.filter((c) => c.isThread()).size;
    const placeholders = players.map(() => "?").join(", ");

    if (activeThreads >= 1000) {
      logger.warn("Thread limit (1000) reached. Match aborted.");

      await db.run(
        `UPDATE players SET duoPartner = NULL WHERE id IN (${placeholders})`,
        players
      );

      return { error: "Thread limit reached — match aborted.", players };
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE players SET status = 'queued' WHERE id IN (${placeholders})`,
        players,
        (err) => (err ? reject(err) : resolve())
      );
    });
    const platformChannel = await getOrCreatePlatformChannel(guild, platform);

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
      logger.warn(
        `Duplicate match prevented. Player already in thread: ${existingMatch}`
      );
      return;
    }

    const thread = await platformChannel.threads.create({
      name: `match-${players.join("-")}`,
      autoArchiveDuration: 1440,
      type: ChannelType.GuildPrivateThread,
      invitable: false,
      reason: `Creating match thread for ${players.join(", ")}`,
    });

    if (!thread) {
      logger.error("Failed to create match thread.");
      return;
    }

    const matchId = uuidv4();

    logger.debug(`📌 Tracked initialPlayers for ${thread.id}:`, players);

    const timestamp = Date.now();

    await db.run(
      `INSERT INTO matches 
       (match_id, thread_id, platform, created_by, created_at, match_start_time, formation_type, initial_player_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        matchId,
        thread.id,
        platform,
        players[0],
        timestamp,
        timestamp,
        formationType,
        players.join(","), // store comma-separated player IDs
      ]
    );
    try {
      await checkRepeatPartnerAchievements(matchId, formationType, players);
    } catch (err) {
      logger.error("Error checking repeat partner achievements", {
        matchId,
        err,
      });
    }

    await incrementBotStatistic("total_matches_created", 1);
    await incrementBotStatistic(`matches_created_${platform}`, 1);

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO channels 
         (id, threadId, voiceChannelId, match_id, playerIds, lastActivity, lastReadyCheck)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [thread.id, thread.id, null, matchId, players.join(","), timestamp, 0],
        (err) => (err ? reject(err) : resolve())
      );
    });

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

      if (players.length === 3) {
        const trioGroup = await db.getAsync(
          `SELECT trio_id FROM trio_partner_groups
           WHERE active = 1
             AND player1_id IN (?, ?, ?)
             AND player2_id IN (?, ?, ?)
             AND player3_id IN (?, ?, ?)`,
          [...players, ...players, ...players]
        );

        if (trioGroup?.trio_id) {
          await db.runAsync(
            `UPDATE trio_partner_groups SET active = 0 WHERE trio_id = ?`,
            [trioGroup.trio_id]
          );
          logger.info("🔗 Trio group marked inactive after match start", {
            matchId,
            trio_id: trioGroup.trio_id,
          });
        }
      }
      // 🔄 Ensure trio members are marked active in `players` table

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO match_events 
           (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
           VALUES (?, ?, ?, 'join', ?, ?, 'active')`,
          [matchId, thread.id, playerId, timestamp, "startMatch"],
          (err) => (err ? reject(err) : resolve())
        );
      });

      const row = await db.getAsync(
        `SELECT id FROM queue_history
         WHERE playerId = ? AND platform = ? AND queue_left_at IS NULL
         ORDER BY queue_entered_at DESC LIMIT 1`,
        [playerId, platform]
      );

      if (row?.id) {
        await db.runAsync(
          `UPDATE queue_history SET queue_left_at = ? WHERE id = ?`,
          [Date.now(), row.id]
        );
      } else {
        logger.debug(
          "🕵️ No matching queue_history found to update for player",
          {
            playerId,
            platform,
          }
        );
      }

      // 🧠 Determine queue intent from queue_history
      const queueRow = await db.getAsync(
        `SELECT duoPartner, trioPartner1, trioPartner2 
   FROM queue_history
   WHERE playerId = ? AND queue_left_at IS NULL
   ORDER BY queue_entered_at DESC LIMIT 1`,
        [playerId]
      );

      let queueFormationType = "solo";
      if (queueRow?.trioPartner1 && queueRow?.trioPartner2) {
        queueFormationType = "trio";
      } else if (queueRow?.duoPartner) {
        queueFormationType = "duo";
      }

      // 🏁 Record formation intent
      await db.runAsync(
        `INSERT OR IGNORE INTO formation_progress (player_id, formation_type)
   VALUES (?, ?)`,
        [playerId, queueFormationType]
      );

      // 🏆 Check for formation diversity achievement
      await unlockAchievementIfNotEarned(playerId, "formation_diversity");

      // Build metadata per player
      const partnerIds = players.filter((id) => id !== playerId);
      const metadata = {
        formationType,
        platform,
        partnerIds,
        queueType: formationType,
      };

      // 🧠 Unique partner check
      const newUniquePartners = await checkNewUniquePartners(playerId, players);
      if (newUniquePartners > 0) metadata.newUniquePartners = newUniquePartners;

      // 🔁 Repeat duo/trio partner check
      if (formationType === "duo" && partnerIds.length === 1) {
        const isRepeat = await checkRepeatDuo(playerId, partnerIds[0]);
        if (isRepeat) metadata.repeatDuo = true;
      }

      if (formationType === "trio" && partnerIds.length === 2) {
        const isRepeat = await checkRepeatTrio(playerId, partnerIds);
        if (isRepeat) metadata.repeatTrio = true;
      }

      // 🎯 Evaluate event goals
      await Promise.all([
        evaluateEventProgress(playerId, "matches_played", 1, metadata),
        evaluateEventProgress(playerId, "play_match", 1, metadata),
        evaluateEventProgress(playerId, "play_with_user", 1, metadata),
        evaluateEventProgress(playerId, "unique_partners", 1, metadata),
        evaluateEventProgress(playerId, "repeat_duo", 1, metadata),
        evaluateEventProgress(playerId, "repeat_trio", 1, metadata),
        evaluateEventProgress(playerId, "solo_stranger_matches", 1, metadata),
        evaluateEventProgress(playerId, "play_match_duo", 1, metadata),
        evaluateEventProgress(playerId, "play_match_trio", 1, metadata),
      ]);

      await Promise.all([
        safeAddToThread(thread, playerId).catch(() => {}),
        incrementMatchesPlayed(playerId).catch(() => {}),
        trackQueueLeaveTimestamp(playerId).catch(() => {}),
        incrementPlatformUsage(playerId, platform).catch(() => {}),
      ]);
    }
    await db.runAsync(
      `UPDATE players SET status = 'active' WHERE id IN (${players
        .map(() => "?")
        .join(",")})`,
      players
    );

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

    try {
      await trackNewUniquePartners(players);
    } catch (err) {
      logger.errorWrapper("trackNewUniquePartners failed in startMatch", err, {
        matchId,
        players,
      });
    }

    return { matchId, threadId: thread.id, players };
  } catch (error) {
    logger.errorWrapper("startMatch", error, { platform, players });
  }
}

module.exports = { startMatch };
