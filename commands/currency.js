const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const {
  unlockAchievementIfNotEarned,
  checkCurrencyAchievements,
} = require("../utils/achievementHelpers");

const MOD_ROLE_IDS_ADD_REMOVE = [
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
  process.env.ELDER_TICKET_HANDLER_ROLE,
].filter(Boolean);

const MOD_ROLE_IDS_AUDIT = [
  ...MOD_ROLE_IDS_ADD_REMOVE,
  process.env.TICKET_HANDLER_ROLE,
].filter(Boolean);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("currency")
    .setDescription("View or manage player currency.")
    .addSubcommand((sub) =>
      sub
        .setName("balance")
        .setDescription("View your own or another user's currency balance.")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Player (optional)")
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add currency to a player.")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Player").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("amount")
            .setDescription("Amount to add")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("reason")
            .setDescription("Reason for addition")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove currency from a player.")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Player").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("amount")
            .setDescription("Amount to remove")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("reason")
            .setDescription("Reason for removal")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("audit")
        .setDescription("View a player's currency change history.")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Player").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("page")
            .setDescription("Page number (10 per page)")
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser("user") || interaction.user; // defaults to self
    const page = interaction.options.getInteger("page") || 1;

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const isModForAddRemove = member.roles.cache.some((r) =>
      MOD_ROLE_IDS_ADD_REMOVE.includes(r.id)
    );
    const isModForAudit = member.roles.cache.some((r) =>
      MOD_ROLE_IDS_AUDIT.includes(r.id)
    );

    const playerId = user.id;
    const now = Date.now();

    // 🚫 Role Restrictions
    if ((sub === "add" || sub === "remove") && !isModForAddRemove) {
      return interaction.reply({
        content: "🚫 You do not have permission to modify currency.",
        flags: 64,
      });
    }

    if (sub === "audit" && !isModForAudit) {
      return interaction.reply({
        content: "🚫 You do not have permission to view the audit trail.",
        flags: 64,
      });
    }

    // 👤 View Balance (Public)
    if (sub === "balance") {
      const row = await db.getAsync(
        `SELECT balance FROM player_currency WHERE player_id = ?`,
        [playerId]
      );
      const balance = row?.balance || 0;

      return interaction.reply({
        content: `💰 **${user.username}'s Balance:** ${balance} 🪙`,
        flags: 64,
      });
    }

    // ➕ Add / ➖ Remove Currency (Mods Only)
    if (sub === "add" || sub === "remove") {
      const amount = interaction.options.getInteger("amount");
      const reason = interaction.options.getString("reason");
      const finalAmount =
        sub === "remove" ? -Math.abs(amount) : Math.abs(amount);

      await db.runAsync(
        `INSERT INTO player_currency (player_id, balance)
         VALUES (?, ?)
         ON CONFLICT(player_id) DO UPDATE SET balance = balance + ?`,
        [playerId, finalAmount, finalAmount]
      );

      await db.runAsync(
        `INSERT INTO currency_audit (player_id, amount_changed, source, source_id, modified_by, modified_at, reason)
         VALUES (?, ?, 'manual', NULL, ?, ?, ?)`,
        [playerId, finalAmount, interaction.user.id, now, reason]
      );

      setImmediate(() => {
        checkCurrencyAchievements(playerId, db).catch((err) => {
          logger.errorWrapper("Currency achievement check failed", err, {
            playerId,
          });
        });
      });

      return interaction.reply({
        content: `✅ ${sub === "add" ? "Added" : "Removed"} ${Math.abs(
          finalAmount
        )} 🪙 to <@${playerId}>.\nReason: ${reason}`,
        flags: 64,
      });
    }

    // 📜 Audit Trail (Mods Only)
    if (sub === "audit") {
      const pageSize = 10;
      const offset = (page - 1) * pageSize;

      const total = await db.getAsync(
        `SELECT COUNT(*) as count FROM currency_audit WHERE player_id = ?`,
        [playerId]
      );

      const rows = await db.allAsync(
        `SELECT * FROM currency_audit WHERE player_id = ? ORDER BY modified_at DESC LIMIT ? OFFSET ?`,
        [playerId, pageSize, offset]
      );

      const balanceRow = await db.getAsync(
        `SELECT balance FROM player_currency WHERE player_id = ?`,
        [playerId]
      );

      if (!rows || rows.length === 0) {
        return interaction.reply({
          content: `📭 No audit entries found for <@${playerId}>.`,
          flags: 64,
        });
      }

      const entries = rows
        .map((r) => {
          const time = new Date(r.modified_at).toLocaleString();
          const operator = r.amount_changed > 0 ? "+" : "−";
          return `• **${operator}${Math.abs(r.amount_changed)} 🪙** — ${
            r.reason || "No reason"
          } (by <@${r.modified_by}> at ${time})`;
        })
        .join("\n");

      return interaction.reply({
        content: `📒 **Currency Audit for <@${playerId}>**\n**Balance:** ${
          balanceRow?.balance || 0
        } 🪙\n**Page ${page}/${Math.ceil(
          total.count / pageSize
        )}**\n\n${entries}`,
        flags: 64,
      });
    }
  },
};
