const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const { playerPlatformSelection } = require("../utils/globalState");
const { evaluateEventProgress } = require("../utils/eventUtils");
const {
  getPlayerById,
  getQueuePosition,
  calculateAverageQueueTime,
} = require("./playerUtils");

const {
  updateDuoPartnerStatistics,
  updateTrioPartnerStatistics,
} = require("../utils/playerstatshelper");
const crypto = require("crypto");

const {
  incrementBotStatistic,
  updateQueueStatistics,
  trackUniqueUser,
} = require("../utils/statistics");

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

    const passedCooldown = await enforceQueueCooldown(playerId, interaction);
    if (!passedCooldown) return; // 🚫 STOP if user is on cooldown

    const player = await getPlayerById(playerId);

    if (player) {
      if (player.status === "active") {
        return interaction.reply({
          content: `❌ You are currently in an active match on **${player.platform}**.`,
          flags: 64,
        });
      }

      if (player.status === "queued") {
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
      // else: player exists but is not currently queued or active (e.g. 'left', 'removed'), continue to requeue them below.
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

    await db.runAsync(
      `INSERT INTO queue_history (playerId, platform, duoPartner, queue_entered_at)
       VALUES (?, ?, ?, ?)`,
      [playerId, platform, null, Date.now()]
    );

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
    // 🎯 Event Progress Tracking
    await evaluateEventProgress(playerId, "queue_entries", 1);
    await evaluateEventProgress(playerId, "solo_queues", 1);

    // Statistics updates
    await updateQueueStatistics(playerId, platform, "solo");
    await incrementBotStatistic("total_queue_entries");
    await incrementBotStatistic(`queue_entries_${platform}`);
    await trackUniqueUser(playerId);
  } catch (error) {
    logger.errorWrapper("handleSoloQueue", error, { playerId });
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

    if (player?.status === "active") {
      return interaction.reply({
        content: `❌ You are currently in an active match on **${player.platform}**.`,
        flags: 64,
      });
    }

    if (player?.status === "queued") {
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
      .setTitle("Enter Your Duo Partner's Discord Username")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("duo_partner_username")
            .setLabel("Partner's Unique discord name.")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("Provide duo partner's UNIQUE discord username")
        )
      );

    await interaction.showModal(modal);
  } catch (error) {
    logger.errorWrapper("handleDuoQueue", error, { playerId });
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

    let friendUsername = interaction.fields.getTextInputValue(
      "duo_partner_username"
    );
    friendUsername = friendUsername.trim().toLowerCase();

    if (friendUsername.length < 2) {
      return interaction.reply({
        content: "❌ Please enter at least 2 characters.",
        flags: 64,
      });
    }

    if (!platform) {
      return interaction.reply({
        content: "❌ Platform not found. Please try again.",
        flags: 64,
      });
    }

    const passedCooldown = await enforceQueueCooldown(playerId, interaction);
    if (!passedCooldown) return;

    // Attempt to find partner in cache first
    let friend = interaction.guild.members.cache.find(
      (m) => m.user.username.toLowerCase() === friendUsername
    );

    // If not in cache, fetch all members
    if (!friend) {
      try {
        await interaction.guild.members.fetch();
        friend = interaction.guild.members.cache.find(
          (m) => m.user.username.toLowerCase() === friendUsername
        );
      } catch (err) {
        logger.warn("⚠️ Failed to fetch guild members for fallback lookup", {
          error: err.message,
        });
      }
    }

    if (!friend) {
      logger.warn("Duo partner not found", {
        playerId,
        attemptedUsername: friendUsername,
      });
      return interaction.reply({
        content: `❌ Could not find a user named **${friendUsername}**.\nMake sure they’re in this server and their username is typed exactly.`,
        flags: 64,
      });
    }

    if (friend.id === playerId) {
      return interaction.reply({
        content: "❌ You cannot queue with yourself as your duo partner.",
        flags: 64,
      });
    }

    if (friend.user.bot) {
      return interaction.reply({
        content: "🤖 You cannot queue with a bot as your partner.",
        flags: 64,
      });
    }

    const friendId = friend.id;

    const isBlacklisted = await new Promise((resolve, reject) => {
      db.get(`SELECT id FROM blacklist WHERE id = ?`, [friendId], (err, row) =>
        err ? reject(err) : resolve(!!row)
      );
    });

    if (isBlacklisted) {
      return interaction.reply({
        content: `🚫 <@${friendId}> is blacklisted and cannot join the queue.`,
        flags: 64,
      });
    }

    const initiator = await getPlayerById(playerId);
    const partner = await getPlayerById(friendId);

    if (initiator?.status === "active") {
      return interaction.reply({
        content: "You're already in an active match.",
        flags: 64,
      });
    }

    if (partner?.status === "active") {
      return interaction.reply({
        content: "Your partner is in an active match.",
        flags: 64,
      });
    }

    if (
      initiator?.status === "queued" &&
      initiator.duoPartner &&
      initiator.duoPartner !== friendId
    ) {
      return interaction.reply({
        content: "You're already queued with someone else as your partner.",
        flags: 64,
      });
    }

    if (
      partner?.status === "queued" &&
      partner.duoPartner &&
      partner.duoPartner !== playerId
    ) {
      return interaction.reply({
        content: "Your partner is already queued with someone else.",
        flags: 64,
      });
    }

    const now = Date.now();

    await Promise.all([
      new Promise((resolve, reject) => {
        db.run(
          `INSERT OR REPLACE INTO players 
           (id, platform, status, duoPartner, queue_entered_at)
           VALUES (?, ?, 'queued', ?, ?)`,
          [playerId, platform, friendId, now],
          (err) => (err ? reject(err) : resolve())
        );
      }),
      new Promise((resolve, reject) => {
        db.run(
          `INSERT OR REPLACE INTO players 
           (id, platform, status, duoPartner, queue_entered_at)
           VALUES (?, ?, 'queued', ?, ?)`,
          [friendId, platform, playerId, now],
          (err) => (err ? reject(err) : resolve())
        );
      }),
    ]);

    await Promise.all([
      db.runAsync(
        `INSERT INTO queue_history (playerId, platform, duoPartner, queue_entered_at)
         VALUES (?, ?, ?, ?)`,
        [playerId, platform, friendId, now]
      ),
      db.runAsync(
        `INSERT INTO queue_history (playerId, platform, duoPartner, queue_entered_at)
         VALUES (?, ?, ?, ?)`,
        [friendId, platform, playerId, now]
      ),
    ]);

    await updateQueueStatistics(playerId, platform, "duo");
    await updateQueueStatistics(friendId, platform, "duo");

    await trackUniqueUser(playerId);
    await trackUniqueUser(friendId);
    await updateDuoPartnerStatistics(playerId, friendId);

    await evaluateEventProgress(playerId, "queue_entries", 1);
    await evaluateEventProgress(friendId, "queue_entries", 1);
    await evaluateEventProgress(playerId, "queue_duo", 1);
    await evaluateEventProgress(friendId, "queue_duo", 1);
    await evaluateEventProgress(playerId, "queue_with_user", {
      partnerId: friendId,
    });
    await evaluateEventProgress(friendId, "queue_with_user", {
      partnerId: playerId,
    });

    await incrementBotStatistic("total_queue_entries", 2);
    await incrementBotStatistic(`queue_entries_${platform}`, 2);
    await incrementBotStatistic("queue_entries_duo", 1);

    const queuePosition = await getQueuePosition(playerId, platform);
    const avgWaitTime = await calculateAverageQueueTime(platform, "duo");

    logger.info("✅ Duo queue success", {
      initiator: interaction.user.tag,
      partner: friend.user.tag,
      platform,
    });

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
    logger.errorWrapper("handleDuoQueueModal", error, {
      playerId: interaction.user.id,
      friendUsername: interaction.fields?.getTextInputValue(
        "duo_partner_username"
      ),
    });

    return interaction.reply({
      content: "❌ An error occurred while processing your duo queue request.",
      flags: 64,
    });
  }
}

