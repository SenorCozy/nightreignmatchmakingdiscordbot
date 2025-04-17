const { SlashCommandBuilder } = require("discord.js");
const {
  fetchPlayerStatistics,
  fetchMostCommonDuoPartner,
  trackFailedReadyCheck,
  trackLongestMatchTime,
} = require("../utils/playerstatshelper");
const db = require("../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("statistics")
    .setDescription("View your own or another player's match/queue stats")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to view stats for")
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      const targetUser =
        interaction.options.getUser("user") || interaction.user;
      const playerId = targetUser.id;

      const stats = await fetchPlayerStatistics(playerId);
      if (!stats) {
        return interaction.reply({
          content: `ℹ️ <@${playerId}> has no recorded statistics.`,
          flags: 64,
        });
      }

      const mostCommonDuo = await fetchMostCommonDuoPartner(playerId);
      const hoursInVC = (stats.vc_time / 3600).toFixed(2);

      const longestMatch = stats.longest_match_time
        ? `${Math.round(stats.longest_match_time / 60)} min`
        : "N/A";

      const duoPartnerInfo = mostCommonDuo
        ? `<@${mostCommonDuo.partner_id}> (${mostCommonDuo.count} matches)`
        : "N/A";

      const response = `
        **Statistics for ${targetUser.username}:**
        - **Queue Entries (Total):** ${stats.queue_entries || 0}
          - Solo: ${stats.queue_entries_solo || 0}
          - Duo: ${stats.queue_entries_duo || 0}
        - **Matches Played:** ${stats.matches_played || 0}
        - **Top Platform:** ${stats.top_platform || "N/A"}
        - **Hours in VC:** ${hoursInVC}
        - **Messages Sent:** ${stats.messages_sent || 0}
        - **Most Common Duo Partner:** ${duoPartnerInfo}
        - **Failed Ready Checks:** ${stats.failed_ready_checks || 0}
        - **Longest Match Duration:** ${longestMatch}
        `;

      return interaction.reply({ content: response, flags: 64 });
    } catch (error) {
      logger.error("❌ Error in /statistics:", error);
      return interaction.reply({
        content: "❌ An error occurred while retrieving statistics.",
        flags: 64,
      });
    }
  },
};
