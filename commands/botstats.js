const { SlashCommandBuilder } = require("discord.js");
const {
  fetchBotStatistics,
  fetchTopPlayers,
  fetchAverageQueueTimes,
} = require("../utils/botstatshelper");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("botstats")
    .setDescription("Display matchmaking usage statistics and top players"),

  async execute(interaction) {
    try {
      const stats = await fetchBotStatistics();
      if (!stats.length) {
        return interaction.reply({
          content: "ℹ️ No bot statistics available.",
          flags: 64,
        });
      }

      const topPlayers = await fetchTopPlayers(20);
      const avgQueueTimes = await fetchAverageQueueTimes();

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

      const statMap = Object.fromEntries(
        stats.map((row) => [row.stat_key, row.stat_value])
      );

      const avgMatchLength = statMap.total_match_time
        ? (
            statMap.total_match_time /
            statMap.total_matches_created /
            1000
          ).toFixed(2)
        : "N/A";

      const platformStats = `
- **Matches Per Platform:**
  - PC: ${statMap.matches_created_pc || 0}
  - Xbox: ${statMap.matches_created_xbox || 0}
  - PlayStation: ${statMap.matches_created_playstation || 0}
- **Average Queue Times by Platform:**`;

      const queueTimeStats = Object.entries(platformQueueTimes)
        .map(
          ([platform, times]) =>
            `  - **${platform.toUpperCase()}**:\n` +
            `    - Solo: ${times.solo.toFixed(2)} seconds\n` +
            `    - Duo: ${times.duo.toFixed(2)} seconds`
        )
        .join("\n");

      const topPlayerStats =
        topPlayers.length > 0
          ? topPlayers
              .map(
                (player, index) =>
                  `${index + 1}. <@${player.id}> — ${
                    player.matches_played
                  } matches ` +
                  `(Solo: ${player.queue_entries_solo || 0}, Duo: ${
                    player.queue_entries_duo || 0
                  })`
              )
              .join("\n")
          : "No top players found.";

      const response = `
**📊 Bot Statistics**
- **Unique Users:** ${statMap.unique_users || 0}
- **Total Queue Entries:** ${statMap.total_queue_entries || 0}
  - Solo: ${statMap.queue_entries_solo || 0}
  - Duo: ${statMap.queue_entries_duo || 0}
- **Total Matches Created:** ${statMap.total_matches_created || 0}
- **Average Match Length:** ${avgMatchLength} seconds
- **Longest Match Length:** ${(statMap.longest_match_time / 1000 || 0).toFixed(
        2
      )} seconds

${platformStats}
${queueTimeStats}

**🏆 Top 20 Players**
${topPlayerStats}
`;

      return interaction.reply({
        content: response,
        flags: 64,
      });
    } catch (error) {
      logger.error("❌ Error in /botstats:", error);
      return interaction.reply({
        content: "❌ An error occurred while fetching bot statistics.",
        flags: 64,
      });
    }
  },
};
