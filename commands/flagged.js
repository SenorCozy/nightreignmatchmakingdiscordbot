const { SlashCommandBuilder } = require("discord.js");
const db = require("../database");
const { hasModRole } = require("../utils/permissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("flagged")
    .setDescription(
      "List players with frequent match issues (leave, kick, fail)"
    ),

  async execute(interaction) {
    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "\u274c You do not have permission to use this command.",
        flags: 64,
      });
    }

    try {
      const flagged = await new Promise((resolve, reject) => {
        db.all(
          `
          SELECT playerId,
                 COUNT(CASE WHEN final_status = 'left' THEN 1 END) AS leaves,
                 COUNT(CASE WHEN final_status = 'kicked' THEN 1 END) AS kicks,
                 COUNT(CASE WHEN final_status = 'failed_ready_check' THEN 1 END) AS failed,
                 MAX(timestamp) as lastSeen,
                 COUNT(DISTINCT match_id) as matchCount
          FROM match_events
          WHERE final_status IS NOT NULL
          GROUP BY playerId
          HAVING leaves >= 2 OR kicks >= 2 OR failed >= 2
          ORDER BY (leaves + kicks + failed) DESC
        `,
          [],
          (err, rows) => (err ? reject(err) : resolve(rows))
        );
      });

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
        content: `\ud83d\udea8 **Flagged Players (Persistent Issues):**\n\n${report}`,
        flags: 64,
      });
    } catch (err) {
      console.error("\u274c Error in /flagged:", err);
      return interaction.reply({
        content: "\u274c Failed to fetch flagged players.",
        flags: 64,
      });
    }
  },
};
