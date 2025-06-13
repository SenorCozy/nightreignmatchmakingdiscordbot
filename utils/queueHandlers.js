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
const { showDuoPreferenceMenus } = require("../utils/showDuoPreferenceMenus");
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
const { pendingDuoQueue } = require("../state/pendingDuoQueue");

const { enforceQueueCooldown } = require("../utils/queueCooldown");
async function processSoloQueuePostActions(playerId, platform) {
  try {
    await evaluateEventProgress(playerId, "queue_entries", 1);
    await evaluateEventProgress(playerId, "solo_queues", 1);

    await updateQueueStatistics(playerId, platform, "solo");
    await incrementBotStatistic("total_queue_entries");
    await incrementBotStatistic(`queue_entries_${platform}`);
    await trackUniqueUser(playerId);
  } catch (err) {
    logger.errorWrapper("processSoloQueuePostActions", err, { playerId });
  }
}

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

      if (player?.status === "queued") {
        let queueType = "Solo";
        if (player.duoPartner) queueType = "Duo";
        if (player.trioPartner1 && player.trioPartner2) queueType = "Trio";

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

      // Player exists but is not currently queued or active (e.g. 'left', 'removed'), continue below.
    }

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO players (id, platform, status, queue_entered_at)
         VALUES (?, ?, 'queued', ?)
         ON CONFLICT(id) DO UPDATE SET 
           platform = excluded.platform, 
           status = excluded.status, 
           queue_entered_at = excluded.queue_entered_at`,
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

    // 🧠 Defer post-queue logic
    processSoloQueuePostActions(playerId, platform);
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
      let queueType = "Solo";
      if (player.duoPartner) queueType = "Duo";
      if (player.trioPartner1 && player.trioPartner2) queueType = "Trio";

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
            .setLabel("Partner's Unique Discord Username")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("Example: cozycat")
        )
      );

    return await interaction.showModal(modal); // ✅ Must be first and only reply
  } catch (error) {
    logger.errorWrapper("❌ handleDuoQueue failed", error, { playerId });

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ An error occurred while preparing your duo queue.",
        flags: 64,
      });
    }
  }
}

async function handleDuoQueueModal(interaction) {
  const playerId = interaction.user.id;
  const platform = playerPlatformSelection[playerId];

  let friendUsername = interaction.fields
    .getTextInputValue("duo_partner_username")
    .trim()
    .toLowerCase();

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

  let friend =
    interaction.guild.members.cache.find(
      (m) => m.user.username.toLowerCase() === friendUsername
    ) ?? null;

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
    return interaction.reply({
      content: `❌ Could not find a user named **${friendUsername}**.\nMake sure they’re in this server and their username is typed exactly.`,
      flags: 64,
    });
  }

  const friendId = friend.id;

  if (friendId === playerId) {
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

  const isBlacklisted = await db.getAsync(
    `SELECT id FROM blacklist WHERE id = ?`,
    [friendId]
  );
  if (isBlacklisted) {
    return interaction.reply({
      content: `🚫 <@${friendId}> is blacklisted and cannot join the queue.`,
      flags: 64,
    });
  }

  const [initiator, partner] = await Promise.all([
    getPlayerById(playerId),
    getPlayerById(friendId),
  ]);

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

  const REQUIRED_ROLE_ID = process.env.NIGHTREIGN_ROLE;
  const duoMembers = [
    { id: playerId, tag: interaction.user.tag },
    { id: friendId, tag: friend.user.tag },
  ];

  for (const memberData of duoMembers) {
    try {
      const member = await interaction.guild.members.fetch(memberData.id);

      if (!member.roles.cache.has(REQUIRED_ROLE_ID)) {
        await member.roles.add(REQUIRED_ROLE_ID);
        logger.info("🔐 Assigned required role for queue access", {
          playerId: memberData.id,
          roleId: REQUIRED_ROLE_ID,
        });
      }
    } catch (err) {
      logger.errorWrapper("❌ Failed to assign required queue role", err, {
        playerId: memberData.id,
        roleId: REQUIRED_ROLE_ID,
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: `❌ I couldn’t assign the required role to <@${memberData.id}>. Please contact a moderator.`,
            flags: 64,
          })
          .catch(() => {});
      }

      return;
    }
  }

  // 🧠 Store temporary state for post-preference insertion
  pendingDuoQueue.set(playerId, {
    friendId,
    platform,
    timestamp: Date.now(),
  });
  pendingDuoQueue.set(friendId, {
    friendId: playerId,
    platform,
    timestamp: Date.now(),
  });

  logger.info("✅ Duo queue validated, awaiting preferences", {
    initiator: interaction.user.tag,
    partner: friend.user.tag,
    platform,
  });

  await showDuoPreferenceMenus(playerId, friendId, interaction);
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
      let queueType = "Solo";
      if (player.duoPartner) queueType = "Duo";
      if (player.trioPartner1 && player.trioPartner2) queueType = "Trio";

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

    // ✅ Modal must be the first and only response
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

    return await interaction.showModal(modal); // ✅ First and only response
  } catch (error) {
    logger.errorWrapper("❌ handleTrioQueue failed", error, { playerId });

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ An error occurred while preparing your trio queue.",
          flags: 64,
        });
      }
    } catch {}
  }
}

async function postProcessTrioQueue(playerIds, platform) {
  try {
    await updateTrioPartnerStatistics(playerIds);
    await incrementBotStatistic("total_queue_entries", playerIds.length);
    await incrementBotStatistic(`queue_entries_${platform}`, playerIds.length);
    await incrementBotStatistic("queue_entries_trio", playerIds.length); // ✅ fix here

    for (const id of playerIds) {
      await updateQueueStatistics(id, platform, "trio"); // ✅ one per player, increments by 1
      await trackUniqueUser(id);

      const others = playerIds.filter((x) => x !== id);
      await evaluateEventProgress(id, "queue_entries", 1);
      await evaluateEventProgress(id, "trio_queues", 1);
      await evaluateEventProgress(id, "play_with_user", {
        partnerIds: others,
      });
    }
  } catch (err) {
    logger.errorWrapper("postProcessTrioQueue", err, {
      playerIds,
      platform,
    });
  }
}

async function handleTrioQueueModal(interaction) {
  const playerId = interaction.user.id;
  const platform = playerPlatformSelection[playerId];
  const now = Date.now();

  await interaction.deferReply({ flags: 64 }); // ✅ Defer first

  try {
    const partner1Username = interaction.fields
      .getTextInputValue("trio_partner_1")
      .trim()
      .toLowerCase();
    const partner2Username = interaction.fields
      .getTextInputValue("trio_partner_2")
      .trim()
      .toLowerCase();

    if (
      partner1Username === partner2Username ||
      [partner1Username, partner2Username].includes(
        interaction.user.username.toLowerCase()
      )
    ) {
      return interaction.editReply({
        content: "❌ Please enter two **different** teammates, not yourself.",
      });
    }

    if (!platform) {
      return interaction.editReply({
        content: "❌ Platform not found. Please try again.",
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
      return interaction.editReply({
        content: `❌ Could not find one or both teammates. Make sure usernames are correct and they are in the server.`,
      });
    }

    if ([member1.user.bot, member2.user.bot].includes(true)) {
      return interaction.editReply({
        content: "🤖 You cannot queue with bots as teammates.",
      });
    }

    for (const id of partnerIds) {
      const isBlacklisted = await db.getAsync(
        `SELECT 1 FROM blacklist WHERE id = ?`,
        [id]
      );
      if (isBlacklisted) {
        return interaction.editReply({
          content: `🚫 <@${id}> is blacklisted and cannot join the queue.`,
        });
      }
    }

    const allIds = [playerId, ...partnerIds];
    const players = await Promise.all(allIds.map((id) => getPlayerById(id)));
    for (const [i, p] of players.entries()) {
      if (p?.status === "active") {
        return interaction.editReply({
          content: `<@${allIds[i]}> is already in an active match.`,
        });
      }
    }

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
      return interaction.editReply({
        content:
          "⚠️ One or more members are already in an active trio. Please resolve or wait before creating a new trio queue.",
      });
    }

    const REQUIRED_ROLE_ID = process.env.NIGHTREIGN_ROLE;

    for (const id of allIds) {
      try {
        const member = await interaction.guild.members.fetch(id);
        if (!member.roles.cache.has(REQUIRED_ROLE_ID)) {
          await member.roles.add(REQUIRED_ROLE_ID);
          logger.info("🔐 Assigned required role for queue access", {
            playerId: id,
            roleId: REQUIRED_ROLE_ID,
          });
        }
      } catch (err) {
        logger.errorWrapper("❌ Failed to assign required queue role", err, {
          playerId: id,
          roleId: REQUIRED_ROLE_ID,
        });

        if (id === playerId) {
          await interaction.editReply({
            content:
              "❌ I couldn’t assign you the required role to join matchmaking. Please contact a moderator.",
          });
        }

        return;
      }
    }

    const trioId = crypto.randomUUID();
    await db.runAsync(
      `INSERT INTO trio_partner_groups 
       (trio_id, player1_id, player2_id, player3_id, created_at, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [trioId, playerId, partnerIds[0], partnerIds[1], now]
    );

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
    }

    postProcessTrioQueue(allIds, platform);

    const queuePosition = await getQueuePosition(playerId, platform);
    const avgWaitTime = await calculateAverageQueueTime(platform, "trio");

    logger.info("✅ Trio queue success", {
      initiator: interaction.user.tag,
      partner1: member1.user.tag,
      partner2: member2.user.tag,
      platform,
    });

    return interaction.editReply({
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
    });
  } catch (error) {
    logger.errorWrapper("handleTrioQueueModal", error, {
      playerId,
      usernames: {
        partner1: interaction.fields?.getTextInputValue("trio_partner_1"),
        partner2: interaction.fields?.getTextInputValue("trio_partner_2"),
      },
    });

    return interaction.editReply({
      content: "❌ An error occurred while processing your trio queue request.",
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
