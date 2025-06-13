const db = require("../../database");
const logger = require("../../logger");
const { removePlayerFromMatch } = require("../../utils/playerUtils");
const { searchForPlayers } = require("../../commands/search");
const { safeSend } = require("../../utils/matchmakingUtils/matchUtils");
const {
  activeKickVotes,
  voteMessages,
  kickCollectors,
} = require("../../utils/matchVoteState");
const { ButtonBuilder, ActionRowBuilder } = require("discord.js");

module.exports = {
  customIdRegex: /^confirm_kick_(\d{17,})$/,

  async execute(interaction) {
    const thread = interaction.channel;
    const voterId = interaction.user.id;
    const targetId = interaction.customId.split("_").pop();
    const voteKey = `${thread.id}:${targetId}`;

    try {
      const match = await db.getAsync(
        `SELECT match_id FROM channels WHERE threadId = ?`,
        [thread.id]
      );
      if (!match?.match_id) {
        return interaction.reply({
          content: "❌ No match found for this thread.",
          flags: 64,
        });
      }

      if (voterId === targetId) {
        return interaction.reply({
          content: "🚫 You can't vote to kick yourself.",
          flags: 64,
        });
      }

      const activePlayers = await db
        .allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match.match_id]
        )
        .then((rows) => rows.map((r) => r.playerId));

      if (!activePlayers.includes(voterId)) {
        return interaction.reply({
          content: "❌ You are not a valid participant.",
          flags: 64,
        });
      }

      const voters = activeKickVotes.get(voteKey) || new Set();

      if (voters.has(voterId)) {
        return interaction.reply({
          content: "⚠️ You’ve already voted.",
          flags: 64,
        });
      }

      voters.add(voterId);
      activeKickVotes.set(voteKey, voters);

      await interaction.deferUpdate().catch(() => {});

      if (voters.size >= 2) {
        await finalizeKick({
          thread,
          match_id: match.match_id,
          targetId,
          voteKey,
        });
      } else {
        await safeSend(
          thread,
          `🗳️ Kick vote updated. (${voters.size}/2 confirmations to remove <@${targetId}>)`
        );
      }
    } catch (err) {
      logger.errorWrapper("❌ Error handling confirm_kick button", err, {
        threadId: thread.id,
        voterId,
        targetId,
      });

      const errorMsg = {
        content: "❌ Something went wrong with your kick vote.",
        flags: 64,
      };

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(errorMsg).catch(() => {});
      } else {
        await interaction.followUp(errorMsg).catch(() => {});
      }
    }
  },
};

async function finalizeKick({ thread, match_id, targetId, voteKey }) {
  activeKickVotes.delete(voteKey);
  kickCollectors.delete(voteKey);
  const voteMessage = voteMessages.get(voteKey);
  voteMessages.delete(voteKey);

  // 🧱 Disable button
  if (voteMessage?.editable) {
    try {
      const originalButton = voteMessage.components?.[0]?.components?.[0];
      if (originalButton) {
        const disabledButton =
          ButtonBuilder.from(originalButton).setDisabled(true);
        const disabledRow = new ActionRowBuilder().addComponents(
          disabledButton
        );
        await voteMessage.edit({ components: [disabledRow] }).catch((err) => {
          logger.warn("⚠️ Failed to disable confirmed kick button", {
            voteKey,
            error: err.message,
          });
        });
      }
    } catch (err) {
      logger.warn("⚠️ Error disabling button in finalizeKick", {
        voteKey,
        error: err.message,
      });
    }
  }

  // 🚫 Prevent duplicate removal
  const inProgress = await db.getAsync(
    `SELECT leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
    [match_id, targetId]
  );

  if (inProgress?.leave_in_progress === 1) {
    await safeSend(thread, "⚠️ Kick already in progress for this player.");
    return;
  }

  await db.runAsync(
    `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
    [match_id, targetId]
  );

  await removePlayerFromMatch(targetId, thread.id, "kicked_via_vote");
  await safeSend(thread, "🔍 Searching for a replacement player...");
  await searchForPlayers(thread, 1);
}
