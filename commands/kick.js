const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const db = require("../database");
const { removePlayerFromMatch } = require("../utils/playerUtils");
const { searchForPlayers } = require("./search");

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
    const target = interaction.options.getUser("player");

    if (!thread?.isThread()) {
      return interaction.reply({
        content: "❌ You can only use `/kick` inside an active match thread.",
        flags: 64,
      });
    }

    const playerId = target.id;

    const match = await new Promise((resolve, reject) => {
      db.get(
        `SELECT match_id, voiceChannelId FROM channels WHERE threadId = ?`,
        [thread.id],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    if (!match?.match_id) {
      return interaction.reply({
        content: "❌ This match no longer exists.",
        flags: 64,
      });
    }

    const playerIds = await new Promise((resolve, reject) => {
      db.all(
        `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
        [match.match_id],
        (err, rows) =>
          err ? reject(err) : resolve(rows.map((r) => r.playerId))
      );
    });

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

    await interaction.reply({
      content: `🗳️ A vote to kick <@${playerId}> has started. 2 players must confirm to proceed.`,
      flags: 64,
    });

    const voteMessage = await thread.send({
      content: `Vote to kick initiated by <@${interaction.user.id}>.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_kick_${playerId}`)
            .setLabel(`Kick ${target.username}`)
            .setStyle(ButtonStyle.Danger)
        ),
      ],
    });

    const collectedVotes = new Set();

    const collector = voteMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
    });

    collector.on("collect", async (i) => {
      try {
        if (!playerIds.includes(i.user.id) || i.user.id === playerId) {
          return i.reply({
            content:
              "🚫 You can't vote to kick yourself or you're not in the match.",
            flags: 64,
          });
        }

        if (collectedVotes.has(i.user.id)) {
          return i.reply({
            content: "⚠️ You've already voted.",
            flags: 64,
          });
        }

        collectedVotes.add(i.user.id);
        await i.deferUpdate();

        if (collectedVotes.size >= 2) {
          collector.stop();

          const inProgress = await new Promise((resolve, reject) => {
            db.get(
              `SELECT leave_in_progress FROM match_players WHERE match_id = ? AND playerId = ?`,
              [match.match_id, playerId],
              (err, row) =>
                err ? reject(err) : resolve(row?.leave_in_progress === 1)
            );
          });

          if (inProgress) {
            return thread.send("⚠️ Kick already in progress for this player.");
          }

          await db.run(
            `UPDATE match_players SET leave_in_progress = 1 WHERE match_id = ? AND playerId = ?`,
            [match.match_id, playerId]
          );

          await db.run(
            `UPDATE match_players SET status = 'removed' WHERE match_id = ? AND playerId = ?`,
            [match.match_id, playerId]
          );

          await db.run(
            `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
             VALUES (?, ?, ?, 'kick', ?, ?, ?)`,
            [
              match.match_id,
              thread.id,
              playerId,
              Date.now(),
              `Vote initiated by ${interaction.user.id}`,
              "kicked_via_vote",
            ]
          );

          await removePlayerFromMatch(playerId, thread.id, "kicked_via_vote");

          await thread.members.remove(playerId).catch(() => {});

          if (match.voiceChannelId) {
            const vc = thread.guild.channels.cache.get(match.voiceChannelId);
            if (vc) {
              await vc.permissionOverwrites
                .edit(playerId, {
                  ViewChannel: false,
                  Connect: false,
                })
                .catch(() => {});
            }
          }

          await db.run(
            `UPDATE match_players SET leave_in_progress = 0 WHERE match_id = ? AND playerId = ?`,
            [match.match_id, playerId]
          );

          await thread.send("🔍 Searching for a replacement player...");
          await searchForPlayers(thread, 1);
        } else {
          i.followUp({
            content: `🗳️ Vote registered. (${collectedVotes.size}/2 confirmations)`,
            flags: 64,
          }).catch(() => {});
        }
      } catch (err) {
        console.error("❌ Error during kick vote:", err);
        thread.send("❌ Something went wrong during the kick process.");
      }
    });

    collector.on("end", () => {
      if (collectedVotes.size < 2) {
        thread.send("⏳ Kick vote expired with insufficient confirmations.");
      }
    });
  },
};
