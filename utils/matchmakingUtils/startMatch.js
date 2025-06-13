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
  formationType = "unknown",
  overlapInfo = null
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

    function sanitizeUsername(name) {
      // Lowercase, keep a-z, 0-9, ., _
      let safe = name.toLowerCase().replace(/[^a-z0-9._]/g, "");

      // Replace double dots with single
      while (safe.includes("..")) {
        safe = safe.replace(/\.\.+/g, ".");
      }

      // Enforce length
      return safe.slice(0, 32);
    }

    function buildChannelName(prefix, usernames, maxLength = 100) {
      const base = `${prefix}-${usernames.join("-")}`;
      return base.length <= maxLength
        ? base
        : `${prefix}-${usernames.slice(0, 3).join("-")}-etc`;
    }

    // Fetch usernames
    const usernames = await Promise.all(
      players.map(async (id) => {
        try {
          const user = await client.users.fetch(id);
          return sanitizeUsername(user.username);
        } catch {
          return "unknown";
        }
      })
    );

    // Fallback if all usernames are broken
    const nameBase = usernames.filter(Boolean).length
      ? buildChannelName("match", usernames)
      : `match-${matchId.slice(0, 8)}`;

    // Create thread
    const thread = await platformChannel.threads.create({
      name: nameBase,
      autoArchiveDuration: 1440,
      type: ChannelType.GuildPrivateThread,
      invitable: false,
      reason: `Creating match thread for ${usernames.join(", ")}`,
    });

    if (!thread) {
      logger.error("Failed to create match thread.");
      return;
    }

    const matchId = uuidv4();
    const timestamp = Date.now();
    logger.debug(`📌 Tracked initialPlayers for ${thread.id}:`, players);

    const now = Date.now();

    await db.runAsync(
      `INSERT INTO matches (match_id, thread_id, platform, created_by, created_at, match_start_time, formation_type, initial_player_ids, shared_nightlords, vc_match)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        matchId,
        thread.id,
        platform,
        players[0],
        now,
        now, // match_start_time
        formationType,
        JSON.stringify(players),
        JSON.stringify(overlapInfo.sharedBosses || []),
        overlapInfo.vcMatch ? 1 : 0,
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
      `🎮 **Match Started!**`,
      `**Players:** ${players.map((id) => `<@${id}>`).join(", ")}`,
      ``, // spacing
    ];

    // 🧠 Nightlord preference (duos/solos only)
    if (formationType !== "trio" && overlapInfo?.sharedBosses?.length) {
      const bossNames = overlapInfo.sharedBosses
        .map((val) => NIGHTLORD_LABELS[val] || val)
        .join(", ");

      instructions.push(
        `🧠 **Shared Nightlord Preferences**`,
        `You all share **${overlapInfo.overlapCount}** Nightlord(s):`,
        `• ${bossNames}`,
        ``
      );
    }

    // 🎧 VC preference (duos/solos only)
    if (formationType !== "trio") {
      if (overlapInfo?.vcMatch === true) {
        instructions.push(`🔊 **All players agreed to use voice chat.**`);
        await incrementBotStatistic("vc_respected");
      } else if (overlapInfo?.vcMatch === false) {
        instructions.push(
          `🔇 **Voice chat preference was not fully respected.**`
        );
        await incrementBotStatistic("vc_not_respected");
      }
      instructions.push(``); // spacing
    }

    // 🎛️ Controls
    instructions.push(
      `🎛️ **Match Controls**`,
      `• ✅ **Ready Check** — Starts a 3-minute ready check timer, confirm ready with button or Use \`/ready\`.`,
      `• ⛔ **End Match** — Starts a vote to end the match. Use \`/end\`.`,
      ``
    );

    // 💡 Tips & info
    instructions.push(
      `📌 **Tips & Info**`,
      `• This system is **in beta** expect bugs — mention @eldentickethandlers for help.`,
      `• Use \`/search\` to replace players who leave.`,
      `• Use \`/status thread\` to view stats.`,
      `• 🏆 Use \`/mvp\` to award players for clutch plays.`,
      `• MVP points (currency) can be spent in the \`/shop\` for new roles.`,
      ``,
      `• 📚 Read the wiki guide to improve your runs:`,
      `<https://eldenringnightreign.wiki.fextralife.com/Expeditions>`,
      ``
    );

    // 🔐 Password
    instructions.push(
      `🔐 **Suggested Match Password:** \`${password}\` *(case-sensitive)*`,
      `\u200B` // padding
    );

    // Send to thread
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
