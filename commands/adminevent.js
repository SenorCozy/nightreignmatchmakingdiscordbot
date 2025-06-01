// commands/admin/event.js
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");
const { v4: uuidv4 } = require("uuid");
const db = require("../database");
const logger = require("../logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Moderator commands.")
    .addSubcommand((sub) =>
      sub
        .setName("event")
        .setDescription("Create a new event.")
        .addStringOption((opt) =>
          opt.setName("name").setDescription("Event name").setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("event_type")
            .setDescription("Submission or progress-based?")
            .setRequired(true)
            .addChoices(
              { name: "Progress (auto-tracked)", value: "progress" },
              { name: "Submission (manual)", value: "submission" }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName("goal_type")
            .setDescription("What type of goal this event tracks.")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("goal_target")
            .setDescription("How many to complete the event")
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("reward")
            .setDescription("Currency reward upon completion")
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("duration_days")
            .setDescription("How many days the event should run")
            .setRequired(true)
        )
        // ✅ Optional options come after required ones

        .addStringOption((opt) =>
          opt.setName("description").setDescription("Optional description")
        )
        .addIntegerOption((opt) =>
          opt
            .setName("cooldown_minutes")
            .setDescription("Cooldown between progress increments (0 = none)")
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("eventtier")
        .setDescription("Add a tier to an existing event")
        .addStringOption((opt) =>
          opt.setName("event_id").setDescription("Event ID").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("tier_index")
            .setDescription("Tier number")
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("goal_target")
            .setDescription("Target for this tier")
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("reward")
            .setDescription("Reward for this tier")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("events").setDescription("List all current events")
    )
    .addSubcommand((sub) =>
      sub
        .setName("endevent")
        .setDescription("Mark an event as ended")
        .addStringOption((opt) =>
          opt
            .setName("event_id")
            .setDescription("Event ID to end")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("deleteevent")
        .setDescription("Delete an event completely")
        .addStringOption((opt) =>
          opt
            .setName("event_id")
            .setDescription("Event ID to delete")
            .setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const now = Date.now();

    try {
      if (subcommand === "event") {
        const name = interaction.options.getString("name");
        const goalType = interaction.options.getString("goal_type");
        const goalTarget = interaction.options.getInteger("goal_target");
        const reward = interaction.options.getInteger("reward");
        const durationDays = interaction.options.getInteger("duration_days");
        const description = interaction.options.getString("description") || "";
        const cooldownMinutes =
          interaction.options.getInteger("cooldown_minutes") || 0;
        const eventType =
          interaction.options.getString("event_type") || "progress";

        if (!["progress", "submission"].includes(eventType)) {
          return interaction.reply({
            content:
              "❌ Invalid event type. Choose 'progress' or 'submission'.",
            flags: 64,
          });
        }

        if (cooldownMinutes < 0 || cooldownMinutes > 1440) {
          return interaction.reply({
            content:
              "❌ Cooldown must be between 0 and 1440 minutes (24 hours).",
            flags: 64,
          });
        }

        const cooldownMs = cooldownMinutes * 60 * 1000;
        const start = now;
        const end = start + durationDays * 86400000;
        const eventId = uuidv4();

        await db.runAsync(
          `INSERT INTO events (
              event_id, name, description, goal_type, start_time, end_time,
              reward, goal_target, cooldown_ms, event_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            eventId,
            name,
            description,
            goalType,
            start,
            end,
            reward,
            goalTarget,
            cooldownMs,
            eventType,
          ]
        );

        logger.info(`✅ Created new ${eventType} event: ${name} (${eventId})`);

        return interaction.reply({
          content: `✅ Event **"${name}"** created as a **${eventType}** event.\nRuns until <t:${Math.floor(
            end / 1000
          )}:f>`,
          flags: 64,
        });
      }

      if (subcommand === "eventtier") {
        const eventId = interaction.options.getString("event_id");
        const tierIndex = interaction.options.getInteger("tier_index");
        const goalTarget = interaction.options.getInteger("goal_target");
        const reward = interaction.options.getInteger("reward");

        const tierId = `${eventId}-${tierIndex}`;

        await db.runAsync(
          `INSERT INTO event_tiers (tier_id, event_id, tier_index, goal_target, reward)
             VALUES (?, ?, ?, ?, ?)`,
          [tierId, eventId, tierIndex, goalTarget, reward]
        );

        return interaction.reply({
          content: `🎯 Tier ${tierIndex} added to event \`${eventId}\` (Target: ${goalTarget}, Reward: ${reward}).`,
          flags: 64,
        });
      }

      if (subcommand === "events") {
        const rows = await db.allAsync(`SELECT * FROM events`);
        if (rows.length === 0) {
          return interaction.reply({
            content: "📭 No events exist yet.",
            flags: 64,
          });
        }

        const embed = new EmbedBuilder()
          .setTitle("📋 All Events")
          .setColor(0xf4c542);

        for (const ev of rows) {
          embed.addFields({
            name: `🆔 ${ev.event_id}`,
            value: `**${ev.name}**\nGoal: \`${ev.goal_type}\` → ${
              ev.goal_target
            }\nReward: ${ev.reward}\nCooldown: ${
              ev.cooldown_ms
                ? `${Math.floor(ev.cooldown_ms / 60000)} min`
                : "None"
            }\nType: ${ev.event_type}\nStatus: ${
              ev.active ? "✅ Active" : "🛑 Inactive"
            }\nEnd: <t:${Math.floor(ev.end_time / 1000)}:R>`,
          });
        }

        return interaction.reply({ embeds: [embed], flags: 64 });
      }

      if (subcommand === "endevent") {
        const eventId = interaction.options.getString("event_id");
        await db.runAsync(`UPDATE events SET active = 0 WHERE event_id = ?`, [
          eventId,
        ]);
        return interaction.reply({
          content: `🛑 Event \`${eventId}\` marked as ended.`,
          flags: 64,
        });
      }

      if (subcommand === "deleteevent") {
        const eventId = interaction.options.getString("event_id");
        await db.runAsync(`DELETE FROM events WHERE event_id = ?`, [eventId]);
        await db.runAsync(`DELETE FROM event_progress WHERE event_id = ?`, [
          eventId,
        ]);
        return interaction.reply({
          content: `🗑️ Event \`${eventId}\` and related progress data deleted.`,
          flags: 64,
        });
      }
    } catch (err) {
      logger.errorWrapper("AdminEventCommandError", err);
      return interaction.reply({
        content: "❌ Something went wrong with the event command.",
        flags: 64,
      });
    }
  },
};
