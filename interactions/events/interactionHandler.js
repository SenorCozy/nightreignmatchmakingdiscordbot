const handleInteraction = require("../interactionCreate");
const logger = require("../../logger");

module.exports = {
  name: "interactionCreate",
  once: false,
  async execute(interaction) {
    try {
      await handleInteraction(interaction);
    } catch (err) {
      logger.errorWrapper("interactionCreate", err, {
        user: interaction.user?.id,
      });
    }
  },
};