async function handleTrioQueue(interaction) {
  const playerId = interaction.user.id;
  const platform = playerPlatformSelection[playerId];

  try {
    const player = await getPlayerById(playerId);

    if (player?.status === "active") {
      return interaction.reply({
        content: `❌ You are currently in an active match on **${player.platform}**.`,
        flags: 64,
      });
    }

    if (player?.status === "queued") {
      return interaction.reply({
        content: `You're already queued. Please leave the queue before changing status.`,
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
      .setCustomId("trio_partner_modal")
      .setTitle("Enter Your Two Teammates' Discord Usernames")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("trio_partner_1")
            .setLabel("Teammate 1 Unique Username")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("trio_partner_2")
            .setLabel("Teammate 2 Unique Username")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
  } catch (error) {
    logger.errorWrapper("handleTrioQueue", error, { playerId });
    await interaction.reply({
      content: "❌ An error occurred while preparing your trio queue.",
      flags: 64,
    });
  }
}

async function handleTrioQueueModal(interaction) {
  const playerId = interaction.user.id;
  const platform = playerPlatformSelection[playerId];
  const now = Date.now();

  try {
    const partner1Username = interaction.fields
      .getTextInputValue("trio_partner_1")
      .trim()
      .toLowerCase();
    const partner2Username = interaction.fields
      .getTextInputValue("trio_partner_2")
      .trim()
      .toLowerCase();

    // 🛑 Insert this right here:
    if (
      partner1Username === partner2Username ||
      [partner1Username, partner2Username].includes(
        interaction.user.username.toLowerCase()
      )
    ) {
      return interaction.reply({
        content: "❌ Please enter two **different** teammates, not yourself.",
        flags: 64,
      });
    }

    if (!platform) {
      return interaction.reply({
        content: "❌ Platform not found. Please try again.",
        flags: 64,
      });
    }

    const passedCooldown = await enforceQueueCooldown(playerId, interaction);
    if (!passedCooldown) return;

    await interaction.guild.members.fetch();
    const member1 = interaction.guild.members.cache.find(
      (m) => m.user.username.toLowerCase() === partner1Username
    );
    const member2 = interaction.guild.members.cache.find(
      (m) => m.user.username.toLowerCase() === partner2Username
    );

    const partnerIds = [member1?.id, member2?.id];

    if (!member1 || !member2 || partnerIds.includes(undefined)) {
      return interaction.reply({
        content: `❌ Could not find one or both teammates. Make sure usernames are correct and they are in the server.`,
        flags: 64,
      });
    }

    if ([member1.user.bot, member2.user.bot].includes(true)) {
      return interaction.reply({
        content: "🤖 You cannot queue with bots as teammates.",
        flags: 64,
      });
    }

    // Blacklist check
    for (const id of partnerIds) {
      const isBlacklisted = await db.getAsync(
        `SELECT 1 FROM blacklist WHERE id = ?`,
        [id]
      );
      if (isBlacklisted) {
        return interaction.reply({
          content: `🚫 <@${id}> is blacklisted and cannot join the queue.`,
          flags: 64,
        });
      }
    }

    const allIds = [playerId, ...partnerIds];
    const players = await Promise.all(allIds.map((id) => getPlayerById(id)));

    for (const [i, p] of players.entries()) {
      if (p?.status === "active") {
        return interaction.reply({
          content: `<@${allIds[i]}> is already in an active match.`,
          flags: 64,
        });
      }
    }
    const trioId = crypto.randomUUID();
    const existingTrio = await db.getAsync(
      `SELECT 1 FROM trio_partner_groups 
       WHERE active = 1 AND 
       (player1_id IN (?, ?, ?) OR player2_id IN (?, ?, ?) OR player3_id IN (?, ?, ?))`,
      [...allIds, ...allIds, ...allIds]
    );
    if (existingTrio) {
      logger.warn("⚠️ Prevented new trio queue due to existing active trio", {
        attempted: allIds,
      });
      return interaction.reply({
        content:
          "⚠️ One or more members are already in an active trio. Please resolve or wait before creating a new trio queue.",
        flags: 64,
      });
    }

    await db.runAsync(
      `INSERT INTO trio_partner_groups 
       (trio_id, player1_id, player2_id, player3_id, created_at, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [trioId, playerId, partnerIds[0], partnerIds[1], now]
    );

    // Insert all trio members into the queue
    for (const id of allIds) {
      await db.runAsync(
        `INSERT OR REPLACE INTO players (id, platform, status, queue_entered_at)
         VALUES (?, ?, 'queued', ?)`,
        [id, platform, now]
      );

      await db.runAsync(
        `INSERT INTO queue_history (playerId, platform, queue_entered_at)
         VALUES (?, ?, ?)`,
        [id, platform, now]
      );

      await db.runAsync(
        `INSERT INTO player_statistics (id, queue_entries_trio)
         VALUES (?, 1)
         ON CONFLICT(id) DO UPDATE SET queue_entries_trio = queue_entries_trio + 1`,
        [id]
      );

      await updateQueueStatistics(id, platform, "trio");

      await trackUniqueUser(id);
    }
    await updateTrioPartnerStatistics(allIds);
    await incrementBotStatistic("total_queue_entries", 3);
    await incrementBotStatistic(`queue_entries_${platform}`, 3);
    await incrementBotStatistic("queue_entries_trio", 1);

    for (const id of allIds) {
      const others = allIds.filter((x) => x !== id);

      await evaluateEventProgress(id, "queue_entries", 1);
      await evaluateEventProgress(id, "queue_trio", 1);
      await evaluateEventProgress(id, "queue_with_user", {
        partnerIds: others,
      });
    }

    const queuePosition = await getQueuePosition(playerId, platform);
    const avgWaitTime = await calculateAverageQueueTime(platform, "trio");

    logger.info("✅ Trio queue success", {
      initiator: interaction.user.tag,
      partner1: member1.user.tag,
      partner2: member2.user.tag,
      platform,
    });

    return interaction.reply({
      content:
        `✅ You, <@${partnerIds[0]}>, and <@${
          partnerIds[1]
        }> have joined the **Trio** queue for **${platform.toUpperCase()}**.` +
        `\n**Queue Position:** ${queuePosition}` +
        `\n**Estimated Wait Time:** ${Math.round(
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
    logger.errorWrapper("handleTrioQueueModal", error, {
      playerId,
      usernames: {
        partner1: interaction.fields?.getTextInputValue("trio_partner_1"),
        partner2: interaction.fields?.getTextInputValue("trio_partner_2"),
      },
    });

    return interaction.reply({
      content: "❌ An error occurred while processing your trio queue request.",
      flags: 64,
    });
  }
}

module.exports = {
  handleSoloQueue,
  handleDuoQueue,
  handleDuoQueueModal,
  handleTrioQueue,
  handleTrioQueueModal,
};
