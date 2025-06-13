const db = require("../../database");
const logger = require("../../logger");

module.exports = {
  customId: "toggle_roles",

  async execute(interaction) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const selectedRoleIds = new Set(interaction.values); // roles user wants to be active

    const allTogglableRoleIds = [
      process.env.MATCH_TIER_1_ROLE_ID,
      process.env.MATCH_TIER_2_ROLE_ID,
      process.env.MATCH_TIER_3_ROLE_ID,
      process.env.MATCH_TIER_4_ROLE_ID,
      process.env.SHOP_ROLE_DUCHESS,
      process.env.SHOP_ROLE_EXECUTOR,
      process.env.SHOP_ROLE_GUARDIAN,
      process.env.SHOP_ROLE_IRONEYE,
      process.env.SHOP_ROLE_RAIDER,
      process.env.SHOP_ROLE_RECLUSE,
      process.env.SHOP_ROLE_REVENANT,
      process.env.SHOP_ROLE_WYLDER,
    ].filter(Boolean);

    const currentRoles = new Set(member.roles.cache.keys());

    let rolesToAdd = [];
    let rolesToRemove = [];

    for (const roleId of allTogglableRoleIds) {
      const hasRole = currentRoles.has(roleId);
      const wantsRole = selectedRoleIds.has(roleId);

      if (wantsRole && !hasRole) {
        rolesToAdd.push(roleId);
      } else if (!wantsRole && hasRole) {
        rolesToRemove.push(roleId);
      }
    }

    try {
      if (rolesToAdd.length > 0) {
        await member.roles.add(rolesToAdd, "Selected in /roles menu");
      }
      if (rolesToRemove.length > 0) {
        await member.roles.remove(rolesToRemove, "Deselected in /roles menu");
      }

      // Update active_display_role table (we only track a single "highlight" role here)
      const activeDisplayRole = [...selectedRoleIds][0] || null;

      if (activeDisplayRole) {
        await db.runAsync(
          `INSERT INTO active_display_role (player_id, role_id, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(player_id) DO UPDATE SET role_id = excluded.role_id, updated_at = excluded.updated_at`,
          [member.id, activeDisplayRole, Date.now()]
        );
      } else {
        await db.runAsync(
          `DELETE FROM active_display_role WHERE player_id = ?`,
          [member.id]
        );
      }

      return interaction.reply({
        content: "✅ Your roles have been updated!",
        flags: 64,
      });
    } catch (error) {
      logger.errorWrapper("❌ Error updating roles from toggle_roles", error, {
        userId: interaction.user.id,
        selectedRoleIds: [...selectedRoleIds],
      });

      return interaction.reply({
        content:
          "⚠️ Something went wrong while updating your roles. Please try again.",
        flags: 64,
      });
    }
  },
};
