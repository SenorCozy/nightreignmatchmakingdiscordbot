const { SlashCommandBuilder } = require("discord.js");
const { hasModRole } = require("../utils/permissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Manage player blacklist")
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("View all blacklisted players")
    )
    .addSubcommand((sub) =>
      sub
        .setName("toggle")
        .setDescription("Blacklist or unblacklist a player")
        .addUserOption((opt) =>
          opt
            .setName("user")
            .setDescription("Player to toggle")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("reason")
            .setDescription("Reason for blacklisting")
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    if (!hasModRole(interaction.member)) {
      return interaction.reply({
        content: "🚫 You do not have permission to use this command.",
        flags: 64,
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "list") {
      const players = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id, username, added_at, reason FROM blacklist`,
          [],
          (err, rows) => (err ? reject(err) : resolve(rows))
        );
      });

      if (!players.length) {
        return interaction.reply({
          content: "✅ No users are currently blacklisted.",
          flags: 64,
        });
      }

      const output = players
        .map(
          (p) =>
            `🔹 <@${p.id}> (${p.username}) - Added <t:${Math.floor(
              p.added_at / 1000
            )}:R>\nReason: ${p.reason || "*Not provided*"}`
        )
        .join("\n\n");

      return interaction.reply({
        content: `**Blacklisted Players:**\n\n${output}`,
        flags: 64,
      });
    }

    if (subcommand === "toggle") {
      const user = interaction.options.getUser("user");
      const reason =
        interaction.options.getString("reason") || "No reason provided";

      // Check if blacklisted
      const isBlacklisted = await new Promise((resolve, reject) => {
        db.get(`SELECT id FROM blacklist WHERE id = ?`, [user.id], (err, row) =>
          err ? reject(err) : resolve(!!row)
        );
      });

      if (isBlacklisted) {
        await new Promise((resolve, reject) => {
          db.run(`DELETE FROM blacklist WHERE id = ?`, [user.id], (err) =>
            err ? reject(err) : resolve()
          );
        });

        return interaction.reply({
          content: `✅ <@${user.id}> has been removed from the blacklist.`,
          flags: 64,
        });
      } else {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO blacklist (id, username, added_at, reason) VALUES (?, ?, ?, ?)`,
            [user.id, user.username, Date.now(), reason],
            (err) => (err ? reject(err) : resolve())
          );
        });

        return interaction.reply({
          content: `🚫 <@${user.id}> has been blacklisted.\n**Reason:** ${reason}`,
          flags: 64,
        });
      }
    }
  },
};
