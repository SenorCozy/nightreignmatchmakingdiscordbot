const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const { NIGHTLORD_CHOICES } = require("../utils/nightlordSelect");

const MODERATOR_ROLE_IDS = [
  process.env.TICKET_HANDLER_ROLE,
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
].filter(Boolean);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("update")
    .setDescription("Update Nightlord preferences for the current match")
    .addSubcommand((sub) =>
      sub
        .setName("nightlords")
        .setDescription(
          "Change the bosses you're willing to fight for this match"
        )
    ),

  async execute(interaction) {
    const thread = interaction.channel;
    const userId = interaction.user.id;

    if (!thread?.isThread()) {
      return interaction.reply({
        content: "❌ This command must be used inside a match thread.",
        flags: 64,
      });
    }

    try {
      const match = await db.getAsync(
        `SELECT match_id, shared_nightlords FROM matches WHERE thread_id = ?`,
        [thread.id]
      );

      if (!match) {
        return interaction.reply({
          content: "❌ No active match found for this thread.",
          flags: 64,
        });
      }

      const member = await interaction.guild.members.fetch(userId);
      const isMod = member.roles.cache.some((role) =>
        MODERATOR_ROLE_IDS.includes(role.id)
      );

      const isActivePlayer = await db.getAsync(
        `SELECT 1 FROM match_players WHERE match_id = ? AND playerId = ? AND status = 'active'`,
        [match.match_id, userId]
      );

      if (!isMod && !isActivePlayer) {
        return interaction.reply({
          content:
            "❌ You must be an active participant or a moderator to update preferences.",
          flags: 64,
        });
      }

      const nightlordSelect = new StringSelectMenuBuilder()
        .setCustomId("update_shared_nightlords")
        .setPlaceholder("Select the Nightlords you're willing to fight")
        .setMinValues(1)
        .setMaxValues(NIGHTLORD_CHOICES.length)
        .addOptions(NIGHTLORD_CHOICES);

      const row = new ActionRowBuilder().addComponents(nightlordSelect);

      return interaction.reply({
        content: "🧿 Choose the updated Nightlords for this match:",
        components: [row],
        flags: 64,
      });
    } catch (err) {
      logger.errorWrapper("❌ Error executing /update nightlords", err, {
        userId,
        threadId: thread.id,
      });

      return interaction.reply({
        content: "❌ Failed to start preference update.",
        flags: 64,
      });
    }
  },
};
