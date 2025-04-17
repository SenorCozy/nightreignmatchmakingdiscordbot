const { handleSoloQueue } = require("../utils/queueHandlers");

module.exports = {
  customId: "duo_no",
  async execute(interaction) {
    await handleSoloQueue(interaction);
  },
};
