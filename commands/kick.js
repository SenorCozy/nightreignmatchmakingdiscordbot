const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const { safeSend } = require("../utils/matchmakingUtils/matchUtils");
const { activeKickVotes, kickCollectors } = require("../utils/matchVoteState");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Initiate a vote to kick a player from the current match")
    .addUserOption((option) =>
      option
        .setName("player")
        .setDescription("Player to vote out")
        .setRequired(true)
    ),

  async execute(interaction) {
    const thread = interaction.channel;
    const initiatorId = interaction.user.id;
    const target = interaction.options.getUser("player");
    const playerId = target.id;

    if (!thread?.isThread()) {
      return interaction.reply({
        content: "❌ You can only use `/kick` inside an active match thread.",
        flags: 64,
      });
    }

    let match;
    try {
      match = await db.getAsync(
        `SELECT match_id FROM channels WHERE threadId = ?`,
        [thread.id]
      );
    } catch (err) {
      logger.errorWrapper("DB error retrieving match_id in /kick", err, {
        threadId: thread.id,
      });
      return interaction.reply({
        content: "❌ Failed to retrieve match data. Please try again later.",
        flags: 64,
      });
    }

    if (!match?.match_id) {
      return interaction.reply({
        content: "❌ This match no longer exists.",
        flags: 64,
      });
    }

    let playerIds;
    try {
      const rows = await db.allAsync(
        `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
        [match.match_id]
      );
      playerIds = rows.map((r) => r.playerId);
    } catch (err) {
      logger.errorWrapper("DB error retrieving match_players in /kick", err, {
        match_id: match.match_id,
      });
      return interaction.reply({
        content: "❌ Failed to retrieve player list. Please try again later.",
        flags: 64,
      });
    }

    if (!playerIds.includes(playerId)) {
      return interaction.reply({
        content: "❌ That player is not part of this match.",
        flags: 64,
      });
    }

    if (playerIds.length <= 2) {
      return interaction.reply({
        content: "⚠️ You cannot kick the last remaining player.",
        flags: 64,
      });
    }

    // ✅ Track vote state
    const voteKey = `${thread.id}:${playerId}`;
    if (!activeKickVotes.has(voteKey)) {
      const initiatorVoteSet = new Set([initiatorId]);
      activeKickVotes.set(voteKey, initiatorVoteSet);

      const timeout = setTimeout(async () => {
        if (activeKickVotes.has(voteKey)) {
          activeKickVotes.delete(voteKey);
          kickCollectors.delete(voteKey);
          await safeSend(
            thread,
            `⌛ Kick vote for <@${playerId}> expired with insufficient confirmations.`
          );
        }
      }, 60000);

      kickCollectors.set(voteKey, { stop: () => clearTimeout(timeout) });
    }

    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm_kick_${playerId}`)
        .setLabel(`Kick ${target.username}`)
        .setStyle(ButtonStyle.Danger)
    );

    const embed = new EmbedBuilder()
      .setColor("Red")
      .setTitle("🗳️ Kick Vote Started")
      .setDescription(
        `A vote to kick <@${playerId}> has been started by <@${initiatorId}>.\n\n` +
          `**2 players must confirm to proceed.**\n\n` +
          `✅ Current votes: **1/2**`
      )
      .setFooter({ text: "You have 60 seconds to respond." });

    try {
      await interaction.reply({
        content: "Kick vote initiated.",
        flags: 64,
      });

      await safeSend(thread, {
        embeds: [embed],
        components: [button],
      });
    } catch (err) {
      logger.errorWrapper("Failed to send consolidated vote message", err);
    }
  },
};
