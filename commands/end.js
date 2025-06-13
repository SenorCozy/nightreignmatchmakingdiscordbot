// commands/end.js
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const db = require("../database");
const {
  cleanupMatch,
  safeSend,
} = require("../utils/matchmakingUtils/matchUtils");
const logger = require("../logger");

require("dotenv").config();

const ALLOWED_ROLE_IDS = [
  process.env.TICKET_HANDLER_ROLE,
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
  process.env.BOT_ROLE,
].filter(Boolean);

const activeMatchEndVotes = new Map(); // threadId -> Set of userIds
const matchEndCollectors = new Map(); // threadId -> Collector

function hasModRole(member) {
  return ALLOWED_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId));
}

async function safeFetchChannel(guild, threadId) {
  return await guild.channels.fetch(threadId).catch(() => null);
}

async function countdown(thread, seconds = 5) {
  for (let i = seconds; i > 0; i--) {
    const stillExists = await safeFetchChannel(thread.guild, thread.id);
    if (!stillExists) return false;
    await safeSend(thread, `**${i}...**`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  return true;
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
      const userId = interaction.user.id;

      if (!thread?.isThread()) {
        return interaction.reply({
          content: "❌ This command must be used inside a match thread.",
          flags: 64,
        });
      }

      let match;
      try {
        match = await db.getAsync(
          `SELECT match_id, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id]
        );
      } catch (err) {
        logger.errorWrapper("DB error fetching match in /end", err, {
          threadId: thread.id,
        });
        return interaction.reply({
          content: "❌ Failed to retrieve match data.",
          flags: 64,
        });
      }

      if (!match?.match_id) {
        return interaction.reply({
          content: "❌ No active match found for this thread.",
          flags: 64,
        });
      }

      const { match_id, voiceChannelId } = match;

      let activePlayers = [];
      try {
        const rows = await db.allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id]
        );
        activePlayers = rows.map((r) => r.playerId);
      } catch (err) {
        logger.errorWrapper("DB error fetching match_players in /end", err, {
          match_id,
        });
        return interaction.reply({
          content: "❌ Could not load player list.",
          flags: 64,
        });
      }

      // Moderator override
      if (hasModRole(interaction.member)) {
        try {
          await interaction.deferReply({ flags: 64 });
          await safeSend(
            thread,
            "✅ Match will end shortly (moderator override)..."
          );
          const proceed = await countdown(thread);
          if (proceed) {
            await cleanupMatch({
              thread,
              voiceChannelId,
              closedByUserOrBot: interaction.user,
              closureReason: "Manually ended by moderator via /end",
            });
          }
        } catch (err) {
          logger.errorWrapper("Error during mod override cleanupMatch", err);
        }

        activeMatchEndVotes.delete(thread.id);
        matchEndCollectors.delete(thread.id);
        return;
      }

      if (!activePlayers.includes(userId)) {
        return interaction.reply({
          content: "❌ You are not a participant in this match.",
          flags: 64,
        });
      }

      // If only one player is left active, allow immediate closure
      if (activePlayers.length === 1 && activePlayers[0] === userId) {
        await interaction.deferReply({ flags: 64 });
        await safeSend(thread, "☑️ Only one player remains. Closing match...");
        const proceed = await countdown(thread);
        if (proceed) {
          await cleanupMatch({
            thread,
            voiceChannelId,
            closedByUserOrBot: interaction.user,
            closureReason:
              "Match ended automatically (only one player remained)",
          });
        }

        activeMatchEndVotes.delete(thread.id);
        matchEndCollectors.delete(thread.id);
        return;
      }

      // Existing vote
      if (activeMatchEndVotes.has(thread.id)) {
        const voteSet = activeMatchEndVotes.get(thread.id);
        if (voteSet.has(userId)) {
          return interaction.reply({
            content: "✅ You’ve already voted. Waiting for others.",
            flags: 64,
          });
        }

        voteSet.add(userId);
        return interaction.reply({
          content: `📝 A vote is already in progress. You’ve been added. (${voteSet.size}/2 confirmed)`,
          flags: 64,
        });
      }

      // New vote
      const voteSet = new Set([userId]);
      activeMatchEndVotes.set(thread.id, voteSet);

      if (matchEndCollectors.has(thread.id)) {
        matchEndCollectors.get(thread.id).stop("replaced");
      }

      try {
        await safeSend(
          thread,
          `📣 <@${userId}> has initiated a vote to end the match. One more player must confirm.`
        );
      } catch (err) {
        logger.errorWrapper("Failed to announce vote in /end", err);
      }

      await interaction.reply({
        content: `🗳️ Vote started by <@${userId}>. Confirm with the button below.`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("confirm_match_end")
              .setLabel("Confirm Match End")
              .setStyle(ButtonStyle.Danger)
          ),
        ],
      });

      const collector = thread.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
        filter: (btn) =>
          btn.customId === "confirm_match_end" &&
          activeMatchEndVotes.has(thread.id) &&
          activePlayers.includes(btn.user.id),
      });

      matchEndCollectors.set(thread.id, collector);

      collector.on("collect", async (btn) => {
        try {
          if (btn.customId !== "confirm_match_end") return;

          if (!activePlayers.includes(btn.user.id)) {
            return btn.reply({
              content: "❌ You are not a valid participant.",
              flags: 64,
            });
          }

          const currentVotes = activeMatchEndVotes.get(thread.id);
          if (currentVotes.has(btn.user.id)) {
            return btn.reply({
              content: "✅ You already confirmed.",
              flags: 64,
            });
          }

          currentVotes.add(btn.user.id);
          await btn.deferUpdate();

          await safeSend(
            thread,
            `🔔 Vote confirmed by <@${btn.user.id}> (${currentVotes.size}/2)`
          );

          if (currentVotes.size >= 2) {
            collector.stop("success");
            await safeSend(
              thread,
              "✅ Vote passed. Match will end in 5 seconds..."
            );
            const proceed = await countdown(thread);
            if (proceed) {
              await cleanupMatch({
                thread,
                voiceChannelId,
                closedByUserOrBot: btn.user,
                closureReason: "Match ended via player vote (/end)",
              });
            }
            activeMatchEndVotes.delete(thread.id);
            matchEndCollectors.delete(thread.id);
          }
        } catch (err) {
          logger.errorWrapper("Error in /end vote collection handler", err);
        }
      });

      collector.on("end", async (_, reason) => {
        try {
          if (reason === "success") return;
          if (activeMatchEndVotes.has(thread.id)) {
            activeMatchEndVotes.delete(thread.id);
            matchEndCollectors.delete(thread.id);
            await safeSend(
              thread,
              "❌ Match vote expired without enough confirmations."
            );
          }
        } catch (err) {
          logger.errorWrapper("Error in /end vote expiration handler", err);
        }
      });
    } catch (error) {
      logger.errorWrapper("matchEndCommand", error);
      return interaction.reply({
        content: "❌ An unexpected error occurred. Please try again.",
        flags: 64,
      });
    }
  },
};
