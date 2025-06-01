const vendors = require("../data/shopVendors");

let lastCommonIndex = 0;

function getRandomVendor() {
  const roll = Math.random();

  // Try rare vendors first
  const patches = vendors.find((v) => v.id === "patches");
  const gavlan = vendors.find((v) => v.id === "gavlan");

  if (roll < gavlan.chance) {
    return gavlan;
  }

  if (roll < gavlan.chance + patches.chance) {
    return patches;
  }

  // Cycle through commons
  const commons = vendors.filter((v) => v.rarity === "common");
  const vendor = commons[lastCommonIndex];
  lastCommonIndex = (lastCommonIndex + 1) % commons.length;

  return vendor;
}

module.exports = {
  getRandomVendor,
};
