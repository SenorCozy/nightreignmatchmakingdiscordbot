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
      "View the rotating vendor and buy special roles with your hard earned currency"
    ),

  async execute(interaction) {
    const userId = interaction.user.id;

    if (isOnShopCooldown(userId)) {
      return interaction.reply({
        content:
          "⏳ You recently visited the shop. There are no other merchants in the area.",
        flags: 64,
      });
    }

    setShopCooldown(userId);

    const vendor = getRandomVendor();

    try {
      let roles = await db.allAsync(`SELECT * FROM shop_roles`);

      // Sort by adjusted price ascending
      roles.sort((a, b) => {
        const priceA = Math.ceil(a.price * vendor.priceModifier);
        const priceB = Math.ceil(b.price * vendor.priceModifier);
        return priceA - priceB;
      });

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
      const rarityColor = {
        common: 0xfee75c,
        rare: 0x9b59b6,
      };

      const embed = new EmbedBuilder()
        .setTitle(`🛒 ${vendor.name}'s Shop`)
        .setColor(rarityColor[vendor.rarity] || 0xfee75c)
        .setDescription(`*${vendor.phrase}*`)
        .setColor(0xfee75c)
        .setFooter({
          text: "🕓 New shop vendors may be available every 20 minutes...",
        })
        .addFields(
          {
            name: "💰 Your Balance",
            value: `${balance.toLocaleString()} 🪙`,
            inline: true,
          },
          {
            name: "🧙 Vendor Rarity",
            value: vendor.rarity
              ? vendor.rarity.charAt(0).toUpperCase() + vendor.rarity.slice(1)
              : "Unknown",
            inline: true,
          },
          {
            name: "\u200b", // Spacer
            value: "\u200b",
            inline: true,
          }
        )
        .setImage(vendor.image);

      const allButtons = [];

      // Add role display fields once, outside the loop
      const roleLines = roles
        .map((role) => {
          const adjustedPrice = Math.ceil(role.price * vendor.priceModifier);
          const alreadyOwned = purchasedRoleIds.has(role.role_id);
          const icon = alreadyOwned ? "✅" : "🛍️";
          return `${icon} **${role.name}** — ${adjustedPrice} 🪙`;
        })
        .join("\n");

      embed.addFields({
        name: "🎟️ Available Roles",
        value: roleLines || "*No roles available right now.*",
      });

      // Now build buttons
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
