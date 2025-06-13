const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const searchCommand = require("../commands/search");
const { cleanupMatch, safeSend } = require("./matchmakingUtils/matchUtils");
const { removePlayerFromMatch } = require("./playerUtils");
const { trackFailedReadyCheck } = require("./playerstatshelper");
const {
  getReadyPlayers,
  addReadyPlayer,
  endReadyCheck,
  getReadyCheckInitiator,
} = require("./readyCheckState");
const { evaluateEventProgress } = require("../utils/eventUtils");
const {
  unlockAchievementIfNotEarned,
  unlockStatThresholdAchievements,
  readyCheckAchievements,
} = require("../utils/achievementHelpers");

async function initiateReadyCheck(thread, players) {
  try {
    let statusMessage = null;

    const updateReadyStatus = async () => {
      if (!thread?.id || !thread.guild || !statusMessage?.editable) return;

      const ready = getReadyPlayers(thread.id);
      const total = players.length;
      const readyCount = players.filter((id) => ready.has(id)).length;
      const unready = players.filter((id) => !ready.has(id));

      const content =
        `✅ **Ready Status:** \`${readyCount} / ${total} players ready\`\n` +
        (unready.length
          ? `👥 Waiting on: ${unready.map((id) => `<@${id}>`).join(", ")}`
          : "🎉 Everyone is ready!");

      try {
        await statusMessage.edit({ content });
      } catch (err) {
        logger.warn("⚠️ Failed to update ready status message", {
          threadId: thread.id,
        });
      }
    };
    const timeLimit = 180000;
    const warningIntervals = [120000, 60000, 10000];
    const warningTimeouts = [];

    const initiator = getReadyCheckInitiator(thread.id);

    const isValidThread = (t) => t?.guild && t.isThread();
    const sendWarningMessage = async (t, unready, label) => {
      try {
        if (!isValidThread(t) || !unready.length) return;
        await safeSend(
          t,
          `⏳ **${label} remaining!** Waiting on: ${unready
            .map((id) => `<@${id}>`)
            .join(", ")}`
        );
      } catch (err) {
        logger.errorWrapper("ReadyCheck_WarningSendFailure", err, { label });
      }
    };

    const matchRow = await db.getAsync(
      `SELECT match_id FROM matches WHERE thread_id = ?`,
      [thread.id]
    );
    const match_id = matchRow?.match_id;
    if (!match_id) {
      logger.warn(`❌ No match_id found for thread ${thread.id}`);
      endReadyCheck(thread.id);
      return;
    }

    const platform = await db
      .getAsync(`SELECT platform FROM players WHERE id = ?`, [players[0]])
      .then((row) => row?.platform)
      .catch((err) => {
        logger.errorWrapper("ReadyCheck_PlatformFetchError", err);
        return null;
      });

    if (!platform || !isValidThread(thread)) {
      endReadyCheck(thread.id);
      return;
    }

    await safeSend(
      thread,
      `🟢 **Ready Check Started!**\n👤 Initiated by <@${initiator}>\n${players
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

    await safeSend(thread, {
      content: "Click below or use `/ready` to confirm.",
      components: [button],
    });

    statusMessage = await thread.send(
      "✅ **Ready Status:** `0 / " +
        players.length +
        " players ready`\n👥 Waiting on: " +
        players.map((id) => `<@${id}>`).join(", ")
    );

    const collector = thread.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: timeLimit,
      filter: (i) => i.customId === "confirm_ready",
    });

    collector.on("collect", async (i) => {
      try {
        if (!players.includes(i.user.id)) {
          return i.reply({
            content: "You're not part of this match.",
            flags: 64,
          });
        }

        const {
          handleReadyConfirmation,
        } = require("./handleReadyConfirmation");
        await i.deferUpdate().catch(() => {});
        await handleReadyConfirmation(thread, i.user.id, "collector", i);
        await updateReadyStatus();

        const readySet = getReadyPlayers(thread.id);
        const allReady = players.every((id) => readySet.has(id));
        if (allReady) {
          collector.stop("all_ready");
        }
      } catch (err) {
        logger.errorWrapper("ReadyCheck_CollectorError", err);
      }
    });

    warningIntervals.reverse().forEach((ms, i) => {
      const label = i === 0 ? "10 seconds" : i === 1 ? "1 minute" : "2 minutes";
      const timeoutId = setTimeout(() => {
        const unready = players.filter(
          (id) => !getReadyPlayers(thread.id).has(id)
        );
        sendWarningMessage(thread, unready, label);
      }, timeLimit - ms);
      warningTimeouts.push(timeoutId);
    });

    collector.on("end", async (_collected, reason) => {
      try {
        logger.info("🛑 Ready check ended", {
          threadId: thread.id,
          reason,
        });

        warningTimeouts.forEach(clearTimeout);
        if (!isValidThread(thread)) return;

        const readyPlayers = getReadyPlayers(thread.id);
        endReadyCheck(thread.id);

        const currentMemberIds = thread.members.cache.map((m) => m.id);
        const activePlayers = players.filter((id) =>
          currentMemberIds.includes(id)
        );
        const unready = activePlayers.filter((id) => !readyPlayers.has(id));
        const confirmedReady = activePlayers.filter((id) =>
          readyPlayers.has(id)
        );
        await statusMessage
          .edit({
            content: `✅ **Ready Check Concluded!**\n${confirmedReady.length} / ${players.length} players confirmed.`,
            components: [],
          })
          .catch((err) => {
            logger.warn("⚠️ Failed to edit ready status message on end", {
              threadId: thread.id,
              error: err.message,
            });
          });

        if (unready.length === activePlayers.length) {
          await safeSend(thread, "❌ No one responded. Match will be closed.");
          const voiceChannelId = await getVoiceId(thread.id);

          return cleanupMatch({ thread, voiceChannelId });
        }

        if (unready.length > 0) {
          await safeSend(
            thread,
            `⛔ Kicking unresponsive players: ${unready
              .map((id) => `<@${id}>`)
              .join(", ")}`
          );

          const voiceChannelId = await getVoiceId(thread.id);

          for (const id of unready) {
            try {
              const inProgress = await db.getAsync(
                `SELECT leave_in_progress FROM match_players WHERE threadId = ? AND playerId = ?`,
                [thread.id, id]
              );
              if (inProgress?.leave_in_progress) continue;

              await db.runAsync(
                `UPDATE match_players SET leave_in_progress = 1, status = 'removed' WHERE threadId = ? AND playerId = ?`,
                [thread.id, id]
              );

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

              await evaluateEventProgress(
                id,
                "ready_checks_clean",
                "disqualified",
                {
                  matchId: match_id,
                  disqualified: true,
                }
              );

              await trackFailedReadyCheck(id);
              await removePlayerFromMatch(id, thread.id, "ready_failed");
              await thread.members.remove(id).catch(() => {});

              const vc = thread.guild.channels.cache.get(voiceChannelId);
              if (vc) {
                await vc.permissionOverwrites.edit(id, {
                  ViewChannel: false,
                  Connect: false,
                  Speak: false,
                });

                const member = vc.members.get(id);
                if (member?.voice?.disconnect) {
                  await member.voice.disconnect().catch(() => {});
                }
              }

              await db.runAsync(
                `UPDATE match_players SET leave_in_progress = 0 WHERE threadId = ? AND playerId = ?`,
                [thread.id, id]
              );
            } catch (err) {
              logger.errorWrapper("ReadyCheck_KickFailure", err, {
                playerId: id,
              });
            }
          }

          const enoughSubs = await db
            .getAsync(
              `SELECT COUNT(*) as count FROM players WHERE platform = ? AND status = 'queued'`,
              [platform]
            )
            .then((row) => row.count >= unready.length)
            .catch((err) => {
              logger.errorWrapper("ReadyCheck_SubCountError", err);
              return false;
            });

          if (enoughSubs) {
            const {
              ActionRowBuilder,
              ButtonBuilder,
              ButtonStyle,
            } = require("discord.js");

            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("update_match_preferences")
                .setLabel("Update Match Preferences")
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId("find_replacement")
                .setLabel("Find Replacement from Queue")
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId("end_match_now")
                .setLabel("End Match Immediately")
                .setStyle(ButtonStyle.Danger)
            );

            const prefMap = new Map();

            for (const playerId of unready) {
              const prefRow = await db.getAsync(
                `SELECT nightlords FROM queue_preferences WHERE player_id = ? ORDER BY selected_at DESC LIMIT 1`,
                [playerId]
              );
              if (prefRow?.nightlords) {
                const bossList = prefRow.nightlords
                  .split(",")
                  .map((b) => `• ${b.trim()}`)
                  .join("\n");
                prefMap.set(playerId, bossList);
              }
            }

            const preferenceDisplay = Array.from(prefMap.entries())
              .map(
                ([playerId, bossList]) =>
                  `🧠 <@${playerId}>'s preferences:\n${
                    bossList || "*No preferences found*"
                  }`
              )
              .join("\n\n");

            await safeSend(thread, {
              content:
                `⚠️ Replacement needed for ${unready.length} kicked player(s).\n\n${preferenceDisplay}\n\n` +
                `What would you like to do?`,
              components: [row],
            });
          } else {
            await safeSend(thread, "⚠️ Not enough replacements available.");
          }
        }

        for (const id of confirmedReady) {
          try {
            await evaluateEventProgress(id, "ready_checks_clean", 1, {
              matchId: match_id,
              disqualified: false,
            });

            if (confirmedReady.length === 1) {
              await unlockAchievementIfNotEarned(id, "solo_ready");
            }

            await db.runAsync(
              `UPDATE player_statistics SET ready_checks_passed = ready_checks_passed + 1 WHERE id = ?`,
              [id]
            );
            await unlockStatThresholdAchievements(
              id,
              "ready_checks_passed",
              readyCheckAchievements
            );
          } catch (err) {
            logger.errorWrapper("ReadyCheck_ConfirmProgressError", err, {
              playerId: id,
            });
          }
        }

        if (confirmedReady.length === activePlayers.length) {
          await safeSend(
            thread,
            "✅ **All players confirmed!** The match will now proceed."
          );
        }
      } catch (endErr) {
        logger.errorWrapper("ReadyCheck_EndError", endErr, {
          threadId: thread.id,
        });
      }
    });
  } catch (err) {
    logger.errorWrapper("ReadyCheck_InitError", err, {
      threadId: thread?.id,
    });
  }
}

async function getVoiceId(threadId) {
  return db
    .getAsync(`SELECT voiceChannelId FROM channels WHERE threadId = ?`, [
      threadId,
    ])
    .then((row) => row?.voiceChannelId || null);
}

module.exports = { initiateReadyCheck };
