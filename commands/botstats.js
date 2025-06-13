const { SlashCommandBuilder } = require("discord.js");
const {
  fetchBotStatistics,
  fetchTopPlayers,
  fetchAverageQueueTimes,
  getAverageMatchTime,
  fetchTopMvpRecipients,
} = require("../utils/botstatshelper");
const db = require("../database");
const logger = require("../logger");

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("botstats")
    .setDescription("Display matchmaking usage statistics and top players"),

  async execute(interaction) {
    try {
      const stats = await fetchBotStatistics();
      const statMap = Object.fromEntries(
        stats.map((row) => [row.stat_key, Number(row.stat_value)])
      );

      const [topPlayers, avgQueueTimes] = await Promise.all([
        fetchTopPlayers(20),
        fetchAverageQueueTimes(),
      ]);

      const failedReadyChecks = await db
        .getAsync(
          `SELECT SUM(failed_ready_checks) AS total FROM player_statistics`
        )
        .then((row) => row?.total || 0)
        .catch((err) => {
          logger.errorWrapper("botstats_failed_ready_check_fetch", err);
          return 0;
        });

      const globalAvgMatchLength =
        statMap.total_match_time && statMap.total_matches_created
          ? (
              statMap.total_match_time /
              statMap.total_matches_created /
              1000
            ).toFixed(2)
          : "N/A";

      const longestMatchSeconds = statMap.longest_match_time
        ? (statMap.longest_match_time / 1000).toFixed(2)
        : "N/A";

      const platforms = ["pc", "xbox", "playstation"];
      const platformQueueTimes = platforms.reduce((acc, platform) => {
        acc[platform] = {
          solo:
            (avgQueueTimes.find(
              (q) => q.platform === platform && q.queue_type === "solo"
            )?.avg_time || 0) / 1000,
          duo:
            (avgQueueTimes.find(
              (q) => q.platform === platform && q.queue_type === "duo"
            )?.avg_time || 0) / 1000,
        };
        return acc;
      }, {});

      const platformStatsBlock = await Promise.all(
        platforms.map(async (platform) => {
          const longest = statMap[`longest_match_time_${platform}`] || 0;
          const total = statMap[`total_match_time_${platform}`] || 0;
          const average = await getAverageMatchTime(platform);

          return `  - **${platform.toUpperCase()}**
    - Matches: ${statMap[`matches_created_${platform}`] || 0}
    - Avg Queue Time: Solo ${platformQueueTimes[platform].solo.toFixed(
      2
    )}s / Duo ${platformQueueTimes[platform].duo.toFixed(2)}s
    - Avg Match Time: ${(average / 1000).toFixed(2)}s
    - Longest Match: ${(longest / 1000).toFixed(2)}s
    - Total Match Time: ${(total / 1000 / 60).toFixed(2)} minutes`;
        })
      );

      const topPlayerBlock = topPlayers.length
        ? topPlayers
            .map(
              (p, i) =>
                `${i + 1}. <@${p.id}> — ${p.matches_played} matches ` +
                `(Solo: ${p.queue_entries_solo || 0}, Duo: ${
                  p.queue_entries_duo || 0
                })`
            )
            .join("\n")
        : "No top players found.";

      const topMvpRecipients = await fetchTopMvpRecipients(10);
      const mvpBlock = topMvpRecipients.length
        ? topMvpRecipients
            .map((p, i) => `${i + 1}. <@${p.id}> — 🏅 ${p.total} MVP awards`)
            .join("\n")
        : "No MVP data available.";

      const vcBlock = `**🎧 VC Preference Stats**
- VC Respected: ${statMap.vc_respected || 0}
- VC Not Respected: ${statMap.vc_not_respected || 0}
- VC Pref Yes: ${statMap.vc_pref_yes || 0}
- VC Pref No: ${statMap.vc_pref_no || 0}`;

      const nightlordStats = Object.entries(statMap)
        .filter(([key]) => key.startsWith("nl_"))
        .map(([key, value]) => {
          const bossKey = key.replace("nl_", "");
          const label = NIGHTLORD_LABELS[bossKey] || bossKey;
          return `- ${label}: ${value}`;
        });

      const nightlordBlock = nightlordStats.length
        ? `**👹 Nightlord Selections**\n${nightlordStats.join("\n")}`
        : "**👹 Nightlord Selections**\nNo data recorded yet.";

      const content = `
**📊 Bot Statistics**
- **Unique Users:** ${statMap.unique_users || 0}
- - **Total Queue Entries:** ${statMap.total_queue_entries || 0}
  - Solo: ${statMap.queue_entries_solo || 0}
  - Duo: ${statMap.queue_entries_duo || 0}
  - Trio: ${statMap.queue_entries_trio || 0}
- **Total Matches Created:** ${statMap.total_matches_created || 0}
- **Failed Ready Checks:** ${failedReadyChecks}
- **Average Match Length (Global):** ${globalAvgMatchLength} seconds
- **Longest Match Duration (Global):** ${longestMatchSeconds} seconds

${vcBlock}

${nightlordBlock}

**📈 Per-Platform Stats**
${platformStatsBlock.join("\n")}

**🏆 Top 20 Players**
${topPlayerBlock}

**💰 Top 10 MVP Recipients**
${mvpBlock}
`;

      logger.info("✅ Bot statistics displayed successfully.");
      return interaction.reply({ content, flags: 64 });
    } catch (error) {
      logger.errorWrapper("❌ Error in /botstats command", error);
      return interaction.reply({
        content: "❌ An error occurred while fetching bot statistics.",
        flags: 64,
      });
    }
  },
};
