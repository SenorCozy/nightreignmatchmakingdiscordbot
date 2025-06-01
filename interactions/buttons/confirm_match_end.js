// interactions/buttons/confirm_match_end.js
const { safeSend } = require("../../utils/matchmakingUtils/matchUtils");
const {
  activeMatchEndVotes,
  matchEndCollectors,
} = require("../../utils/matchVoteState");

module.exports = {
  customId: "confirm_match_end",

  async execute(interaction) {
    try {
      const endCommand = require("../../commands/end");

      // Optional: cleanup old collector if vote confirmed here
      const threadId = interaction.channel.id;
      if (matchEndCollectors.has(threadId)) {
        matchEndCollectors.get(threadId).stop("confirmed");
        matchEndCollectors.delete(threadId);
      }

      await endCommand.execute(interaction);
    } catch (error) {
      console.error(
        "❌ Error forwarding confirm_match_end interaction:",
        error
      );

      if (interaction.replied || interaction.deferred) {
        await safeSend(interaction.channel, {
          content:
            "❌ An unexpected error occurred while processing your vote.",
        });
      } else {
        return interaction.reply({
          content:
            "❌ An unexpected error occurred while processing your vote.",
          flags: 64,
        });
      }
    }
  },
};

module.exports = {
  customId: "confirm_end_match_button",

  async execute(interaction) {
    try {
      const endMatchHandler = require("./end_match");

      // Optional: ensure collector stops early
      const threadId = interaction.channel.id;
      if (matchEndCollectors.has(threadId)) {
        matchEndCollectors.get(threadId).stop("confirmed");
        matchEndCollectors.delete(threadId);
      }

      await endMatchHandler.execute(interaction);
    } catch (error) {
      console.error(
        "❌ Error forwarding confirm_end_match_button interaction:",
        error
      );

      if (interaction.replied || interaction.deferred) {
        await safeSend(interaction.channel, {
          content: "❌ Something went wrong confirming the end vote.",
        });
      } else {
        return interaction.reply({
          content: "❌ Something went wrong confirming the end vote.",
          flags: 64,
        });
      }
    }
  },
};
