const { SlashCommandBuilder } = require("discord.js");
const {
  fetchPlayerStatistics,
  fetchMostCommonDuoPartner,
  getTopPlatformForPlayer,
  getMvpStatsForPlayer,
} = require("../utils/playerstatshelper");
const logger = require("../logger");
const db = require("../database");
const { getMatchCompletionPoints } = require("../utils/rewardUtils");

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
    const targetUser = interaction.options.getUser("user") || interaction.user;
    const playerId = targetUser.id;

    try {
      const stats = await fetchPlayerStatistics(playerId);
      if (!stats) {
        return interaction.reply({
          content: `ℹ️ <@${playerId}> has no recorded statistics.`,
          flags: 64,
        });
      }

      const mostCommonDuo = await fetchMostCommonDuoPartner(playerId);

      const hoursInVC = stats.vc_time
        ? (stats.vc_time / 3600).toFixed(2)
        : "0.00";

      const longestMatch = stats.longest_match_time
        ? `${Math.round(stats.longest_match_time / 1000 / 60)} min`
        : "N/A";

      const totalMatchMins = stats.total_match_time
        ? `${Math.round(stats.total_match_time / 1000 / 60)} min`
        : "N/A";

      const duoPartnerInfo = mostCommonDuo
        ? `<@${mostCommonDuo.partner_id}> (${mostCommonDuo.pair_count} matches)`
        : "N/A";

      const topPlatform = await getTopPlatformForPlayer(playerId);
      const totalPoints = await getMatchCompletionPoints(playerId);
      const mvpStats = await getMvpStatsForPlayer(playerId);

      const mvpInfo = mvpStats.total
        ? `🏅 MVPs Received: ${mvpStats.total}\n   Top Giver: <@${mvpStats.topGiverId}> (${mvpStats.topGiverCount})`
        : "🏅 MVPs Received: 0";

      const roleThresholds = [
        { label: "Tier I Initiate", points: 100 },
        { label: "Tier II Veteran", points: 250 },
        { label: "Tier III Champion", points: 500 },
        { label: "Tier IV Legend", points: 1000 },
      ];

      let currentTier = "Unranked";
      let nextThreshold = roleThresholds[0];
      for (const tier of roleThresholds) {
        if (totalPoints >= tier.points) {
          currentTier = tier.label;
        } else {
          nextThreshold = tier;
          break;
        }
      }

      const tierPoints = nextThreshold.points;
      const progress = Math.min(totalPoints / tierPoints, 1);
      const filled = Math.floor(progress * 10);
      const bar = `[${"■".repeat(filled)}${"□".repeat(10 - filled)}]`;

      const roleProgress = `**${currentTier}**
      Progress: ${bar} ${totalPoints} / ${tierPoints} pts`;

      const currencyRow = await db.getAsync(
        `SELECT balance FROM player_currency WHERE player_id = ?`,
        [playerId]
      );

      const currencyBalance = currencyRow?.balance || 0;

      const response = `
      **📊 Statistics for ${targetUser.username}:**
      - **Queue Entries (Total):** ${stats.queue_entries || 0}
        - Solo: ${stats.queue_entries_solo || 0}
        - Duo: ${stats.queue_entries_duo || 0}
      - **Matches Played:** ${stats.matches_played || 0}
      - **Top Platform:** ${topPlatform}
      - **Hours in VC:** ${hoursInVC}
      - **Messages Sent:** ${stats.messages_sent || 0}
      - **Most Common Duo Partner:** ${duoPartnerInfo}
      - **Failed Ready Checks:** ${stats.failed_ready_checks || 0}
      - **Longest Match Duration:** ${longestMatch}
      - **Total Match Time:** ${totalMatchMins}
      - **MVP Summary:**\n${mvpInfo}
      - **Match Completion Tier:**\n${roleProgress}
      - **💰 Currency Balance:** ${currencyBalance} coins
      `;

      return interaction.reply({ content: response.trim(), flags: 64 });
    } catch (error) {
      logger.errorWrapper("❌ Error in /statistics command", error, {
        targetUser: targetUser.tag,
        userId: playerId,
      });

      return interaction.reply({
        content: "❌ An error occurred while retrieving statistics.",
        flags: 64,
      });
    }
  },
};
