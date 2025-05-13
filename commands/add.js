const { SlashCommandBuilder } = require("discord.js");
const { hasModRole } = require("../utils/permissions");
const db = require("../database");
const {
  incrementMatchesPlayed,
  trackQueueLeaveTimestamp,
} = require("../utils/playerstatshelper");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add a user to the current match thread and voice channel")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user to add").setRequired(true)
    ),

  async execute(interaction) {
    const thread = interaction.channel;
    const member = interaction.options.getUser("user");
    const playerId = member.id;

    if (!thread?.isThread()) {
      return interaction.reply({
        content: "❌ You must run this command inside a match thread.",
        flags: 64,
      });
    }

    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "🚫 You do not have permission to use this command.",
        flags: 64,
      });
    }

    try {
      const now = Date.now();

      // ✅ Check if blacklisted
      const isBlacklisted = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM blacklist WHERE id = ?`,
          [playerId],
          (err, row) => (err ? reject(err) : resolve(!!row))
        );
      });

      if (isBlacklisted) {
        return interaction.reply({
          content: `🚫 <@${playerId}> is blacklisted and cannot be added to a match.`,
          flags: 64,
        });
      }

      // ✅ Fetch match info
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT match_id, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!match?.match_id) {
        return interaction.reply({
          content: "❌ This thread is not linked to an active match.",
          flags: 64,
        });
      }

      const { match_id, voiceChannelId } = match;

      // ✅ Check if already in match as active
      const existing = await new Promise((resolve, reject) => {
        db.get(
          `SELECT status FROM match_players WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (existing?.status === "active") {
        return interaction.reply({
          content: `⚠️ <@${playerId}> is already part of this match.`,
          flags: 64,
        });
      }

      // ✅ Upsert into match_players
      await db.run(
        `INSERT INTO match_players (match_id, threadId, playerId, status, joined_at)
         VALUES (?, ?, ?, 'active', ?)
         ON CONFLICT(match_id, playerId) DO UPDATE SET status = 'active', joined_at = excluded.joined_at`,
        [match_id, thread.id, playerId, now]
      );

      // ✅ Insert match_event for auditing
      await db.run(
        `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
         VALUES (?, ?, ?, 'join', ?, ?, 'active')`,
        [match_id, thread.id, playerId, now, "manually added by mod"]
      );

      // ✅ Update statistics
      await db.run(`INSERT OR IGNORE INTO player_statistics (id) VALUES (?)`, [
        playerId,
      ]);
      await incrementMatchesPlayed(playerId);
      await trackQueueLeaveTimestamp(playerId);

      // ✅ Add to thread and permissions
      try {
        await thread.members.add(playerId);
      } catch (err) {
        console.warn(`⚠️ Could not update thread perms:`, err.message);
      }

      // ✅ Voice channel perms
      if (voiceChannelId) {
        const vc = thread.guild.channels.cache.get(voiceChannelId);
        if (vc) {
          try {
            await vc.permissionOverwrites
              .edit(playerId, {
                ViewChannel: true,
                Connect: true,
                Speak: true,
              })
              .catch(() => {});
          } catch (err) {
            console.warn(`⚠️ Could not update VC perms:`, err.message);
          }
        } else {
          console.warn(`⚠️ VC not found for ID: ${voiceChannelId}`);
        }
      }

      return interaction.reply({
        content: `✅ <@${playerId}> has been added to the match.`,
        flags: 64,
      });
    } catch (error) {
      console.error("❌ Error in /add command:", error);
      return interaction.reply({
        content: "❌ An error occurred while adding the user.",
        flags: 64,
      });
    }
  },
};
