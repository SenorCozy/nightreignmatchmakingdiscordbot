const shopVendors = require("../data/shopVendors");

const shopCooldowns = new Map(); // key: userId, value: timestamp
const recentVendors = new Map(); // key: userId, value: vendor

const SHOP_COOLDOWN_MS = 20 * 60 * 1000;

function isOnShopCooldown(userId) {
  const lastUsed = shopCooldowns.get(userId);
  return lastUsed ? Date.now() - lastUsed < SHOP_COOLDOWN_MS : false;
}

function setShopCooldown(userId) {
  shopCooldowns.set(userId, Date.now());
}

function setRecentVendor(userId, vendor) {
  recentVendors.set(userId, vendor);
}

function getRecentVendor(userId) {
  return recentVendors.get(userId);
}

module.exports = {
  isOnShopCooldown,
  setShopCooldown,
  setRecentVendor,
  getRecentVendor,
};
