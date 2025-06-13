const { safeSend } = require("../../utils/matchmakingUtils/matchUtils");
const {
  activeMatchEndVotes,
  matchEndCollectors,
} = require("../../utils/matchVoteState");

module.exports = {
  customId: "confirm_match_end",

  async execute(interaction) {
    const threadId = interaction.channel.id;

    try {
      if (matchEndCollectors.has(threadId)) {
        matchEndCollectors.get(threadId).stop("confirmed");
        matchEndCollectors.delete(threadId);
      }

      const endCommand = require("../../commands/end");
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
        await interaction
          .reply({
            content:
              "❌ An unexpected error occurred while processing your vote.",
            flags: 64,
          })
          .catch(() => {});
      }
    }
  },
};
