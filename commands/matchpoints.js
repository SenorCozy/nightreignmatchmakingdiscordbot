const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const {
  getMatchCompletionPoints,
  updateMatchCompletionRoles,
} = require("../utils/rewardUtils");

const MOD_ROLE_IDS = [
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
  process.env.ELDER_TICKET_HANDLER_ROLE,
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("matchpoints")
    .setDescription("Manage or view match completion points (mods only)")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add points to a player")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Target player").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("points")
            .setDescription("Points to add")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove points from a player")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Target player").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("points")
            .setDescription("Points to remove")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("reset")
        .setDescription("Reset a player’s points to 0")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Target player").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("audit")
        .setDescription("View audit history for a player")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Target player").setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser("user");
    const playerId = user.id;
    const executorId = interaction.user.id;

    const member = interaction.guild.members.cache.get(executorId);
    if (!MOD_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId))) {
      return interaction.reply({
        content: "❌ You do not have permission to use this command.",
        flags: 64,
      });
    }

    if (sub === "audit") {
      const logs = await db.allAsync(
        `SELECT match_id, awarded_at, points, action_type, modified_by
           FROM match_completion_awards
           WHERE player_id = ?
           ORDER BY awarded_at DESC`,
        [playerId]
      );

      if (!logs.length) {
        return interaction.reply({
          content: `ℹ️ No audit history found for <@${playerId}>.`,
          flags: 64,
        });
      }

      let page = 0;
      const PAGE_SIZE = 5;
      const totalPages = Math.ceil(logs.length / PAGE_SIZE);

      const getPageEmbed = () => {
        const chunk = logs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        return {
          title: `📜 Match Point Audit: ${user.username}`,
          description: chunk
            .map((log) => {
              const date = new Date(log.awarded_at).toLocaleString();
              const mod = log.modified_by ? `<@${log.modified_by}>` : "System";
              return `**[${log.action_type || "system"}]** +${
                log.points
              } pts on ${date} by ${mod}`;
            })
            .join("\n"),
          footer: {
            text: `Page ${page + 1} of ${totalPages}`,
          },
        };
      };

      const buttons = () =>
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("prev")
            .setLabel("◀️ Prev")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId("next")
            .setLabel("Next ▶️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
        );

      const reply = await interaction.reply({
        embeds: [getPageEmbed()],
        components: [buttons()],
        flags: 64,
        fetchReply: true,
      });

      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60_000,
      });

      collector.on("collect", async (btnInt) => {
        if (btnInt.user.id !== executorId) return btnInt.deferUpdate();
        if (btnInt.customId === "prev") page--;
        if (btnInt.customId === "next") page++;

        await btnInt.update({
          embeds: [getPageEmbed()],
          components: [buttons()],
        });
      });

      return;
    }

    try {
      if (sub === "add" || sub === "remove") {
        const amount = interaction.options.getInteger("points");
        const signed = sub === "add" ? amount : -amount;

        await db.runAsync(
          `INSERT INTO match_completion_awards 
             (match_id, player_id, awarded_at, points, modified_by, action_type)
             VALUES (?, ?, ?, ?, ?, ?)`,
          [
            `manual_${Date.now()}`,
            playerId,
            Date.now(),
            signed,
            executorId,
            sub,
          ]
        );
      }

      if (sub === "reset") {
        await db.runAsync(
          `DELETE FROM match_completion_awards WHERE player_id = ?`,
          [playerId]
        );
        await db.runAsync(
          `INSERT INTO match_completion_awards 
             (match_id, player_id, awarded_at, points, modified_by, action_type)
             VALUES (?, ?, ?, ?, ?, ?)`,
          [
            `manual_reset_${Date.now()}`,
            playerId,
            Date.now(),
            0,
            executorId,
            "reset",
          ]
        );
      }

      const total = await getMatchCompletionPoints(playerId);
      await updateMatchCompletionRoles(
        interaction.guild.members.cache.get(playerId),
        interaction.guild // ✅ pass this too
      );

      return interaction.reply({
        content: `✅ Match points updated for <@${playerId}>. New total: **${total} pts**`,
        flags: 64,
      });
    } catch (err) {
      logger.errorWrapper("❌ matchpoints command failed", err, {
        playerId,
        sub,
        executorId,
      });

      return interaction.reply({
        content: "❌ An error occurred while processing this command.",
        flags: 64,
      });
    }
  },
};
