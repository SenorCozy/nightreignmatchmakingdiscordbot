const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");

const NIGHTLORD_CHOICES = [
  {
    label: "🔘 Select All Nightlords",
    value: "select_all",
    description: "Select all available Nightlords quickly",
  },
  { label: "Tricephalos", value: "tricephalos" },
  { label: "Gaping Jaw", value: "gaping_jaw" },
  { label: "Sentient Pest", value: "sentient_pest" },
  { label: "Augur", value: "augur" },
  { label: "Equilibrious Beast", value: "equilibrious_beast" },
  { label: "Darkdrift Knight", value: "darkdrift_knight" },
  { label: "Fissure in the Fog", value: "fissure" },
  { label: "Night Aspect", value: "night_aspect" },
];

async function showDuoPreferenceMenus(playerId1, playerId2, interaction) {
  const nightlordSelectMenu = new StringSelectMenuBuilder()
    .setCustomId(`duo_select_nightlords:${playerId1}:${playerId2}`)
    .setPlaceholder("Select the Nightlords you're both willing to fight")
    .setMinValues(1)
    .setMaxValues(NIGHTLORD_CHOICES.length)
    .addOptions(NIGHTLORD_CHOICES);

  const row = new ActionRowBuilder().addComponents(nightlordSelectMenu);

  // Use followUp to avoid InteractionAlreadyReplied error
  const method =
    interaction.replied || interaction.deferred ? "followUp" : "reply";
  await interaction[method]({
    content: `🧠 Please select the Nightlords you and your duo partner are both willing to fight:`,
    components: [row],
    flags: 64,
  });
}

module.exports = {
  showDuoPreferenceMenus,
  NIGHTLORD_CHOICES,
};
