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

async function showNightlordSelectMenu(
  interaction,
  customId = "select_nightlords"
) {
  const nightlordSelectMenu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select the Nightlords you're willing to fight")
    .setMinValues(1) // Require at least one
    .setMaxValues(NIGHTLORD_CHOICES.length)
    .addOptions(NIGHTLORD_CHOICES);

  const row = new ActionRowBuilder().addComponents(nightlordSelectMenu);

  await interaction.reply({
    content: "🧿 Choose the Nightlords you're willing to fight:",
    components: [row],
    flags: 64,
  });
}

module.exports = { showNightlordSelectMenu, NIGHTLORD_CHOICES };
