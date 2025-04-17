const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const db = require("../database");

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
        content: "You can only use `/kick` inside an active match thread.",
        flags: 64,
      });
    }

    const playerId = target.id;

    const match = await new Promise((resolve, reject) => {
      db.get(
        `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
        [thread.id],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    if (!match) {
      return interaction.reply({
        content: "This match no longer exists.",
        flags: 64,
      });
    }

    let playerIds = match.playerIds.split(",").filter(Boolean);

    if (!playerIds.includes(playerId)) {
      return interaction.reply({
        content: "That player is not part of this match.",
        flags: 64,
      });
    }

    if (playerIds.length <= 2) {
      return interaction.reply({
        content: "You cannot kick the last remaining player.",
        flags: 64,
      });
    }

    await interaction.reply({
      content: `A vote to kick <@${playerId}> has started. 2/3 players must vote to remove them.`,
    });

    const voteMessage = await thread.send({
      content: `Kick vote initiated by <@${interaction.user.id}>.`,
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
      if (!playerIds.includes(i.user.id) || i.user.id === playerId) {
        return i
          .reply({
            content:
              "You can't vote to kick yourself or you're not in the match.",
            flags: 64,
          })
          .catch(() => {});
      }

      collectedVotes.add(i.user.id);

      if (collectedVotes.size >= 2) {
        collector.stop();

        await thread.send(`✅ <@${playerId}> has been kicked from the match.`);
        logger.info(
          `✅ Player ${playerId} kicked from match thread ${thread.id} by vote.`
        );

        // Update match player list
        playerIds = playerIds.filter((id) => id !== playerId);
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
            [playerIds.join(","), thread.id],
            (err) => (err ? reject(err) : resolve())
          );
        });

        // Remove from DB if not queued
        await new Promise((resolve, reject) => {
          db.run(
            `DELETE FROM players WHERE id = ? AND status != 'queued'`,
            [playerId],
            (err) => (err ? reject(err) : resolve())
          );
        });

        // Remove from thread and permissions
        try {
          await thread.members.remove(playerId);
        } catch (err) {
          logger.warn(`⚠️ Could not remove player ${playerId}: ${err.message}`);
        }

        try {
          await thread.permissionOverwrites.edit(playerId, {
            ViewChannel: false,
          });
        } catch (err) {
          logger.warn(`⚠️ Could not update thread permissions: ${err.message}`);
        }

        // VC permissions
        if (match.voiceChannelId) {
          const vc = await thread.guild.channels
            .fetch(match.voiceChannelId)
            .catch(() => null);
          if (vc) {
            try {
              await vc.permissionOverwrites.edit(playerId, {
                ViewChannel: false,
                Connect: false,
              });
              logger.info(`✅ VC permissions removed for ${playerId}`);
            } catch (err) {
              logger.warn(`⚠️ Could not update VC perms: ${err.message}`);
            }
          } else {
            logger.warn(
              `⚠️ Voice channel ${match.voiceChannelId} not found when kicking ${playerId}`
            );
          }
        }

        await thread.send("🔍 Starting search for a replacement player...");
        await searchForPlayers(thread, 1);
      } else {
        i.reply({
          content: `Vote registered. (${collectedVotes.size}/2 confirmations)`,
          flags: 64,
        }).catch(() => {});
      }
    });

    collector.on("end", (collected) => {
      if (collectedVotes.size < 2) {
        thread.send("Vote to kick expired with insufficient confirmations.");
      }
    });
  },
};
