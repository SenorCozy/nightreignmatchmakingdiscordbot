const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const db = require("../../database");
const logger = require("../../logger");
const {
  cleanupMatch,
  safeSend,
} = require("../../utils/matchmakingUtils/matchUtils");
const { hasModRole } = require("../../utils/permissions");
const {
  activeMatchEndVotes,
  matchEndCollectors,
} = require("../../utils/matchVoteState");

module.exports = {
  customId: "end_match",

  async execute(interaction) {
    const thread = interaction.channel;
    const userId = interaction.user.id;

    if (!thread?.isThread()) {
      return interaction.reply({
        content: "❌ This button must be used in a match thread.",
        flags: 64,
      });
    }

    try {
      const channelRow = await db.getAsync(
        `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
        [thread.id]
      );

      if (!channelRow) {
        logger.warn("⚠️ No channel found for thread during end_match button", {
          threadId: thread.id,
        });
        return interaction.reply({
          content: "❌ This match thread is not properly registered.",
          flags: 64,
        });
      }

      const { voiceChannelId } = channelRow;

      const activePlayers = await db
        .allAsync(
          `SELECT playerId FROM match_players WHERE threadId = ? AND status = 'active'`,
          [thread.id]
        )
        .then((rows) => rows.map((r) => r.playerId));

      if (hasModRole(interaction.member)) {
        await interaction.deferUpdate();
        logger.info("🛡️ Moderator override via button", {
          threadId: thread.id,
          user: interaction.user.tag,
        });
        await safeSend(
          thread,
          "✅ Match will end shortly (moderator override)..."
        );
        await cleanupMatch({
          thread,
          voiceChannelId,
          closedByUserOrBot: interaction.user,
          closureReason: "Ended by moderator via button",
        });
        activeMatchEndVotes.delete(thread.id);
        matchEndCollectors.delete(thread.id);
        return;
      }

      if (!activePlayers.includes(userId)) {
        return interaction.reply({
          content: "❌ You are not an active player in this match.",
          flags: 64,
        });
      }

      if (activePlayers.length === 1 && activePlayers[0] === userId) {
        await interaction.deferUpdate();
        await safeSend(
          thread,
          "☑️ Only one player remains. Ending the match..."
        );
        await cleanupMatch({
          thread,
          voiceChannelId,
          closedByUserOrBot: interaction.user,
          closureReason: "Match ended automatically (only one player remained)",
        });
        activeMatchEndVotes.delete(thread.id);
        matchEndCollectors.delete(thread.id);
        return;
      }

      if (activeMatchEndVotes.has(thread.id)) {
        const voteSet = activeMatchEndVotes.get(thread.id);
        if (voteSet.has(userId)) {
          return interaction.reply({
            content: "✅ You’ve already voted. Waiting for others.",
            flags: 64,
          });
        }

        voteSet.add(userId);
        logger.info("🗳️ Existing vote updated", {
          threadId: thread.id,
          currentVotes: [...voteSet],
        });

        return interaction.reply({
          content: `📝 A vote is already in progress. You’ve been added. (${voteSet.size}/2 confirmed)`,
          flags: 64,
        });
      }

      const voteSet = new Set([userId]);
      activeMatchEndVotes.set(thread.id, voteSet);

      if (matchEndCollectors.has(thread.id)) {
        matchEndCollectors.get(thread.id).stop("replaced");
      }

      await safeSend(
        thread,
        `📣 <@${userId}> has requested to end the match. Click the button below to confirm.`
      );

      await interaction.reply({
        content: `🗳️ Vote started by <@${userId}>. One more player must confirm within 60 seconds.`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("confirm_end_match_button")
              .setLabel("Confirm Match End")
              .setStyle(ButtonStyle.Danger)
          ),
        ],
      });

      const collector = thread.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
        filter: (btn) =>
          btn.customId === "confirm_end_match_button" &&
          activeMatchEndVotes.has(thread.id) &&
          activePlayers.includes(btn.user.id),
      });

      matchEndCollectors.set(thread.id, collector);

      collector.on("collect", async (btn) => {
        if (btn.customId !== "confirm_end_match_button") return;

        if (!activePlayers.includes(btn.user.id)) {
          return btn.reply({
            content: "❌ You are not a valid participant.",
            flags: 64,
          });
        }

        const currentVotes = activeMatchEndVotes.get(thread.id);
        if (!currentVotes) {
          return btn.reply({
            content: "⚠️ This vote has already ended or is no longer valid.",
            flags: 64,
          });
        }

        if (currentVotes.has(btn.user.id)) {
          return btn.reply({
            content: "✅ You already confirmed.",
            flags: 64,
          });
        }

        currentVotes.add(btn.user.id);
        await btn.deferUpdate();

        await safeSend(
          thread,
          `🔔 Vote confirmed by <@${btn.user.id}> (${currentVotes.size}/2)`
        );

        if (currentVotes.size >= 2) {
          collector.stop("success");
          await safeSend(thread, "✅ Vote passed. Match ending...");
          await cleanupMatch({
            thread,
            voiceChannelId,
            closedByUserOrBot: btn.user,
            closureReason: "Match ended by player vote (button)",
          });
          activeMatchEndVotes.delete(thread.id);
          matchEndCollectors.delete(thread.id);
        }
      });

      collector.on("end", async (_, reason) => {
        if (reason === "success") return;
        if (activeMatchEndVotes.has(thread.id)) {
          activeMatchEndVotes.delete(thread.id);
          matchEndCollectors.delete(thread.id);
          await safeSend(
            thread,
            "❌ Match end vote expired due to lack of confirmations."
          );
        }
      });
    } catch (err) {
      logger.errorWrapper("end_match_button", err, {
        threadId: thread.id,
        userId,
      });

      return interaction.reply({
        content: "❌ Something went wrong while ending the match.",
        flags: 64,
      });
    }
  },
};
