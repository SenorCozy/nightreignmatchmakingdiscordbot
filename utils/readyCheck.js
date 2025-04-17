const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");

const searchCommand = require("../commands/search"); // Adjust path if needed
const { cleanupMatch } = require("./matchmakingUtils/matchUtils");
const { removePlayerFromMatch } = require("./playerUtils");

async function initiateReadyCheck(thread, players) {
  const readyPlayers = new Set();
  const timeLimit = 180000; // 3 minutes
  const warningIntervals = [120000, 60000, 10000]; // 2 min, 1 min, 10 sec
  function isValidThread(thread) {
    return thread?.guild && thread.isThread();
  }

  const platform = await new Promise((resolve, reject) => {
    db.get(
      `SELECT platform FROM players WHERE id = ?`,
      [players[0]],
      (err, row) => {
        if (err) {
          logger.error("Error fetching platform:", err.message);
          return reject(err);
        }
        resolve(row?.platform);
      }
    );
  });

  if (!platform) {
    await thread.send("❌ Could not determine platform for the match.");
    return;
  }
  if (!isValidThread(thread)) return;
  await thread.send(
    `🟢 **Ready Check Started!**\n${players
      .map((id) => `<@${id}>`)
      .join(
        ", "
      )}\nYou have **3 minutes** to respond or you'll be **kicked and replaced.**`
  );

  const button = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("confirm_ready")
      .setLabel("I'm Ready!")
      .setStyle(ButtonStyle.Success)
  );
  if (!isValidThread(thread)) return;
  await thread.send({
    content: "Click below or use `/ready` to confirm.",
    components: [button],
  });

  const collector = thread.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeLimit,
    filter: (i) => i.customId === "confirm_ready",
  });

  collector.on("collect", async (i) => {
    if (!players.includes(i.user.id)) {
      return i.reply({ content: "You're not part of this match.", flags: 64 });
    }

    readyPlayers.add(i.user.id);
    await i.reply({ content: "✅ You are marked as ready!", flags: 64 });
  });

  warningIntervals.reverse().forEach((interval, index) => {
    setTimeout(() => {
      const unready = players.filter((p) => !readyPlayers.has(p));
      if (unready.length) {
        const timeLeft =
          index === 0 ? "10 seconds" : index === 1 ? "1 minute" : "2 minutes";
        if (!isValidThread(thread)) return;
        thread.send(
          `⏳ **${timeLeft} remaining!** Waiting on: ${unready
            .map((id) => `<@${id}>`)
            .join(", ")}`
        );
      }
    }, timeLimit - interval);
  });

  collector.on("end", async () => {
    const guild = thread.guild;
    const activePlayers = players.filter((id) => guild.members.cache.has(id));
    const unready = activePlayers.filter((id) => !readyPlayers.has(id));

    if (unready.length === activePlayers.length) {
      if (!isValidThread(thread)) return;
      await thread.send("❌ No one responded. Match will be closed.");
      const voiceChannelId = await getVoiceId(thread.id);
      return cleanupMatch({ thread, voiceChannelId });
    }

    if (unready.length) {
      if (!isValidThread(thread)) return;
      await thread.send(
        `⛔ Kicking unresponsive players: ${unready
          .map((id) => `<@${id}>`)
          .join(", ")}`
      );

      const voiceChannelId = await getVoiceId(thread.id);

      for (const id of unready) {
        await removePlayerFromMatch(id, thread.id).catch(() => {});
        await thread.members.remove(id).catch(() => {});
        await thread.permissionOverwrites
          .edit(id, { ViewChannel: false, SendMessages: false })
          .catch(() => {});

        if (voiceChannelId) {
          const vc = guild.channels.cache.get(voiceChannelId);
          if (vc) {
            await vc.permissionOverwrites
              .edit(id, { ViewChannel: false, Connect: false, Speak: false })
              .catch(() => {});
            await vc.members
              .get(id)
              ?.voice.disconnect()
              .catch(() => {});
          }
        }
      }

      const enoughSubs = await new Promise((resolve, reject) => {
        db.get(
          `SELECT COUNT(*) as count FROM players WHERE platform = ? AND status = 'queued'`,
          [platform],
          (err, row) =>
            err ? reject(err) : resolve(row.count >= unready.length)
        );
      });

      if (enoughSubs) {
        if (!isValidThread(thread)) return;

        await thread.send(
          `🔍 Searching for ${unready.length} replacement(s)...`
        );

        await searchCommand.searchForPlayers(thread, unready.length);
      } else {
        if (!isValidThread(thread)) return;

        await thread.send("⚠️ Not enough replacements available.");
      }
    }

    const playerCount = await new Promise((resolve, reject) => {
      db.get(
        `SELECT playerIds FROM channels WHERE threadId = ?`,
        [thread.id],
        (err, row) =>
          err ? reject(err) : resolve(row?.playerIds?.split(",").length || 0)
      );
    });

    if (playerCount >= 3) {
      if (!isValidThread(thread)) return;

      await thread.send("✅ All players are ready. Match continues!");
    }
  });
}

async function getVoiceId(threadId) {
  return await new Promise((resolve, reject) => {
    db.get(
      `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
      [threadId],
      (err, row) => (err ? reject(err) : resolve(row?.voiceChannelId || null))
    );
  });
}

module.exports = { initiateReadyCheck };
