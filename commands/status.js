// commands/status.js
const { SlashCommandBuilder, ChannelType } = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const { safeSend } = require("../utils/matchmakingUtils/matchUtils");
const util = require("util");

db.getAsync ??= util.promisify(db.get).bind(db);
db.allAsync ??= util.promisify(db.all).bind(db);
db.runAsync ??= util.promisify(db.run).bind(db);

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

        let player;
        try {
          player = await db.getAsync(
            `SELECT platform, status, duoPartner, last_queue_exit_at FROM players WHERE id = ?`,
            [playerId]
          );
        } catch (err) {
          logger.errorWrapper(
            "DB error fetching player status in /status",
            err,
            { playerId }
          );
          return interaction.reply({
            content: "❌ Failed to retrieve player status.",
            flags: 64,
          });
        }

        if (player) {
          const { status, platform, duoPartner, last_queue_exit_at } = player;
          statusMessage += `🔹 **Queue Status:** ${
            status === "queued" ? "QUEUED" : "Not in queue"
          }\n`;

          if (platform) {
            statusMessage += `🔹 **Platform:** ${platform.toUpperCase()}\n`;
          }

          if (status === "queued") {
            let queueType = "Solo";
            if (duoPartner) {
              try {
                const partnerStillQueued = await db.getAsync(
                  `SELECT id FROM players WHERE id = ? AND status = 'queued'`,
                  [duoPartner]
                );
                if (!partnerStillQueued) {
                  await db.runAsync(
                    `UPDATE players SET duoPartner = NULL WHERE id = ? AND duoPartner IS NOT NULL`,
                    [playerId]
                  );
                  logger.info("🧹 Removed orphaned duo", { playerId });
                } else {
                  queueType = `Duo (with <@${duoPartner}>)`;
                }
              } catch (err) {
                logger.errorWrapper(
                  "DB error checking duo partner in /status",
                  err,
                  {
                    playerId,
                    duoPartner,
                  }
                );
              }
            }
            statusMessage += `🔹 **Queue Type:** ${queueType}\n`;
          } else if (last_queue_exit_at) {
            statusMessage += `🔸 **Last Queue Exit:** <t:${Math.floor(
              last_queue_exit_at / 1000
            )}:R>\n`;
          }

          statusMessage += `\n`;
        } else {
          statusMessage += `🔹 **Queue Status:** Not in queue\n\n`;
        }

        try {
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
              matchData.voiceChannelId
                ? `<#${matchData.voiceChannelId}>`
                : "None"
            }\n\n`;
          } else {
            statusMessage += `🔹 **Active Match:** Not in a match.\n\n`;
          }
        } catch (err) {
          logger.errorWrapper(
            "DB error checking match status in /status",
            err,
            { playerId }
          );
        }

        try {
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
        } catch (err) {
          logger.errorWrapper("DB error checking blacklist in /status", err, {
            playerId,
          });
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

        try {
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
        } catch (err) {
          logger.errorWrapper(
            "DB error checking thread status in /status",
            err,
            {
              threadId: thread.id,
            }
          );
          return interaction.reply({
            content: "❌ Failed to retrieve thread status.",
            flags: 64,
          });
        }
      }
    } catch (error) {
      logger.errorWrapper("❌ Error executing /status", error, {
        userId: interaction.user.id,
        subcommand: interaction.options.getSubcommand(),
      });

      return interaction
        .reply({
          content: "❌ An error occurred while retrieving status.",
          flags: 64,
        })
        .catch((err) =>
          logger.warn("⚠️ Failed to reply to /status error", {
            err: err.message,
          })
        );
    }
  },
};
