const { handleDuoQueue } = require("../../utils/queueHandlers");

module.exports = {
  customId: "duo_yes",
  async execute(interaction) {
    await handleDuoQueue(interaction);
  },
};
