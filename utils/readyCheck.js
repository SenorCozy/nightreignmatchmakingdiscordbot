const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const db = require("../database");
const searchCommand = require("../commands/search");
const { cleanupMatch } = require("./matchmakingUtils/matchUtils");
const { removePlayerFromMatch } = require("./playerUtils");
const { trackFailedReadyCheck } = require("./playerstatshelper");

async function initiateReadyCheck(thread, players) {
  const readyPlayers = new Set();
  const timeLimit = 180000; // 3 minutes
  const warningIntervals = [120000, 60000, 10000]; // 2 min, 1 min, 10 sec

  const isValidThread = (t) => t?.guild && t.isThread();

  const sendWarningMessage = (t, unready, label) => {
    if (!isValidThread(t) || !unready.length) return;
    t.send(
      `⏳ **${label} remaining!** Waiting on: ${unready
        .map((id) => `<@${id}>`)
        .join(", ")}`
    );
  };

  // ✅ Fetch match_id
  const matchRow = await new Promise((resolve, reject) => {
    db.get(
      `SELECT match_id FROM matches WHERE thread_id = ?`,
      [thread.id],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
  const match_id = matchRow?.match_id;
  if (!match_id) {
    console.warn(`❌ No match_id found for thread ${thread.id}`);
    return;
  }

  // ✅ Infer platform
  const platform = await new Promise((resolve, reject) => {
    db.get(
      `SELECT platform FROM players WHERE id = ?`,
      [players[0]],
      (err, row) => (err ? reject(err) : resolve(row?.platform))
    );
  });

  if (!platform || !isValidThread(thread)) return;

  // ✅ Ready Check Message + Button
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

    await i.deferUpdate(); // ✅ Acknowledge the button press immediately

    readyPlayers.add(i.user.id);

    try {
      db.run(
        `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
         VALUES (?, ?, ?, 'ready_confirmed', ?, ?, 'ready_passed')`,
        [
          match_id,
          thread.id,
          i.user.id,
          Date.now(),
          "Confirmed during ready check",
        ]
      );
    } catch (err) {
      console.error("❌ Failed to insert ready_passed event:", err);
    }

    await thread.send({ content: `✅ <@${i.user.id}> is marked as ready!` });
  });

  // ⏳ Countdown Warnings
  warningIntervals.reverse().forEach((ms, i) => {
    const label = i === 0 ? "10 seconds" : i === 1 ? "1 minute" : "2 minutes";
    setTimeout(() => {
      const unready = players.filter((id) => !readyPlayers.has(id));
      sendWarningMessage(thread, unready, label);
    }, timeLimit - ms);
  });

  // 🚨 On Collector End
  collector.on("end", async () => {
    if (!isValidThread(thread)) return;

    const unready = players.filter((id) => !readyPlayers.has(id));

    if (unready.length === players.length) {
      await thread.send("❌ No one responded. Match will be closed.");
      const voiceChannelId = await getVoiceId(thread.id);
      return cleanupMatch({ thread, voiceChannelId });
    }

    if (unready.length > 0) {
      await thread.send(
        `⛔ Kicking unresponsive players: ${unready
          .map((id) => `<@${id}>`)
          .join(", ")}`
      );
      const voiceChannelId = await getVoiceId(thread.id);

      for (const id of unready) {
        const isLeaving = await new Promise((resolve, reject) => {
          db.get(
            `SELECT leave_in_progress FROM match_players WHERE threadId = ? AND playerId = ?`,
            [thread.id, id],
            (err, row) =>
              err ? reject(err) : resolve(row?.leave_in_progress === 1)
          );
        });
        if (isLeaving) continue;

        await db.run(
          `UPDATE match_players SET leave_in_progress = 1 WHERE threadId = ? AND playerId = ?`,
          [thread.id, id]
        );

        await db.run(
          `UPDATE match_players SET status = 'removed' WHERE threadId = ? AND playerId = ?`,
          [thread.id, id]
        );

        try {
          db.run(
            `INSERT INTO match_events (match_id, threadId, playerId, eventType, timestamp, reason, final_status)
             VALUES (?, ?, ?, 'ready_check_fail', ?, ?, 'ready_failed')`,
            [
              match_id,
              thread.id,
              id,
              Date.now(),
              "Unresponsive during ready check",
            ]
          );
        } catch (err) {
          console.error("❌ Failed to insert ready_check_fail event:", err);
        }

        await trackFailedReadyCheck(id).catch(() => {});
        await removePlayerFromMatch(id, thread.id, "ready_failed").catch(
          () => {}
        );

        await thread.members.remove(id).catch(() => {});

        try {
          if (voiceChannelId) {
            const vc = thread.guild.channels.cache.get(voiceChannelId);
            if (vc) {
              try {
                await vc.permissionOverwrites.edit(id, {
                  ViewChannel: false,
                  Connect: false,
                  Speak: false,
                });
              } catch (err) {
                console.warn(
                  `⚠️ Failed to update VC perms for ${id}: ${err.message}`
                );
              }

              try {
                const member = vc.members.get(id);
                if (member?.voice?.disconnect) {
                  await member.voice.disconnect();
                }
              } catch (err) {
                console.warn(
                  `⚠️ Failed to disconnect ${id} from VC: ${err.message}`
                );
              }
            }
          }
        } catch (vcErr) {
          console.error(
            `❌ Unexpected error with VC cleanup for ${id}:`,
            vcErr
          );
        }

        await db.run(
          `UPDATE match_players SET leave_in_progress = 0 WHERE threadId = ? AND playerId = ?`,
          [thread.id, id]
        );
      }

      const enoughSubs = await new Promise((resolve, reject) => {
        db.get(
          `SELECT COUNT(*) as count FROM players WHERE platform = ? AND status = 'queued'`,
          [platform],
          (err, row) =>
            err ? reject(err) : resolve(row?.count >= unready.length)
        );
      });

      if (enoughSubs) {
        await thread.send(
          `🔍 Searching for ${unready.length} replacement(s)...`
        );
        await searchCommand.searchForPlayers(thread, unready.length);
      } else {
        await thread.send("⚠️ Not enough replacements available.");
      }
    }

    const playerCount = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) AS count FROM match_players WHERE threadId = ? AND status = 'active'`,
        [thread.id],
        (err, row) => (err ? reject(err) : resolve(row?.count || 0))
      );
    });

    if (playerCount >= 3) {
      await thread.send("✅ All players are ready. Match continues!");
    }
  });
}

async function getVoiceId(threadId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT voiceChannelId FROM channels WHERE threadId = ?`,
      [threadId],
      (err, row) => (err ? reject(err) : resolve(row?.voiceChannelId || null))
    );
  });
}

module.exports = { initiateReadyCheck };
