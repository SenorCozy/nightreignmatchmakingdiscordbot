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
  checkFormationDiversity,
  checkPlatformDiversity,
} = require("../../utils/achievementHelpers");

function generateMatchPassword() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function startMatch(
  client,
  platform,
  players,
  formationType = "unknown"
) {
  if (!players?.length) {
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

    if (activeThreads >= 1000) {
      logger.warn("Thread limit (1000) reached. Match aborted.");
      await db.run(
        `UPDATE players SET duoPartner = NULL WHERE id IN (${players
          .map(() => "?")
          .join(",")})`,
        players
      );
      return { error: "Thread limit reached — match aborted.", players };
    }

    await db.runAsync(
      `UPDATE players SET status = 'queued' WHERE id IN (${players
        .map(() => "?")
        .join(",")})`,
      players
    );

    const platformChannel = await getOrCreatePlatformChannel(guild, platform);

    const existingMatch = await db.getAsync(
      `SELECT threadId FROM match_players 
       WHERE playerId IN (${players.map(() => "?").join(",")}) 
       AND status = 'active' LIMIT 1`,
      players
    );

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
    const timestamp = Date.now();
    logger.debug(`📌 Tracked initialPlayers for ${thread.id}:`, players);

    await db.runAsync(
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
        players.join(","),
      ]
    );

    await incrementBotStatistic("total_matches_created", 1);
    await incrementBotStatistic(`matches_created_${platform}`, 1);

    await db.runAsync(
      `INSERT OR REPLACE INTO channels 
       (id, threadId, voiceChannelId, match_id, playerIds, lastActivity, lastReadyCheck)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [thread.id, thread.id, null, matchId, players.join(","), timestamp, 0]
    );

    for (const playerId of players) {
      await db.runAsync(
        `INSERT INTO match_players (match_id, threadId, playerId, status, joined_at)
         VALUES (?, ?, ?, 'active', ?)
         ON CONFLICT(match_id, playerId) DO UPDATE SET status = 'active', joined_at = ?`,
        [matchId, thread.id, playerId, timestamp, timestamp]
      );

      await db.runAsync(
        `INSERT INTO match_events 
         (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
         VALUES (?, ?, ?, 'join', ?, ?, 'active')`,
        [matchId, thread.id, playerId, timestamp, "startMatch"]
      );

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
      }

      const queueRow = await db.getAsync(
        `SELECT duoPartner, trioPartner1, trioPartner2 
         FROM queue_history
         WHERE playerId = ? AND queue_left_at IS NULL
         ORDER BY queue_entered_at DESC LIMIT 1`,
        [playerId]
      );

      let queueFormationType = "solo";
      if (queueRow?.trioPartner1 && queueRow?.trioPartner2)
        queueFormationType = "trio";
      else if (queueRow?.duoPartner) queueFormationType = "duo";

      await db.runAsync(
        `INSERT OR IGNORE INTO formation_progress (player_id, formation_type) VALUES (?, ?)`,
        [playerId, queueFormationType]
      );

      await safeAddToThread(thread, playerId).catch(() => {});
    }

    await db.runAsync(
      `UPDATE players SET status = 'active' WHERE id IN (${players
        .map(() => "?")
        .join(",")})`,
      players
    );

    const password = generateMatchPassword();

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

    const instructions = [
      `🎮 **Match started!**`,
      `**Players:** ${players.map((id) => `<@${id}>`).join(", ")}`,
      ``,
      `__**🎛️ Match Controls**__`,
      `• 🎤 **Create Voice Channel** — Instantly creates a private VC for your team.`,
      `• ✅ **Ready Check** — Starts a 3-minute timer. Unready players are kicked and replaced. You can also use \`/ready\`.`,
      `• 🚪 **Leave Match** — Leave the match. Teammates can replace you via \`/search\`.`,
      `• ⛔ **End Match** — Calls to end the match. Requires one other match player to confirm. You can also use \`/end\`.`,
      ``,
      `__**📌 Tips & Info**__`,
      `•  This system is **in beta** — expect bugs! **Mention @eldentickethandlers for support.**`,
      `•  Use \`/search\` to replace players who leave.`,
      `•  Use \`/status thread\` to view match stats and participants.`,
      ``,
      `• 🔐 Suggested Match Password: \`${password}\` *(case-sensitive)*`,
      `\u200B`, // <-- invisible padding line to ensure space before buttons
    ];

    await thread.send({
      content: instructions.join("\n"),
      components: [buttons],
    });

    // ⏱ Defer heavy achievement + event logic
    setImmediate(async () => {
      try {
        for (const playerId of players) {
          incrementMatchesPlayed(playerId).catch(() => {});
          trackQueueLeaveTimestamp(playerId).catch(() => {});
        }
        await checkRepeatPartnerAchievements(matchId, formationType, players);
        await trackNewUniquePartners(players);
      } catch (err) {
        logger.errorWrapper(
          "Deferred match-level achievement tracking failed",
          err,
          {
            matchId,
            players,
          }
        );
      }

      for (const playerId of players) {
        try {
          const partnerIds = players.filter((id) => id !== playerId);
          const metadata = {
            formationType,
            platform,
            partnerIds,
            queueType: formationType,
          };

          const newUniquePartners = await checkNewUniquePartners(
            playerId,
            players
          );
          await Promise.all([
            incrementPlatformUsage(playerId, platform).catch(() => {}),
            checkFormationDiversity(playerId).catch(() => {}),
            checkPlatformDiversity(playerId).catch(() => {}), // if you add this too
          ]);
          if (newUniquePartners > 0)
            metadata.newUniquePartners = newUniquePartners;

          if (formationType === "duo" && partnerIds.length === 1) {
            if (await checkRepeatDuo(playerId, partnerIds[0]))
              metadata.repeatDuo = true;
          }

          if (formationType === "trio" && partnerIds.length === 2) {
            if (await checkRepeatTrio(playerId, partnerIds))
              metadata.repeatTrio = true;
          }

          await Promise.all([
            evaluateEventProgress(playerId, "matches_played", 1, metadata),
            evaluateEventProgress(playerId, "play_match", 1, metadata),
            evaluateEventProgress(playerId, "play_with_user", 1, metadata),
            evaluateEventProgress(playerId, "unique_partners", 1, metadata),
            evaluateEventProgress(playerId, "repeat_duo", 1, metadata),
            evaluateEventProgress(playerId, "repeat_trio", 1, metadata),
            evaluateEventProgress(
              playerId,
              "solo_stranger_matches",
              1,
              metadata
            ),
            evaluateEventProgress(playerId, "play_match_duo", 1, metadata),
            evaluateEventProgress(playerId, "play_match_trio", 1, metadata),
          ]);
        } catch (err) {
          logger.errorWrapper(
            "Deferred event/achievement tracking per player failed",
            err,
            {
              matchId,
              playerId,
            }
          );
        }
      }
    });

    return { matchId, threadId: thread.id, players };
  } catch (error) {
    logger.errorWrapper("startMatch", error, { platform, players });
  }
}

module.exports = { startMatch };
