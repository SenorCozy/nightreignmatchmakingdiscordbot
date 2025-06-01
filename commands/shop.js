const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const { getRandomVendor } = require("../utils/vendorUtils");
const { isOnShopCooldown, setShopCooldown } = require("../utils/shopUtils");
const { setRecentVendor } = require("../utils/shopUtils"); // Add this line

const SHOP_ROLE_IDS = {
  duchess: process.env.SHOP_ROLE_DUCHESS,
  executor: process.env.SHOP_ROLE_EXECUTOR,
  guardian: process.env.SHOP_ROLE_GUARDIAN,
  ironeye: process.env.SHOP_ROLE_IRONEYE,
  raider: process.env.SHOP_ROLE_RAIDER,
  recluse: process.env.SHOP_ROLE_RECLUSE,
  revenant: process.env.SHOP_ROLE_REVENANT,
  wylder: process.env.SHOP_ROLE_WYLDER,
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription(
      "View the rotating vendor and buy special roles with currency"
    ),

  async execute(interaction) {
    const userId = interaction.user.id;

    if (isOnShopCooldown(userId)) {
      return interaction.reply({
        content:
          "⏳ You recently visited the shop. Please wait before checking again.",
        flags: 64,
      });
    }

    setShopCooldown(userId);

    const vendor = getRandomVendor();

    try {
      const roles = await db.allAsync(`SELECT * FROM shop_roles`);

      const userPurchases = await db.allAsync(
        `SELECT role_id FROM player_purchases WHERE player_id = ?`,
        [userId]
      );
      const playerCurrency = await db.getAsync(
        `SELECT balance FROM player_currency WHERE player_id = ?`,
        [userId]
      );

      const purchasedRoleIds = new Set(userPurchases.map((row) => row.role_id));
      const balance = playerCurrency?.balance ?? 0;

      const embed = new EmbedBuilder()
        .setTitle(`${vendor.name}'s Shop`)
        .setDescription(vendor.phrase)
        .setThumbnail(vendor.image)
        .setColor(0xfee75c)
        .addFields({
          name: "Your Balance",
          value: `${balance.toLocaleString()} 🪙`,
          inline: true,
        });

      const allButtons = [];

      for (const role of roles) {
        const adjustedPrice = Math.ceil(role.price * vendor.priceModifier);
        const alreadyOwned = purchasedRoleIds.has(role.role_id);
        const affordable = balance >= adjustedPrice;

        const button = new ButtonBuilder()
          .setCustomId(`buy_role_${role.role_id}`)
          .setLabel(`${role.name} — ${adjustedPrice} 🪙`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(alreadyOwned || !affordable);

        allButtons.push(button);

        embed.addFields({
          name: role.name,
          value: alreadyOwned
            ? `✅ Already owned`
            : `${
                role.description || "*No description*"
              }\nCost: **${adjustedPrice}** 🪙`,
          inline: false,
        });
      }

      // Split into action rows of 5
      const actionRows = [];
      for (let i = 0; i < allButtons.length; i += 5) {
        actionRows.push(
          new ActionRowBuilder().addComponents(allButtons.slice(i, i + 5))
        );
      }

      if (actionRows.length === 0) {
        return interaction.reply({
          embeds: [
            embed.setDescription(
              `${vendor.phrase}\n\n*No items available right now.*`
            ),
          ],
          flags: 64,
        });
      }

      setRecentVendor(userId, vendor);

      return interaction.reply({
        embeds: [embed],
        components: actionRows,
        flags: 64,
      });
    } catch (error) {
      logger.errorWrapper("ShopCommand", error);
      return interaction.reply({
        content:
          "⚠️ There was an error fetching shop data. Please try again later.",
        flags: 64,
      });
    }
  },
};
