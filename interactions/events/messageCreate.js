// events/messageCreate.js
const { Events, PermissionsBitField } = require("discord.js");
const db = require("../../database");

const lastActivityCache = new Map(); // threadId -> timestamp
const THROTTLE_INTERVAL = 2 * 60 * 1000; // 2 minutes

const MODERATOR_ROLE_IDS = [
  process.env.TICKET_HANDLER_ROLE,
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
  process.env.BOT_ROLE,
].filter(Boolean);

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    const thread = message.channel;
    if (!thread.isThread()) return;

    const threadId = thread.id;
    const now = Date.now();

    // ✅ Update lastActivity with throttling
    const lastUpdated = lastActivityCache.get(threadId) || 0;
    if (now - lastUpdated >= THROTTLE_INTERVAL) {
      db.run(
        `UPDATE channels SET lastActivity = ? WHERE threadId = ?`,
        [now, threadId],
        (err) => {
          if (err) {
            console.error(
              `❌ Failed to update lastActivity for thread ${thread.name}:`,
              err.message
            );
          } else {
            lastActivityCache.set(threadId, now);
            console.log(`📬 Updated lastActivity for thread: ${thread.name}`);
          }
        }
      );
    }

    // ✅ Only proceed if this is a known match thread
    const matchRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT match_id FROM channels WHERE threadId = ?`,
        [threadId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });
    if (!matchRow?.match_id) return; // Not a tracked match thread

    // ✅ Ignore if author has moderator roles
    const member = await thread.guild.members
      .fetch(message.author.id)
      .catch(() => null);
    if (
      !member ||
      member.roles.cache.some((role) => MODERATOR_ROLE_IDS.includes(role.id))
    )
      return;

    // ✅ Extract mentioned users
    const mentionedUsers = message.mentions.users;
    if (!mentionedUsers.size) return;

    // ✅ Get list of active players in this match
    const activePlayerIds = await new Promise((resolve, reject) => {
      db.all(
        `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
        [matchRow.match_id],
        (err, rows) =>
          err ? reject(err) : resolve(rows.map((r) => r.playerId))
      );
    });

    for (const user of mentionedUsers.values()) {
      const mentionedId = user.id;

      // ✅ If user is not active in this match, remove them and warn
      if (!activePlayerIds.includes(mentionedId)) {
        try {
          await thread.members.remove(mentionedId).catch(() => {});
          await thread.send({
            content: `<@${message.author.id}>: Threads are a moderated match space and no unauthorized users can be added.\nPlease ping a ticket handler or moderator to correctly add users.`,
            allowedMentions: { users: [message.author.id] },
          });
          console.log(
            `🚫 Removed unauthorized mention: ${mentionedId} from ${thread.name}`
          );
        } catch (err) {
          console.warn(
            `⚠️ Failed to remove mentioned user ${mentionedId}:`,
            err.message
          );
        }
      }
    }
  },
};
