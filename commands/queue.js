const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
require("dotenv").config();
const { hasModRole } = require("../utils/permissions");
const db = require("../database");

const {
  getQueuePosition,
  calculateAverageQueueTime,
} = require("../utils/playerUtils");

const platformAliases = {
  ps: "playstation",
  ps4: "playstation",
  ps5: "playstation",
  xbox: "xbox",
  x: "xbox",
  pc: "pc",
  steam: "pc",
};

const isQueueLocked = async () => {
  const value = await new Promise((resolve, reject) => {
    db.get(
      `SELECT value FROM settings WHERE key = 'queue_locked'`,
      [],
      (err, row) => (err ? reject(err) : resolve(row?.value || "0"))
    );
  });
  return parseInt(value) === 1;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Queue-related matchmaking commands")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a player to the matchmaking queue")
        .addUserOption((opt) =>
          opt
            .setName("user")
            .setDescription("Player to queue")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("platform")
            .setDescription("Platform")
            .setRequired(true)
            .addChoices(
              { name: "PC", value: "pc" },
              { name: "Xbox", value: "xbox" },
              { name: "PlayStation", value: "playstation" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List players currently in the queue")
    )
    .addSubcommand((sub) =>
      sub
        .setName("number")
        .setDescription("Show how many players are queued per platform")
    )
    .addSubcommand((sub) =>
      sub.setName("lock").setDescription("Disable queue entry (admin only)")
    )
    .addSubcommand((sub) =>
      sub.setName("unlock").setDescription("Enable queue entry (admin only)")
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Clear all players from the queue (admin only)")
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "list") {
      const queuedUsers = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id, platform FROM players WHERE status = 'queued'`,
          [],
          (err, rows) => (err ? reject(err) : resolve(rows))
        );
      });

      if (!queuedUsers.length) {
        return interaction.reply({
          content: "No players are currently in the queue.",
          flags: 64,
        });
      }

      const list = queuedUsers
        .map(
          (player, index) =>
            `${index + 1}. <@${
              player.id
            }> - **${player.platform.toUpperCase()}**`
        )
        .join("\n");

      return interaction.reply({
        content: `**Queued Players:**\n${list}`,
        flags: 64,
      });
    }
    if (["lock", "unlock"].includes(subcommand)) {
      if (!hasModRole(interaction.member)) {
        return interaction.reply({
          content: "🚫 You do not have permission to use this command.",
          flags: 64,
        });
      }

      const lockValue = subcommand === "lock" ? 1 : 0;

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO settings (key, value) VALUES ('queue_locked', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [lockValue],
          (err) => (err ? reject(err) : resolve())
        );
      });

      return interaction.reply({
        content: lockValue
          ? "🚫 Queue entry is now **disabled**."
          : "✅ Queue entry is now **enabled**.",
        flags: 64,
      });
    }

    if (subcommand === "clear") {
      if (!hasModRole(interaction.member)) {
        return interaction.reply({
          content: "🚫 You do not have permission to use this command.",
          flags: 64,
        });
      }

      await new Promise((resolve, reject) => {
        db.run(`DELETE FROM players WHERE status = 'queued'`, (err) =>
          err ? reject(err) : resolve()
        );
      });

      console.info(
        `🧹 Queue cleared by ${interaction.user.tag} (${interaction.user.id})`
      );

      return interaction.reply({
        content:
          "✅ **Queue has been cleared.** All players have been removed.",
        flags: 64,
      });
    }

    if (subcommand === "number") {
      const queueStats = await new Promise((resolve, reject) => {
        db.all(
          `SELECT platform, COUNT(*) AS count FROM players WHERE status = 'queued' GROUP BY platform`,
          [],
          (err, rows) => (err ? reject(err) : resolve(rows))
        );
      });

      const total = queueStats.reduce((acc, row) => acc + row.count, 0);

      let reply = `**Queue Stats:**\n`;
      for (const row of queueStats) {
        reply += `🔹 **${row.platform.toUpperCase()}**: ${row.count} players\n`;
      }

      reply += `\n**Total Players in Queue:** ${total}`;
      return interaction.reply({ content: reply, flags: 64 });
    }

    if (subcommand === "add") {
      const member = interaction.options.getUser("user");
      const playerId = member.id;
      const platform = interaction.options.getString("platform");

      // Check if queue is locked
      if (await isQueueLocked()) {
        return interaction.reply({
          content:
            "🚫 Queue is currently locked. Please wait until it’s reopened.",
          flags: 64,
        });
      }

      // Check if already queued
      const existing = await new Promise((resolve, reject) => {
        db.get(
          `SELECT status, duoPartner FROM players WHERE id = ?`,
          [playerId],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (existing?.status === "queued") {
        return interaction.reply({
          content: `🚫 <@${playerId}> is already in the queue.`,
          flags: 64,
        });
      }

      // Prevent queuing if duo partner already queued
      if (existing?.duoPartner) {
        const partnerQueued = await new Promise((resolve, reject) => {
          db.get(
            `SELECT status FROM players WHERE id = ?`,
            [existing.duoPartner],
            (err, row) => (err ? reject(err) : resolve(row?.status))
          );
        });

        if (partnerQueued === "queued") {
          return interaction.reply({
            content: `🚫 <@${playerId}> cannot queue while their duo partner <@${existing.duoPartner}> is in the queue.`,
            flags: 64,
          });
        }
      }

      // Blacklist check
      const blacklisted = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM blacklist WHERE id = ?`,
          [playerId],
          (err, row) => (err ? reject(err) : resolve(row ? true : false))
        );
      });

      if (blacklisted) {
        return interaction.reply({
          content: `🚫 <@${playerId}> is blacklisted and cannot enter the queue.`,
          flags: 64,
        });
      }

      // Prevent queuing if user is in an active match
      const activeMatch = await new Promise((resolve, reject) => {
        db.get(
          `SELECT 1 FROM match_players WHERE playerId = ? AND status = 'active'`,
          [playerId],
          (err, row) => (err ? reject(err) : resolve(!!row))
        );
      });

      if (activeMatch) {
        return interaction.reply({
          content: `🚫 <@${playerId}> is currently in an active match and cannot queue.`,
          flags: 64,
        });
      }

      // Insert into queue
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO players (id, platform, status, queue_entered_at)
             VALUES (?, ?, 'queued', ?)
             ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, status = excluded.status, queue_entered_at = excluded.queue_entered_at`,
          [playerId, platform, Date.now()],
          (err) => (err ? reject(err) : resolve())
        );
      });

      const queuePosition = await getQueuePosition(playerId, platform);
      const avgWaitTime = await calculateAverageQueueTime(platform, "solo");

      return interaction.reply({
        content:
          `✅ <@${playerId}> has been added to the **${platform.toUpperCase()}** queue.\n` +
          `**Queue Position:** ${queuePosition}\n` +
          `**Estimated Wait Time:** 🕒 ${Math.round(
            (avgWaitTime * queuePosition) / 60
          )} minutes.`,
        flags: 64,
      });
    }
  },
};
