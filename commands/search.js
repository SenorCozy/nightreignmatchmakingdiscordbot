const { SlashCommandBuilder } = require("discord.js");
const db = require("../database");

async function searchForPlayers(thread, requestedPlayers, interaction = null) {
  try {
    if (!thread?.isThread()) {
      const msg = "❌ This command must be used inside an active match thread.";
      if (interaction) {
        return interaction.reply({ content: msg, flags: 64 });
      } else {
        await thread.send(msg);
        return;
      }
    }

    // Fetch match
    const match = await new Promise((resolve, reject) => {
      db.get(
        `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
        [thread.id],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    if (!match) {
      const msg = "❌ This match no longer exists.";
      if (interaction) {
        return interaction.reply({ content: msg, flags: 64 });
      } else {
        await thread.send(msg);
        return;
      }
    }

    let playerIds = match.playerIds.split(",").filter(Boolean);
    const maxPlayers = 3;

    if (playerIds.length >= maxPlayers) {
      const msg = "⚠️ This match already has 3 players.";
      if (interaction) {
        return interaction.reply({ content: msg, flags: 64 });
      } else {
        await thread.send(msg);
        return;
      }
    }

    const remainingSlots = maxPlayers - playerIds.length;
    const neededPlayers = Math.min(requestedPlayers, remainingSlots);

    // Get platform of first player
    const platform = await new Promise((resolve, reject) => {
      db.get(
        `SELECT platform FROM players WHERE id = ?`,
        [playerIds[0]],
        (err, row) => (err ? reject(err) : resolve(row?.platform || null))
      );
    });

    if (!platform) {
      const msg = "❌ Error retrieving platform type.";
      if (interaction) {
        return interaction.reply({ content: msg, flags: 64 });
      } else {
        await thread.send(msg);
        return;
      }
    }

    // Fetch queued players
    const queuedPlayers = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id FROM players WHERE platform = ? AND status = 'queued' ORDER BY queue_entered_at ASC LIMIT ?`,
        [platform, neededPlayers],
        (err, rows) => (err ? reject(err) : resolve(rows.map((row) => row.id)))
      );
    });

    if (!queuedPlayers || queuedPlayers.length === 0) {
      const msg = "❌ No replacement players found.";
      if (interaction) {
        return interaction.reply({ content: msg, flags: 64 });
      } else {
        await thread.send(msg);
        return;
      }
    }

    // Update DB
    playerIds.push(...queuedPlayers);
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE channels SET playerIds = ? WHERE threadId = ?`,
        [playerIds.join(","), thread.id],
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Add to thread and update permissions
    for (const playerId of queuedPlayers) {
      try {
        await thread.members.add(playerId);
        const member = await thread.guild.members.fetch(playerId);

        if (!thread.members.cache.has(playerId)) {
          await thread.permissionOverwrites.edit(playerId, {
            ViewChannel: true,
            SendMessages: true,
          });
        }

        if (match.voiceChannelId) {
          const vc = thread.guild.channels.cache.get(match.voiceChannelId);
          if (vc) {
            await vc.permissionOverwrites.edit(playerId, {
              ViewChannel: true,
              Connect: true,
              Speak: true,
            });
          }
        }
      } catch (err) {
        logger.error(`❌ Error adding ${playerId}: ${err.message}`);
      }
    }

    const mentions = queuedPlayers.map((id) => `<@${id}>`).join(", ");
    const responseMsg = `✅ Successfully added ${mentions} to the match.`;

    if (interaction) {
      await interaction.reply(responseMsg);
    } else {
      await thread.send(responseMsg);
    }
  } catch (error) {
    logger.error(`❌ Error in searchForPlayers: ${error.message}`, error.stack);
    const msg = "❌ An error occurred while searching for players.";
    if (interaction) {
      return interaction.reply({ content: msg, flags: 64 });
    } else {
      await thread.send(msg);
    }
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription(
      "Pull 1 or 2 players from the queue into your active match thread"
    )
    .addIntegerOption((option) =>
      option
        .setName("count")
        .setDescription("Number of players to pull (1 or 2)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(2)
    ),

  async execute(interaction) {
    const count = interaction.options.getInteger("count");
    await searchForPlayers(interaction.channel, count, interaction);
  },

  searchForPlayers,
};
