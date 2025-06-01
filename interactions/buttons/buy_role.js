const db = require("../../database");
const logger = require("../../logger");
const { ButtonStyle, ActionRowBuilder, ButtonBuilder } = require("discord.js");
const shopVendors = require("../../data/shopVendors");
const { getRecentVendor } = require("../../utils/shopUtils");

module.exports = {
  customIdRegex: /^buy_role_/,
  async execute(interaction) {
    const userId = interaction.user.id;
    const roleId = interaction.customId.split("_").pop();
    const guild = interaction.guild;

    try {
      const vendor =
        getRecentVendor(userId) ||
        shopVendors.find((v) => v.id === "merchant1");

      const alreadyPurchased = await db.getAsync(
        `SELECT 1 FROM player_purchases WHERE player_id = ? AND role_id = ?`,
        [userId, roleId]
      );

      if (alreadyPurchased) {
        return interaction.reply({
          content: "✅ You already own this role.",
          flags: 64,
        });
      }

      const roleData = await db.getAsync(
        `SELECT * FROM shop_roles WHERE role_id = ?`,
        [roleId]
      );

      if (!roleData) {
        return interaction.reply({
          content: "❌ This role is no longer available in the shop.",
          flags: 64,
        });
      }

      const adjustedPrice = Math.ceil(roleData.price * vendor.priceModifier);
      const player = await db.getAsync(
        `SELECT balance FROM player_currency WHERE player_id = ?`,
        [userId]
      );

      const balance = player?.balance ?? 0;

      if (balance < adjustedPrice) {
        return interaction.reply({
          content: `🚫 You need **${adjustedPrice}** 🪙 but only have **${balance}**.`,
          flags: 64,
        });
      }

      await db.runAsync(
        `UPDATE player_currency SET balance = balance - ? WHERE player_id = ?`,
        [adjustedPrice, userId]
      );

      const member = await guild.members.fetch(userId);
      await member.roles.add(roleId);

      await db.runAsync(
        `INSERT INTO player_purchases (player_id, role_id, purchased_at) VALUES (?, ?, ?)`,
        [userId, roleId, Date.now()]
      );

      await db.runAsync(
        `INSERT INTO currency_audit (player_id, amount_changed, source, source_id, modified_by, modified_at, reason)
         VALUES (?, ?, 'shop', ?, ?, ?, ?)`,
        [
          userId,
          -adjustedPrice,
          roleId,
          userId,
          Date.now(),
          `Purchased ${roleData.name} from ${vendor.name}`,
        ]
      );

      return interaction.reply({
        content: `🎉 You purchased **${roleData.name}** for **${adjustedPrice}** 🪙 from **${vendor.name}**!`,
        flags: 64,
      });
    } catch (err) {
      logger.errorWrapper("BuyRoleHandler", err);
      return interaction.reply({
        content: "⚠️ Something went wrong while processing your purchase.",
        flags: 64,
      });
    }
  },
};
