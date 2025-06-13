// interactions/buttons/confirm_end_match_button.js

module.exports = {
  customId: "confirm_end_match_button",

  async execute(interaction) {
    // ✅ No need to reply or defer — the collector in end_match.js handles this entirely
    return;
  },
};
