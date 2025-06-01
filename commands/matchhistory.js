const { SlashCommandBuilder } = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const { hasModRole } = require("../utils/permissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("matchhistory")
    .setDescription("View detailed match/mod history for a player")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Target player").setRequired(true)
    ),

  async execute(interaction) {
    const member = interaction.options.getUser("user");
    const playerId = member.id;

    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "❌ You do not have permission to use this command.",
        flags: 64,
      });
    }

    try {
      const matchCount = await db.getAsync(
        `SELECT COUNT(DISTINCT match_id) as count FROM match_events WHERE playerId = ?`,
        [playerId]
      );

      const finalStatusCounts = await db.allAsync(
        `SELECT final_status, COUNT(*) as count 
         FROM match_events 
         WHERE playerId = ? AND final_status IS NOT NULL
         GROUP BY final_status`,
        [playerId]
      );

      const recentEvents = await db.allAsync(
        `SELECT eventType, threadId, timestamp, reason, final_status 
         FROM match_events 
         WHERE playerId = ? 
         ORDER BY timestamp DESC 
         LIMIT 5`,
        [playerId]
      );

      const transcripts = await db.allAsync(
        `SELECT id, thread_id, closed_at 
         FROM transcripts 
         WHERE player_ids LIKE ? 
         ORDER BY closed_at DESC 
         LIMIT 3`,
        [`%${playerId}%`]
      );

      const isCurrentlyInMatch = await db.getAsync(
        `SELECT threadId FROM match_players 
         WHERE playerId = ? AND status = 'active'`,
        [playerId]
      );

      const redFlags = {
        left: 0,
        kicked: 0,
        failed_ready_check: 0,
      };
      for (const row of finalStatusCounts) {
        const status = row.final_status;
        if (redFlags[status] !== undefined) {
          redFlags[status] = row.count;
        }
      }

      let output = `📄 **Match History for <@${playerId}>**\n`;
      output += `• **Matches Played:** ${matchCount?.count ?? 0}\n`;

      if (isCurrentlyInMatch?.threadId) {
        output += `• 🟡 **Currently in active match:** <#${isCurrentlyInMatch.threadId}>\n`;
      }

      output += `\n🚩 **Moderation Flags:**\n`;
      output += `   - Leaves: ${redFlags.left}\n`;
      output += `   - Kicks: ${redFlags.kicked}\n`;
      output += `   - Failed Ready Checks: ${redFlags.failed_ready_check}\n`;

      if (finalStatusCounts.length > 0) {
        output += `\n📊 **Final Status Breakdown:**\n`;
        for (const row of finalStatusCounts) {
          output += `   - ${row.final_status || "unknown"}: ${row.count}\n`;
        }
      }

      if (recentEvents.length > 0) {
        output += `\n🕒 **Recent Events:**\n`;
        for (const row of recentEvents) {
          const time = `<t:${Math.floor(row.timestamp / 1000)}:R>`;
          const threadMention = row.threadId
            ? `<#${row.threadId}>`
            : "(unknown)";
          output += `• **${row.eventType}** in ${threadMention} — ${time}\n`;
          if (row.reason) output += `   ↳ _${row.reason}_\n`;
          if (
            row.final_status &&
            !["active", "null"].includes(row.final_status)
          ) {
            output += `   🌟 Final Status: \`${row.final_status}\`\n`;
          }
        }
      }

      if (transcripts.length > 0) {
        output += `\n📜 **Related Transcripts:**\n`;
        for (const t of transcripts) {
          const time = `<t:${Math.floor(t.closed_at / 1000)}:R>`;
          const link = `${process.env.TRANSCRIPT_BASE_URL}/${t.id}`;
          output += `• [View Transcript](${link}) in <#${t.thread_id}> — ${time}\n`;
        }
      }

      return interaction.reply({ content: output, flags: 64 });
    } catch (err) {
      logger.errorWrapper("❌ Error in /matchhistory", err, {
        targetId: interaction.options.getUser("user")?.id,
        invokedBy: interaction.user.tag,
      });
      return interaction.reply({
        content: "❌ Failed to retrieve match history.",
        flags: 64,
      });
    }
  },
};
