const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
} = require("discord.js");
const db = require("../database");
const logger = require("../logger");

const MATCH_ROLE_THRESHOLDS = [
  { roleId: process.env.MATCH_TIER_1_ROLE_ID, points: 100 },
  { roleId: process.env.MATCH_TIER_2_ROLE_ID, points: 250 },
  { roleId: process.env.MATCH_TIER_3_ROLE_ID, points: 500 },
  { roleId: process.env.MATCH_TIER_4_ROLE_ID, points: 1000 },
];

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

const ROLE_IDS = [
  ...MATCH_ROLE_THRESHOLDS.map((r) => r.roleId),
  ...Object.values(SHOP_ROLE_IDS),
].filter(Boolean);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roles")
    .setDescription(
      "Manage your unlocked roles and toggle which ones are visible"
    ),

  async execute(interaction) {
    try {
      const guild = interaction.guild;
      const member = await guild.members.fetch(interaction.user.id);

      // Get match completion points
      const result = await db.getAsync(
        `SELECT SUM(points) as totalPoints FROM match_completion_awards WHERE player_id = ?`,
        [member.id]
      );
      const totalPoints = result?.totalPoints ?? 0;

      // Get purchased shop roles
      const purchases = await db.allAsync(
        `SELECT role_id FROM player_purchases WHERE player_id = ?`,
        [member.id]
      );
      const purchasedRoleIds = new Set(purchases.map((r) => r.role_id));

      // Build list of unlocked roles
      const unlockedRoles = new Set();

      for (const { roleId, points } of MATCH_ROLE_THRESHOLDS) {
        if (totalPoints >= points && roleId) unlockedRoles.add(roleId);
      }

      for (const roleId of Object.values(SHOP_ROLE_IDS)) {
        if (purchasedRoleIds.has(roleId)) unlockedRoles.add(roleId);
      }

      if (unlockedRoles.size === 0) {
        return interaction.reply({
          content:
            "❌ You haven't unlocked any roles yet. Earn match points or visit the shop to get started.",
          flags: 64,
        });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("toggle_roles")
        .setPlaceholder("Select roles to toggle on or off")
        .setMinValues(0)
        .setMaxValues(unlockedRoles.size)
        .addOptions(
          [...unlockedRoles].map((roleId) => {
            const role = guild.roles.cache.get(roleId);
            return {
              label: role?.name || "Unknown Role",
              value: roleId,
            };
          })
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setTitle("🎭 Manage Your Roles")
        .setDescription(
          "Select any roles you've unlocked to toggle them on or off.\nYou can equip as many or as few of the roles you have unlocked as you wish. Roles are applied when unlocked by default. Sometimes you have to toggle them on again here first, then toggle them off through this interface to remove them."
        )
        .setColor(0xfee75c);

      return interaction.reply({
        embeds: [embed],
        components: [row],
        flags: 64,
      });
    } catch (error) {
      logger.errorWrapper("❌ Error in /roles command", error, {
        userId: interaction.user.id,
      });

      return interaction.reply({
        content:
          "⚠️ Something went wrong while loading your roles. Please try again later.",
        flags: 64,
      });
    }
  },
};
