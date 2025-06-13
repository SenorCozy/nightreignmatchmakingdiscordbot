const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
} = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const { safeSend } = require("../utils/matchmakingUtils/matchUtils");
const {
  activeKickVotes,
  kickCollectors,
  voteMessages,
} = require("../utils/matchVoteState");

const kickCooldowns = new Map(); // key = `${thread.id}:${userId}` => timestamp
const KICK_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

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
    const cooldownKey = thread.id;
    const lastKickTime = kickCooldowns.get(cooldownKey);
    const now = Date.now();

    if (lastKickTime && now - lastKickTime < KICK_COOLDOWN_MS) {
      const remainingSec = Math.ceil(
        (KICK_COOLDOWN_MS - (now - lastKickTime)) / 1000
      );
      return interaction.reply({
        content: `⏳ A kick vote was recently started in this thread. Please wait **${remainingSec}** seconds before initiating another.`,
        flags: 64,
      });
    }

    // Set new cooldown timestamp for this thread
    kickCooldowns.set(cooldownKey, now);

    const isKickActive = [...activeKickVotes.keys()].some((key) =>
      key.startsWith(`${thread.id}:`)
    );
    if (isKickActive) {
      return interaction.reply({
        content: "⚠️ A kick vote is already in progress. Please wait.",
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
        content: "❌ Failed to retrieve match data.",
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
        content: "❌ Failed to retrieve player list.",
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

    const voteKey = `${thread.id}:${playerId}`;
    const voters = new Set([initiatorId]);
    activeKickVotes.set(voteKey, voters);

    const kickButton = new ButtonBuilder()
      .setCustomId(`confirm_kick_${playerId}`)
      .setLabel(`Kick ${target.username}`)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(false);

    const row = new ActionRowBuilder().addComponents(kickButton);

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

      const voteMessage = await safeSend(thread, {
        embeds: [embed],
        components: [row],
      });

      voteMessages.set(voteKey, voteMessage);

      const collector = thread.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
        filter: (i) =>
          i.customId === `confirm_kick_${playerId}` &&
          playerIds.includes(i.user.id) &&
          !activeKickVotes.get(voteKey)?.has(i.user.id),
      });

      kickCollectors.set(voteKey, collector);

      collector.on("collect", async (btn) => {
        try {
          voters.add(btn.user.id);
          activeKickVotes.set(voteKey, voters);
          await btn.deferUpdate().catch(() => {});

          if (voters.size >= 2) {
            collector.stop("confirmed");
            const { finalizeKick } = require("./confirm_kick");
            await finalizeKick({
              thread,
              match_id: match.match_id,
              targetId: playerId,
              voteKey,
            });
          } else {
            await safeSend(
              thread,
              `🗳️ Kick vote updated. (${voters.size}/2 confirmations to remove <@${playerId}>)`
            );
          }
        } catch (err) {
          logger.errorWrapper("kickCollector collect error", err, { voteKey });
        }
      });

      collector.on("end", async (_, reason) => {
        if (reason === "confirmed") return;

        activeKickVotes.delete(voteKey);
        kickCollectors.delete(voteKey);
        voteMessages.delete(voteKey);

        if (voteMessage?.editable) {
          try {
            const btn = voteMessage.components?.[0]?.components?.[0];
            if (btn) {
              const disabled = ButtonBuilder.from(btn).setDisabled(true);
              const disabledRow = new ActionRowBuilder().addComponents(
                disabled
              );
              await voteMessage.edit({ components: [disabledRow] });
            }
          } catch (err) {
            logger.warn("⚠️ Failed to disable expired kick button", {
              voteKey,
              error: err.message,
            });
          }
        }

        await safeSend(
          thread,
          `⌛ Kick vote for <@${playerId}> expired with insufficient votes.`
        );
      });
    } catch (err) {
      logger.errorWrapper("Error sending kick vote UI", err, { voteKey });
    }
  },
};
