const db = require("../../database");
const logger = require("../../logger");
const { ButtonStyle, ActionRowBuilder, ButtonBuilder } = require("discord.js");
const shopVendors = require("../../data/shopVendors");
const { getRecentVendor } = require("../../utils/shopUtils");
const { logCurrencyChange } = require("../../utils/logCurrencyChange");
const {
  unlockAchievementIfNotEarned,
} = require("../../utils/achievementHelpers");

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
      try {
        await member.roles.add(roleId);
      } catch (err) {
        logger.errorWrapper("❌ Failed to assign role", err, {
          roleId,
          userId,
        });

        return interaction.reply({
          content: `✅ You were charged **${adjustedPrice}** 🪙, but I couldn't assign the role. Please contact a mod.`,
          flags: 64,
        });
      }

      await db.runAsync(
        `INSERT INTO player_purchases (player_id, role_id, purchased_at) VALUES (?, ?, ?)`,
        [userId, roleId, Date.now()]
      );

      // 🧾 Audit the transaction
      await logCurrencyChange({
        playerId: userId,
        amount: -adjustedPrice,
        source: "shop",
        source_id: roleId,
        modified_by: userId,
        reason: `Purchased ${roleData.name} from ${vendor.name}`,
      });

      // 🏆 Trigger achievements
      setImmediate(() => {
        const achievementsToCheck = [
          "currency_spent_100",
          "currency_spent_400",
          "currency_zero",
          "store_buy_1",
          "store_buy_3",
          "store_buy_5",
          "store_buy_8",
        ];

        for (const id of achievementsToCheck) {
          unlockAchievementIfNotEarned(userId, id).catch((err) =>
            logger.errorWrapper("Achievement unlock failed", err, {
              playerId: userId,
              achievementId: id,
            })
          );
        }
      });

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
