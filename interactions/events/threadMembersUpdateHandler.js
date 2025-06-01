// interactions/events/threadMembersUpdate.js
const { Events } = require("discord.js");
const logger = require("../../logger");
const threadMemberUpdate = require("./threadMemberUpdate");
const { safeSend } = require("../../utils/matchmakingUtils/matchUtils");

module.exports = {
  name: Events.ThreadMembersUpdate,
  async execute(addedMembers, removedMembers, thread) {
    try {
      // Ensure the bot has joined the thread (necessary for sending messages or managing members)
      if (!thread.joined) {
        await thread.join().catch((err) =>
          logger.warn("⚠️ Failed to join thread", {
            threadId: thread.id,
            error: err.message,
          })
        );
      }

      // Forward to main thread member handler
      await threadMemberUpdate(addedMembers, removedMembers, thread);
    } catch (err) {
      logger.errorWrapper("❌ threadMembersUpdate_wrapper", err, {
        threadId: thread?.id,
      });

      // Optional: if you want to inform players in the thread in case of visible failures
      await safeSend(thread, {
        content:
          "⚠️ An error occurred while handling a thread membership update.",
      });
    }
  },
};
