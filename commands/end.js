const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const db = require("../database");
const { cleanupMatch } = require("../utils/matchmakingUtils/matchUtils");

require("dotenv").config();

const ALLOWED_ROLE_IDS = [
  process.env.TICKET_HANDLER_ROLE,
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
  process.env.BOT_ROLE,
].filter(Boolean);

function hasModRole(member) {
  return ALLOWED_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("end")
    .setDescription(
      "End the current match and clean up players, thread, and voice"
    ),

  async execute(interaction) {
    try {
      const thread = interaction.channel;

      if (!thread?.isThread()) {
        return interaction.reply({
          content: "❌ You can only use this command inside a match thread.",
          flags: 64,
        });
      }

      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT match_id, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!match?.match_id) {
        return interaction.reply({
          content: "❌ No active match found for this thread.",
          flags: 64,
        });
      }

      const { match_id, voiceChannelId } = match;

      const activePlayers = await new Promise((resolve, reject) => {
        db.all(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id],
          (err, rows) =>
            err ? reject(err) : resolve(rows.map((r) => r.playerId))
        );
      });

      if (activePlayers.length === 0) {
        return interaction.reply({
          content: "⚠️ No active players found for this match.",
          flags: 64,
        });
      }

      // ✅ Moderator override
      if (hasModRole(interaction.member)) {
        await thread.send("✅ Match will end shortly...");

        for (let i = 5; i > 0; i--) {
          const stillExists = await thread.guild.channels
            .fetch(thread.id)
            .catch(() => null);
          if (!stillExists) return;

          await thread.send(`**${i}...**`).catch(() => {});
          await new Promise((r) => setTimeout(r, 1000));
        }

        const stillExists = await thread.guild.channels
          .fetch(thread.id)
          .catch(() => null);
        if (!stillExists) return;

        await cleanupMatch({
          thread,
          voiceChannelId,
          closedByUserOrBot: interaction.user,
          closureReason: "Manually ended by moderator via /end",
        });
        return;
      }

      // 🗳️ Player vote-based ending
      await interaction.reply({
        content: `🗳️ <@${interaction.user.id}> has requested to end the match.\nA second player must confirm to proceed.`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("confirm_match_end")
              .setLabel("Confirm Match End")
              .setStyle(ButtonStyle.Danger)
          ),
        ],
        flags: 64,
      });

      const collectedUsers = new Set([interaction.user.id]);

      const collector = thread.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      collector.on("collect", async (btnInteraction) => {
        if (!activePlayers.includes(btnInteraction.user.id)) {
          return btnInteraction.reply({
            content: "❌ You are not part of this match and cannot confirm.",
            flags: 64,
          });
        }

        collectedUsers.add(btnInteraction.user.id);

        if (collectedUsers.size >= 2) {
          collector.stop();

          await thread.send(
            "✅ Vote passed. Match will end in **5 seconds**..."
          );

          for (let i = 5; i > 0; i--) {
            const stillExists = await thread.guild.channels
              .fetch(thread.id)
              .catch(() => null);
            if (!stillExists) return;

            await thread.send(`**${i}...**`).catch(() => {});
            await new Promise((r) => setTimeout(r, 1000));
          }

          const stillExists = await thread.guild.channels
            .fetch(thread.id)
            .catch(() => null);
          if (!stillExists) return;

          await cleanupMatch({
            thread,
            voiceChannelId,
            closedByUserOrBot: btnInteraction.user,
            closureReason: "Match ended via player vote (/end)",
          });
        } else {
          await btnInteraction
            .reply({
              content: `Confirmation received. (${collectedUsers.size}/2 confirmed)`,
              flags: 64,
            })
            .catch(() => {});
        }
      });

      collector.on("end", async () => {
        if (collectedUsers.size < 2) {
          const stillExists = await thread.guild.channels
            .fetch(thread.id)
            .catch(() => null);
          if (stillExists) {
            await thread
              .send(
                "⚠️ Match end vote expired with insufficient confirmations."
              )
              .catch(() => {});
          }
        }
      });
    } catch (error) {
      console.error("❌ Error executing /end:", error);
      return interaction.reply({
        content: "❌ An unexpected error occurred. Please try again.",
        flags: 64,
      });
    }
  },
};
