const { SlashCommandBuilder } = require("discord.js");
const { hasModRole } = require("../utils/permissions");
const db = require("../database");
const {
  startMatchmakingLoop,
  stopMatchmakingLoop,
  restartMatchmakingLoop,
} = require("../utils/matchmakingUtils/matchmakingLoop");
const {
  loadMatchmakingSettings,
} = require("../utils/matchmakingUtils/loadMatchmakingSettings");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("matchmaking")
    .setDescription("Matchmaking system controls")
    .addSubcommand((sub) =>
      sub
        .setName("setinterval")
        .setDescription(
          "Update the matchmaking loop interval (in milliseconds)"
        )
        .addIntegerOption((opt) =>
          opt
            .setName("milliseconds")
            .setDescription(
              "Interval between matchmaking runs (5000–600000 ms)"
            )
            .setMinValue(5000)
            .setMaxValue(600000)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("pause").setDescription("Pause the matchmaking system")
    )
    .addSubcommand((sub) =>
      sub.setName("resume").setDescription("Resume the matchmaking system")
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Show current matchmaking status")
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "🚫 You do not have permission to use this command.",
        flags: 64,
      });
    }

    try {
      if (subcommand === "setinterval") {
        const newInterval = interaction.options.getInteger("milliseconds");

        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE settings SET value = ? WHERE key = 'matchmaking_interval'`,
            [newInterval],
            (err) => (err ? reject(err) : resolve())
          );
        });

        const { matchmakingInterval } = await loadMatchmakingSettings();
        restartMatchmakingLoop(interaction.client, db, matchmakingInterval);

        console.info(`✅ Matchmaking interval updated to ${newInterval}ms`);
        return interaction.reply({
          content: `⏳ Matchmaking interval updated to **${
            newInterval / 1000
          } seconds**.`,
          flags: 64,
        });
      }

      if (subcommand === "pause") {
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE settings SET value = '1' WHERE key = 'matchmaking_paused'`,
            [],
            (err) => (err ? reject(err) : resolve())
          );
        });

        console.info(`⏸️ Matchmaking paused by ${interaction.user.tag}`);
        return interaction.reply({
          content:
            "⏸️ Matchmaking has been **paused**. Players can still queue, but no matches will be created.",
          flags: 64,
        });
      }

      if (subcommand === "resume") {
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE settings SET value = '0' WHERE key = 'matchmaking_paused'`,
            [],
            (err) => (err ? reject(err) : resolve())
          );
        });
        const { matchmakingInterval } = await loadMatchmakingSettings();
        restartMatchmakingLoop(interaction.client, db, matchmakingInterval);

        console.info(`▶️ Matchmaking resumed by ${interaction.user.tag}`);
        return interaction.reply({
          content:
            "▶️ Matchmaking has **resumed**. Matches will be created again based on the queue.",
          flags: 64,
        });
      }

      if (subcommand === "status") {
        const { matchmakingPaused, matchmakingInterval } =
          await loadMatchmakingSettings();

        const statusMsg =
          `📊 **Matchmaking Status:**\n` +
          `🔄 **Paused:** ${matchmakingPaused ? "Yes" : "No"}\n` +
          `⏱️ **Interval:** ${matchmakingInterval} ms (${Math.round(
            matchmakingInterval / 1000
          )} seconds)`;

        return interaction.reply({
          content: statusMsg,
          flags: 64,
        });
      }
    } catch (err) {
      console.error(`❌ Error in /matchmaking ${subcommand}:`, err);
      return interaction.reply({
        content:
          "❌ An unexpected error occurred while executing this command.",
        flags: 64,
      });
    }
  },
};
