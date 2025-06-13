// commands/leave.js
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const db = require("../database");
const logger = require("../logger");
const {
  cleanupMatch,
  safeSend,
} = require("../utils/matchmakingUtils/matchUtils");
const { removePlayerFromMatch } = require("../utils/playerUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave your current match thread and voice channel"),

  async execute(interaction) {
    const thread = interaction.channel;
    const playerId = interaction.user.id;

    if (!thread?.isThread()) {
      return interaction.reply({
        content: "❌ This command must be used inside a match thread.",
        flags: 64,
      });
    }

    try {
      let match;
      try {
        match = await db.getAsync(
          `SELECT match_id, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id]
        );
      } catch (err) {
        logger.errorWrapper("DB error fetching match in /leave", err, {
          threadId: thread.id,
        });
        return interaction.reply({
          content: "❌ Failed to retrieve match data.",
          flags: 64,
        });
      }

      if (!match) {
        return interaction.reply({
          content: "❌ This match no longer exists.",
          flags: 64,
        });
      }

      const { match_id, voiceChannelId } = match;

      try {
        const inProgressRow = await db.getAsync(
          `SELECT leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId]
        );

        if (inProgressRow?.leave_in_progress === 1) {
          return interaction.reply({
            content: "⚠️ Your leave request is already being processed.",
            flags: 64,
          });
        }

        await db.runAsync(
          `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId]
        );
      } catch (err) {
        logger.errorWrapper(
          "DB error setting leave_in_progress in /leave",
          err,
          {
            match_id,
            playerId,
          }
        );
        return interaction.reply({
          content: "❌ Failed to process leave request.",
          flags: 64,
        });
      }

      let activePlayers;
      try {
        activePlayers = await db.allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id]
        );
      } catch (err) {
        logger.errorWrapper(
          "DB error retrieving active players in /leave",
          err,
          { match_id }
        );
        return interaction.reply({
          content: "❌ Could not retrieve active players.",
          flags: 64,
        });
      }

      const isActive = activePlayers.some((p) => p.playerId === playerId);
      if (!isActive) {
        await db.runAsync(
          `UPDATE match_players SET leave_in_progress = 0 WHERE match_id = ? AND playerId = ?`,
          [match_id, playerId]
        );
        return interaction.reply({
          content: "❌ You are not part of this match.",
          flags: 64,
        });
      }

      try {
        await removePlayerFromMatch(playerId, thread.id, "left_match");
      } catch (err) {
        logger.errorWrapper(
          "Error in removePlayerFromMatch during /leave",
          err,
          {
            match_id,
            playerId,
          }
        );
        return interaction.reply({
          content: "❌ Failed to remove you from the match.",
          flags: 64,
        });
      }

      let remaining = [];
      try {
        remaining = await db.allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id]
        );
      } catch (err) {
        logger.errorWrapper(
          "DB error fetching remaining players in /leave",
          err,
          { match_id }
        );
      }

      if (remaining.length === 0) {
        try {
          await cleanupMatch({ thread, voiceChannelId });
        } catch (err) {
          logger.errorWrapper(
            "cleanupMatch failed after last player left",
            err,
            {
              threadId: thread.id,
            }
          );
        }
      } else {
        // 🔍 Get current Nightlord preferences
        let currentPrefs = [];
        try {
          const row = await db.getAsync(
            `SELECT shared_nightlords FROM matches WHERE match_id = ?`,
            [match_id]
          );
          currentPrefs = row?.shared_nightlords
            ? JSON.parse(row.shared_nightlords)
            : [];
        } catch (err) {
          logger.warn("⚠️ Could not parse shared_nightlords in /leave", {
            match_id,
            error: err.message,
          });
        }

        const formattedPrefs = currentPrefs.length
          ? currentPrefs.map((p) => `• ${p}`).join("\n")
          : "_None currently set._";

        const updateRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("update_shared_nightlords_button")
            .setLabel("Update Nightlord Preferences")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("find_replacement")
            .setLabel("Find Replacement from Queue")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("end_match_now")
            .setLabel("End Match Immediately")
            .setStyle(ButtonStyle.Danger)
        );

        await safeSend(thread, {
          content: `⚠️ A player has left the match.\n\n**Current Nightlord Preferences:**\n${formattedPrefs}\n\nWould you like to update preferences before searching for a replacement or ending the match?`,
          components: [updateRow],
        });
      }
    } catch (err) {
      logger.errorWrapper("❌ Error executing /leave", err, {
        threadId: thread?.id,
        playerId,
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ An error occurred while trying to leave the match.",
          flags: 64,
        });
      }
    }
  },
};
