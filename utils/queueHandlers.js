const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const { playerPlatformSelection } = require("../utils/globalState");

const {
  getPlayerById,
  getQueuePosition,
  calculateAverageQueueTime,
} = require("./playerUtils");

const {
  incrementBotStatistic,
  updateQueueStatistics,
  trackUniqueUser,
} = require("../utils/statistics");

const { runMatchmaking } = require("./matchmakingUtils/runMatchmaking");

const { enforceQueueCooldown } = require("../utils/queueCooldown");

async function handleSoloQueue(interaction) {
  const playerId = interaction.user.id;
  const platform = playerPlatformSelection[playerId];

  try {
    if (!platform) {
      return interaction.reply({
        content:
          "❌ Platform selection is missing. Please select your platform again.",
        flags: 64,
      });
    }

    await enforceQueueCooldown(playerId);

    const player = await getPlayerById(playerId);
    if (player) {
      if (player.status === "active") {
        return interaction.reply({
          content: `❌ You are currently in an active match on **${player.platform}**.`,
          flags: 64,
        });
      }

      const queueType = player.duoPartner ? "Duo" : "Solo";
      return interaction.reply({
        content: `You're already queued as **${queueType}** on **${player.platform}**.\nPlease leave the queue before changing your selection.`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("remove_from_queue")
              .setLabel("Leave Queue")
              .setStyle(ButtonStyle.Danger)
          ),
        ],
        flags: 64,
      });
    }

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO players (id, platform, status, queue_entered_at)
         VALUES (?, ?, 'queued', ?)
         ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, status = excluded.status, queue_entered_at = excluded.queue_entered_at`,
        [playerId, platform, Date.now()],
        (err) => (err ? reject(err) : resolve())
      );
    });

    const queuePosition = await getQueuePosition(playerId, platform);
    const avgWaitTime = await calculateAverageQueueTime(platform, "solo");

    await interaction.reply({
      content: `✅ You’ve joined the **Solo** queue on **${platform.toUpperCase()}**.\n**Position:** ${queuePosition}\n**Estimated Wait:** ${Math.round(
        (avgWaitTime * queuePosition) / 60000
      )} min`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("remove_from_queue")
            .setLabel("Leave Queue")
            .setStyle(ButtonStyle.Danger)
        ),
      ],
      flags: 64,
    });

    await updateQueueStatistics(playerId, platform, true);
    await incrementBotStatistic("total_queue_entries");
    await incrementBotStatistic(`queue_entries_${platform}`);
    await trackUniqueUser(playerId);
    await runMatchmaking();
  } catch (error) {
    logger.error("Error in handleSoloQueue:", error.message);
    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ An error occurred while joining the queue.",
        flags: 64,
      });
    }
  }
}

async function handleDuoQueue(interaction) {
  const playerId = interaction.user.id;
  const platform = playerPlatformSelection[playerId];

  try {
    const player = await getPlayerById(playerId);

    if (player && player.status === "active") {
      return interaction.reply({
        content: `You are currently in an active match on platform **${player.platform}**.`,
        flags: 64,
      });
    }

    if (player) {
      const queueType = player.duoPartner ? "Duo" : "Solo";
      return interaction.reply({
        content: `You're already queued as **${queueType}** on **${player.platform}**.\nPlease leave the queue before changing status.`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("remove_from_queue")
              .setLabel("Leave Queue")
              .setStyle(ButtonStyle.Danger)
          ),
        ],
        flags: 64,
      });
    }

    if (!platform) {
      return interaction.reply({
        content: "❌ Please select a platform first.",
        flags: 64,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId("duo_partner_modal")
      .setTitle("Enter Your Duo Partner's Username")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("duo_partner_username")
            .setLabel("Partner's Discord Username")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
  } catch (error) {
    logger.error("Error in handleDuoQueue:", error.message);
    await interaction.reply({
      content: "❌ An error occurred while preparing your duo queue.",
      flags: 64,
    });
  }
}

async function handleDuoQueueModal(interaction) {
  try {
    const playerId = interaction.user.id;
    const platform = playerPlatformSelection[playerId];
    const friendUsername = interaction.fields.getTextInputValue(
      "duo_partner_username"
    );

    if (!platform) {
      return interaction.reply({
        content: "❌ Platform not found. Please try again.",
        flags: 64,
      });
    }

    await enforceQueueCooldown(playerId);

    const friend = await interaction.guild.members
      .fetch({ query: friendUsername, limit: 1 })
      .then((members) =>
        members.find((m) => m.user.username === friendUsername)
      );

    if (!friend) {
      return interaction.reply({
        content:
          "❌ Friend not found. Make sure their username is correct and they are in this server.",
        flags: 64,
      });
    }

    const friendId = friend.id;
    const initiator = await getPlayerById(playerId);
    const partner = await getPlayerById(friendId);

    if (initiator?.status === "active") {
      return interaction.reply({
        content: "You're in an active match.",
        flags: 64,
      });
    }
    if (partner?.status === "active") {
      return interaction.reply({
        content: "Your partner is in an active match.",
        flags: 64,
      });
    }
    if (partner?.duoPartner && partner.duoPartner !== playerId) {
      return interaction.reply({
        content: "Your partner is already queued with someone else.",
        flags: 64,
      });
    }

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO players (id, platform, status, duoPartner, queue_entered_at) VALUES 
         (?, ?, 'queued', ?, ?), (?, ?, 'queued', ?, ?)`,
        [
          playerId,
          platform,
          friendId,
          Date.now(),
          friendId,
          platform,
          playerId,
          Date.now(),
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    await updateQueueStatistics(playerId, platform, false);
    await updateQueueStatistics(friendId, platform, false);
    await trackUniqueUser(playerId);
    await trackUniqueUser(friendId);

    const queuePosition = await getQueuePosition(playerId, platform);
    const avgWaitTime = await calculateAverageQueueTime(platform, "duo");

    return interaction.reply({
      content: `✅ You and <@${friendId}> have joined the **Duo** queue for **${platform.toUpperCase()}**.\n**Queue Position:** ${queuePosition}\n**Estimated Wait Time:** ${Math.round(
        avgWaitTime / 60000
      )} minutes.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("remove_from_queue")
            .setLabel("Leave Queue")
            .setStyle(ButtonStyle.Danger)
        ),
      ],
      flags: 64,
    });
  } catch (error) {
    logger.error("Error in handleDuoQueueModal:", error.message);
    return interaction.reply({
      content: "❌ An error occurred while processing your duo queue request.",
      flags: 64,
    });
  }
}

module.exports = {
  handleSoloQueue,
  handleDuoQueue,
  handleDuoQueueModal,
};
