const db = require("../../database");
const logger = require("../../logger");
const { removePlayerFromMatch } = require("../../utils/playerUtils");
const { searchForPlayers } = require("../../commands/search");
const { safeSend } = require("../../utils/matchmakingUtils/matchUtils");
const {
  activeKickVotes,
  kickCollectors,
} = require("../../utils/matchVoteState");
const { ComponentType } = require("discord.js");

module.exports = {
  customIdRegex: /^confirm_kick_(\d{17,})$/, // Dynamic pattern

  async execute(interaction) {
    const thread = interaction.channel;
    const voterId = interaction.user.id;
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

    const targetId = interaction.customId.split("_").pop();
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

    const voteKey = `${thread.id}:${targetId}`;
    const voters = activeKickVotes.get(voteKey) || new Set();

    if (voters.has(voterId)) {
      return interaction.reply({
        content: "⚠️ You’ve already voted.",
        flags: 64,
      });
    }

    voters.add(voterId);
    activeKickVotes.set(voteKey, voters);

    await interaction.deferUpdate();

    if (voters.size >= 2) {
      activeKickVotes.delete(voteKey);
      const collector = kickCollectors.get(voteKey);
      if (collector) {
        collector.stop("confirmed");
        kickCollectors.delete(voteKey);
      }

      const inProgress = await db.getAsync(
        `SELECT leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
        [match.match_id, targetId]
      );

      if (inProgress?.leave_in_progress === 1) {
        await safeSend(thread, "⚠️ Kick already in progress for this player.");
        return;
      }

      await db.runAsync(
        `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
        [match.match_id, targetId]
      );

      await removePlayerFromMatch(targetId, thread.id, "kicked_via_vote");

      await safeSend(thread, "🔍 Searching for a replacement player...");
      await searchForPlayers(thread, 1);
    } else {
      await safeSend(
        thread,
        `🗳️ Kick vote updated. (${voters.size}/2 confirmations to remove <@${targetId}>)`
      );

      if (!kickCollectors.has(voteKey)) {
        const filter = (i) =>
          i.customId === `confirm_kick_${targetId}` &&
          activePlayers.includes(i.user.id) &&
          !activeKickVotes.get(voteKey)?.has(i.user.id);

        const collector = thread.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 60000,
          filter,
        });

        kickCollectors.set(voteKey, collector);

        collector.on("collect", async (btn) => {
          try {
            const voteSet = activeKickVotes.get(voteKey);
            if (!voteSet) return;

            voteSet.add(btn.user.id);
            await btn.deferUpdate();

            await safeSend(
              thread,
              `🗳️ Kick vote updated. (${voteSet.size}/2 confirmations to remove <@${targetId}>)`
            );

            if (voteSet.size >= 2) {
              activeKickVotes.delete(voteKey);
              kickCollectors.delete(voteKey);
              collector.stop("confirmed");

              const inProgress = await db.getAsync(
                `SELECT leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
                [match.match_id, targetId]
              );

              if (inProgress?.leave_in_progress === 1) {
                await safeSend(thread, "⚠️ Kick already in progress.");
                return;
              }

              await db.runAsync(
                `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
                [match.match_id, targetId]
              );

              await removePlayerFromMatch(
                targetId,
                thread.id,
                "kicked_via_vote"
              );
              await safeSend(
                thread,
                "🔍 Searching for a replacement player..."
              );
              await searchForPlayers(thread, 1);
            }
          } catch (err) {
            logger.errorWrapper("kickVoteCollector", err, {
              voteKey,
              threadId: thread.id,
            });
          }
        });

        collector.on("end", (_, reason) => {
          if (reason === "confirmed") return;
          activeKickVotes.delete(voteKey);
          kickCollectors.delete(voteKey);
          safeSend(
            thread,
            `⌛ Kick vote for <@${targetId}> expired without enough confirmations.`
          );
        });
      }
    }
  },
};
