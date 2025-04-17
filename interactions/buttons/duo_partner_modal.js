const { handleDuoQueueModal } = require("../utils/queueHandlers");

module.exports = {
  customId: "duo_partner_modal",
  async execute(interaction) {
    await handleDuoQueueModal(interaction);
  },
};
