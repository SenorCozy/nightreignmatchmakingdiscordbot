const { Events } = require("discord.js");
const db = require("../../database");
const logger = require("../../logger");
const { v4: uuidv4 } = require("uuid");
const {
  incrementMentionStrike,
  getMentionStrikeCount,
} = require("../../utils/mentionStrikeManager");
const { evaluateEventProgress } = require("../../utils/eventUtils");
const {
  unlockStatThresholdAchievements,
  unlockAchievementIfNotEarned,
  messageAchievements,
} = require("../../utils/achievementHelpers");

const lastActivityCache = new Map(); // threadId -> timestamp
const THROTTLE_INTERVAL = 2 * 60 * 1000; // 2 minutes
const SUBMISSION_CHANNEL_ID = process.env.SUBMISSION_CHANNEL_ID;
const submissionCooldown = new Map(); // userId => timestamp
const SUBMISSION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

const MODERATOR_ROLE_IDS = [
  process.env.TICKET_HANDLER_ROLE,
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
  process.env.BOT_ROLE,
].filter(Boolean);

const MENTION_ABUSE_ROLE_ID = process.env.MENTION_ABUSE_ROLE_ID;

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    if (message.channel.id === SUBMISSION_CHANNEL_ID) {
      const playerId = message.author.id;
      const content = message.content || "";
      const attachment = message.attachments.first()?.url || null;
      const submissionId = uuidv4();
      const now = Date.now();

      const event = await db.getAsync(
        `
        SELECT * FROM events 
        WHERE active = 1 
          AND goal_type = 'manual_submission' 
          AND start_time <= ? AND end_time >= ?
        ORDER BY start_time DESC 
        LIMIT 1
      `,
        [now, now]
      );

      if (!event) {
        logger.warn(
          `Submission from ${playerId} ignored — no active submission event.`
        );
        return;
      }
      const existing = await db.getAsync(
        `
        SELECT status FROM event_submissions
        WHERE player_id = ? AND event_id = ?
        ORDER BY submitted_at DESC
        LIMIT 1
      `,
        [playerId, event.event_id]
      );

      let isDuplicate = 0;

      if (existing) {
        if (["pending", "approved"].includes(existing.status)) {
          await message.reply({
            content: `⛔ You already have a submission for this event that is still ${existing.status}. Please wait for it to be reviewed before submitting again.`,
            allowedMentions: { users: [playerId] },
          });
          return;
        } else {
          isDuplicate = 1;
        }
      }

      const lastSubmitTime = submissionCooldown.get(playerId) || 0;
      if (now - lastSubmitTime < SUBMISSION_COOLDOWN_MS) {
        await message.reply({
          content: `⏱️ You're submitting too quickly. Please wait a few minutes before trying again.`,
          allowedMentions: { users: [playerId] },
        });
        return;
      }
      submissionCooldown.set(playerId, now);
      const recentDuplicate = await db.getAsync(
        `
        SELECT 1 FROM event_submissions
        WHERE player_id = ? AND event_id = ? AND content = ? AND status = 'pending'
      `,
        [playerId, event.event_id, content]
      );

      if (recentDuplicate) {
        await message.reply({
          content: `⚠️ You've already submitted the same content for this event.`,
          allowedMentions: { users: [playerId] },
        });
        return;
      }

      await db.runAsync(
        `
  INSERT INTO event_submissions (
    submission_id, event_id, player_id, submitted_at,
    message_id, channel_id, content, attachment_url, is_duplicate
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
        [
          submissionId,
          event.event_id,
          playerId,
          now,
          message.id,
          message.channel.id,
          content,
          attachment,
          isDuplicate,
        ]
      );

      await db.runAsync(
        `INSERT INTO event_submission_participants (submission_id, player_id)
   VALUES (?, ?)`,
        [submissionId, playerId]
      );

      const {
        EmbedBuilder,
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle,
      } = require("discord.js");

      const embed = new EmbedBuilder()
        .setTitle("📬 New Event Submission")
        .setDescription(content || "*No text provided*")
        .setColor(0x3498db)
        .addFields([
          { name: "Event", value: event.name },
          { name: "User", value: `<@${playerId}> (${playerId})` },
          { name: "Submitted", value: `<t:${Math.floor(now / 1000)}:R>` },
        ])
        .setFooter({ text: `Submission ID: ${submissionId}` });

      if (attachment) embed.setImage(attachment);
      logger.info("Submission attachments:", [...message.attachments.values()]);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_submission_${submissionId}`)
          .setLabel("✅ Approve")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject_submission_${submissionId}`)
          .setLabel("❌ Reject")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`add_participant_${submissionId}`)
          .setLabel("➕ Add Participants")
          .setStyle(ButtonStyle.Primary)
      );

      await message.reply({ embeds: [embed], components: [row] });

      return; // prevent thread logic from running on this message
    }

    const thread = message.channel;
    if (!thread.isThread()) return;

    const threadId = thread.id;
    const now = Date.now();

    // ✅ Throttle lastActivity updates
    const lastUpdated = lastActivityCache.get(threadId) || 0;
    if (now - lastUpdated >= THROTTLE_INTERVAL) {
      db.run(
        `UPDATE channels SET lastActivity = ? WHERE threadId = ?`,
        [now, threadId],
        (err) => {
          if (err) {
            logger.errorWrapper("❌ Failed to update lastActivity", err, {
              threadId,
              threadName: thread.name,
            });
          } else {
            lastActivityCache.set(threadId, now);
            logger.info("📬 Updated lastActivity", {
              threadId,
              threadName: thread.name,
            });
          }
        }
      );
    }

    // ✅ Only proceed if thread is a tracked match
    let matchRow;
    try {
      matchRow = await new Promise((resolve, reject) => {
        db.get(
          `SELECT match_id FROM channels WHERE threadId = ?`,
          [threadId],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });
    } catch (err) {
      return logger.errorWrapper("❌ Failed to fetch match for thread", err, {
        threadId,
      });
    }
    if (!matchRow?.match_id) return;

    // ✅ Increment messages_sent for all users in match threads
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO player_statistics (id, messages_sent)
       VALUES (?, 1)
       ON CONFLICT(id) DO UPDATE SET messages_sent = messages_sent + 1`,
          [message.author.id],
          (err) => (err ? reject(err) : resolve())
        );
      });

      // 🎯 Trigger event progress check
      await evaluateEventProgress(message.author.id, "messages_sent", 1);
      // 🏆 Message Count Achievements
      await unlockStatThresholdAchievements(
        message.author.id,
        "messages_sent",
        messageAchievements
      );

      logger.debug("📈 Incremented messages_sent", {
        playerId: message.author.id,
        threadId,
      });
    } catch (err) {
      logger.errorWrapper("❌ Failed to increment messages_sent", err, {
        userId: message.author.id,
        threadId,
      });
    }

    // ✅ Ignore moderators
    let member;
    try {
      member = await thread.guild.members.fetch(message.author.id);
    } catch {
      return;
    }
    if (member.roles.cache.some((role) => MODERATOR_ROLE_IDS.includes(role.id)))
      return;

    const mentionedUsers = message.mentions.users;
    // 🏆 Achievement: Mentioned the bot in a match thread
    if (mentionedUsers.has(client.user.id)) {
      await unlockAchievementIfNotEarned(message.author.id, "bot_mention_1");
    }

    if (!mentionedUsers.size) return;

    // ✅ Fetch active match participants
    let activePlayerIds = [];
    try {
      activePlayerIds = await new Promise((resolve, reject) => {
        db.all(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [matchRow.match_id],
          (err, rows) =>
            err ? reject(err) : resolve(rows.map((r) => r.playerId))
        );
      });
    } catch (err) {
      return logger.errorWrapper(
        "❌ Failed to fetch active match players",
        err,
        { matchId: matchRow.match_id }
      );
    }

    // ✅ Remove unauthorized mentions and collect them
    const unauthorizedMentions = [];

    for (const user of mentionedUsers.values()) {
      const mentionedId = user.id;

      if (!activePlayerIds.includes(mentionedId)) {
        try {
          await thread.members.remove(mentionedId).catch(() => {});
          unauthorizedMentions.push(`<@${mentionedId}>`);
          logger.info("🚫 Removed unauthorized mention", {
            thread: thread.name,
            offender: message.author.tag,
            mentioned: mentionedId,
          });
        } catch (err) {
          logger.warn("⚠️ Failed to remove unauthorized mention", {
            thread: thread.name,
            mentionedId,
            error: err.message,
          });
        }
      }
    }

    // ✅ Send single warning message if any removals occurred
    if (unauthorizedMentions.length > 0) {
      const userId = message.author.id;

      // Track strikes per user
      const strikes = incrementMentionStrike(userId);

      const abuseRoleMention =
        strikes >= 3 && MENTION_ABUSE_ROLE_ID
          ? `<@&${MENTION_ABUSE_ROLE_ID}> `
          : "";

      await thread
        .send({
          content: `${abuseRoleMention}<@${userId}>: Threads are a moderated match space. Unauthorized users like ${unauthorizedMentions.join(
            ", "
          )} have been removed.\nPlease ping a ticket handler or moderator to correctly add users.`,
          allowedMentions: {
            users: [userId],
            roles: abuseRoleMention ? [MENTION_ABUSE_ROLE_ID] : [],
          },
        })
        .catch((err) => {
          logger.warn("⚠️ Failed to send unauthorized mention warning", {
            threadId,
            error: err.message,
          });
        });
      try {
        await unlockAchievementIfNotEarned(userId, "mention_blocked");
      } catch (err) {
        logger.errorWrapper(
          "Failed to unlock 'mention_blocked' achievement",
          err,
          {
            userId,
            threadId,
          }
        );
      }

      if (strikes === 3 && MENTION_ABUSE_ROLE_ID) {
        logger.warn("🚨 User hit mention abuse threshold", {
          userId,
          threadId,
          threadName: thread.name,
        });
      }
    }
  },
};
