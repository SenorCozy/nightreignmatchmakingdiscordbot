const { SlashCommandBuilder } = require("discord.js");
const db = require("../database");
const { hasModRole } = require("../utils/permissions");
const logger = require("../logger"); // optional if using centralized logging
const util = require("util");

// Promisify db functions if not already done
db.allAsync = db.allAsync || util.promisify(db.all).bind(db);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("flagged")
    .setDescription(
      "List players with frequent match issues (leave, kick, fail)"
    ),

  async execute(interaction) {
    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "🚫 You do not have permission to use this command.",
        flags: 64,
      });
    }

    try {
      const flagged = await db.allAsync(`
        SELECT playerId,
               COUNT(CASE WHEN final_status = 'left' THEN 1 END) AS leaves,
               COUNT(CASE WHEN final_status = 'kicked' THEN 1 END) AS kicks,
               COUNT(CASE WHEN final_status = 'failed_ready_check' THEN 1 END) AS failed,
               MAX(timestamp) AS lastSeen,
               COUNT(DISTINCT match_id) AS matchCount
        FROM match_events
        WHERE final_status IS NOT NULL
        GROUP BY playerId
        HAVING leaves >= 2 OR kicks >= 2 OR failed >= 2
        ORDER BY (leaves + kicks + failed) DESC
      `);

      if (!flagged.length) {
        return interaction.reply({
          content: "✅ No players are currently flagged.",
          flags: 64,
        });
      }

      const report = flagged
        .map((row, i) => {
          const time = row.lastSeen
            ? `<t:${Math.floor(row.lastSeen / 1000)}:R>`
            : "(unknown)";
          return `${i + 1}. <@${row.playerId}> — Leaves: ${
            row.leaves
          }, Kicks: ${row.kicks}, Failed RCs: ${row.failed}, Matches: ${
            row.matchCount
          }, Last Seen: ${time}`;
        })
        .join("\n");

      return interaction.reply({
        content: `🚨 **Flagged Players (Persistent Issues):**\n\n${report}`,
        flags: 64,
      });
    } catch (err) {
      logger?.errorWrapper?.("flaggedCommand", err); // optional if using logger
      console.error("❌ Error in /flagged:", err);
      return interaction.reply({
        content: "❌ Failed to fetch flagged players.",
        flags: 64,
      });
    }
  },
};
