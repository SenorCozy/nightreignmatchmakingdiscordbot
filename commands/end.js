const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");

require("dotenv").config();
const { hasQueueModRole } = require("../utils/permissions");

const ALLOWED_ROLE_IDS = [
  process.env.TICKET_HANDLER_ROLE,
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
];

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

      // Fetch match data
      const match = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!match) {
        return interaction.reply({
          content: "❌ No active match found for this thread.",
          flags: 64,
        });
      }

      const { playerIds, voiceChannelId } = match;
      const players = playerIds.split(",");

      // Role-based override
      const canForceEnd = hasModRole(interaction.member);

      if (canForceEnd) {
        await interaction.reply("⏳ Match will end in **10 seconds**...");

        for (let i = 10; i > 0; i--) {
          await thread.send(`**${i}...**`).catch(() => {});
          await new Promise((r) => setTimeout(r, 1000));
        }

        await cleanupMatch({ thread, voiceChannelId });
        return;
      }

      // Vote flow
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
      });

      const collectedUsers = new Set([interaction.user.id]);

      const collector = thread.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      collector.on("collect", async (buttonInteraction) => {
        if (!players.includes(buttonInteraction.user.id)) {
          return buttonInteraction.reply({
            content: "❌ You are not part of this match and cannot confirm.",
            flags: 64,
          });
        }

        collectedUsers.add(buttonInteraction.user.id);

        if (collectedUsers.size >= 2) {
          collector.stop();

          await thread.send(
            "✅ Vote passed. Match will end in **10 seconds**..."
          );
          for (let i = 10; i > 0; i--) {
            await thread.send(`**${i}...**`).catch(() => {});
            await new Promise((r) => setTimeout(r, 1000));
          }

          await cleanupMatch({ thread, voiceChannelId });
        } else {
          await buttonInteraction
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
      logger.error("❌ Error executing /end:", error);
      return interaction.reply({
        content: "❌ An unexpected error occurred. Please try again.",
        flags: 64,
      });
    }
  },
};
