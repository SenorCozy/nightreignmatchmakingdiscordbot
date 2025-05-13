const { SlashCommandBuilder, ChannelType } = require("discord.js");
const db = require("../database");
const util = require("util");

db.getAsync = util.promisify(db.get).bind(db);
db.allAsync = util.promisify(db.all).bind(db);
db.runAsync = util.promisify(db.run).bind(db);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check status of a user or match thread")
    .addSubcommand((sub) =>
      sub
        .setName("user")
        .setDescription("Check a user's queue/match/blacklist status")
        .addUserOption((option) =>
          option
            .setName("target")
            .setDescription("The user to check status for")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("thread")
        .setDescription("Check the status of the current match thread")
    ),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();

      if (sub === "user") {
        const member = interaction.options.getUser("target");
        const playerId = member.id;

        let statusMessage = `**Status for <@${playerId}>:**\n\n`;

        const queueData = await db.getAsync(
          `SELECT platform, status, duoPartner FROM players WHERE id = ?`,
          [playerId]
        );

        let queueType = "Solo";

        if (queueData) {
          if (queueData.duoPartner) {
            const partnerStillQueued = await db.getAsync(
              `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
              [queueData.duoPartner]
            );

            if (!partnerStillQueued) {
              await db.runAsync(
                `UPDATE players SET duoPartner = NULL WHERE id = ? AND duoPartner IS NOT NULL`,
                [playerId]
              );
              console.info(`✅ Removed orphaned duo for ${playerId}`);
            } else {
              queueType = `Duo (with <@${queueData.duoPartner}>)`;
            }
          }

          statusMessage += `🔹 **Queue Status:** ${
            queueData.status?.toUpperCase() || "UNKNOWN"
          }\n`;
          statusMessage += `🔹 **Platform:** ${queueData.platform.toUpperCase()}\n`;
          statusMessage += `🔹 **Queue Type:** ${queueType}\n\n`;
        } else {
          statusMessage += "🔹 **Queue Status:** Not in queue.\n\n";
        }

        const matchData = await db.getAsync(
          `SELECT mp.match_id, m.thread_id, c.voiceChannelId
           FROM match_players mp
           JOIN matches m ON mp.match_id = m.match_id
           LEFT JOIN channels c ON m.thread_id = c.threadId
           WHERE mp.playerId = ? AND mp.status = 'active'`,
          [playerId]
        );

        if (matchData) {
          const teammates = await db.allAsync(
            `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active' AND playerId != ?`,
            [matchData.match_id, playerId]
          );

          statusMessage += `🔹 **Active Match:** Yes\n`;
          statusMessage += `🔹 **Match Thread:** <#${matchData.thread_id}>\n`;
          statusMessage += `🔹 **Teammates:** ${
            teammates.map((r) => `<@${r.playerId}>`).join(", ") ||
            "No teammates"
          }\n`;
          statusMessage += `🔹 **Voice Channel:** ${
            matchData.voiceChannelId ? `<#${matchData.voiceChannelId}>` : "None"
          }\n\n`;
        } else {
          statusMessage += "🔹 **Active Match:** Not in a match.\n\n";
        }

        const blacklistEntry = await db.getAsync(
          `SELECT reason, added_at FROM blacklist WHERE id = ?`,
          [playerId]
        );

        if (blacklistEntry) {
          statusMessage += `🚫 **This user is blacklisted from matchmaking.**\n`;
          statusMessage += `🔸 **Reason:** ${
            blacklistEntry.reason || "Not provided"
          }\n`;
          statusMessage += `🔸 **Since:** <t:${Math.floor(
            blacklistEntry.added_at / 1000
          )}:R>\n`;
        }

        return interaction.reply({ content: statusMessage, flags: 64 });
      }

      if (sub === "thread") {
        const thread = interaction.channel;
        if (!thread?.isThread()) {
          return interaction.reply({
            content: "❌ This command must be used inside a match thread.",
            flags: 64,
          });
        }

        const match = await db.getAsync(
          `SELECT match_id FROM matches WHERE thread_id = ?`,
          [thread.id]
        );
        if (!match) {
          return interaction.reply({
            content: "❌ No active match found for this thread.",
            flags: 64,
          });
        }

        const active = await db.allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match.match_id]
        );
        const removed = await db.allAsync(
          `SELECT playerId, status FROM match_players WHERE match_id = ? AND status != 'active'`,
          [match.match_id]
        );

        let statusMessage = `**🧾 Match Status for <#${thread.id}>:**\n`;
        statusMessage += `🔹 **Active Players (${active.length}):** ${
          active.map((r) => `<@${r.playerId}>`).join(", ") || "None"
        }\n`;

        if (removed.length > 0) {
          statusMessage += `🔸 **Removed Players (${removed.length}):**\n`;
          for (const r of removed) {
            statusMessage += `- <@${r.playerId}> — \`${r.status}\`\n`;
          }
        } else {
          statusMessage += `🔸 **Removed Players:** None\n`;
        }

        return interaction.reply({ content: statusMessage, flags: 64 });
      }
    } catch (error) {
      console.error("Error executing /status:", error.message);
      return interaction.reply({
        content: "❌ An error occurred while retrieving status.",
        flags: 64,
      });
    }
  },
};
