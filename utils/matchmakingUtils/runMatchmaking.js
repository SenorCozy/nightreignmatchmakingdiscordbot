const { handleOrphanedDuos } = require("../duoUtils");
const { handleOrphanedTrios } = require("../trioUtils");
const { startMatch } = require("./startMatch");
const {
  isPlayerInServer,
  prioritizePlatformsByQueueTime,
} = require("../playerUtils");
const logger = require("../../logger");
const db = require("../../database");

async function getFreshQueuePreferences(playerIds, playerEnteredMap) {
  try {
    const placeholders = playerIds.map(() => "?").join(",");
    const prefs = await db.allAsync(
      `SELECT player_id, nightlords, vc_ok, selected_at
       FROM queue_preferences
       WHERE player_id IN (${placeholders})`,
      playerIds
    );

    logger.info("📥 Retrieved queue_preferences for players", {
      playerIds,
      prefs,
    });

    const prefMap = new Map();
    const GRACE_MS = 30000;

    for (const pref of prefs) {
      const playerMinTimestamp = playerEnteredMap.get(pref.player_id) || 0;
      const adjustedMin = playerMinTimestamp - GRACE_MS;

      if (pref.selected_at >= adjustedMin) {
        logger.info("✅ Using preference", {
          playerId: pref.player_id,
          selectedAt: pref.selected_at,
          minRequired: adjustedMin,
          nightlords: pref.nightlords,
          vc_ok: pref.vc_ok,
        });

        prefMap.set(pref.player_id, {
          nightlords: pref.nightlords.split(","),
          vc_ok: !!pref.vc_ok,
          selected_at: pref.selected_at,
        });
      } else {
        const delta = playerMinTimestamp - pref.selected_at;
        logger.info("⏱️ Skipping stale preference", {
          playerId: pref.player_id,
          selectedAt: pref.selected_at,
          minAllowed: playerMinTimestamp,
          delta,
        });
      }
    }

    logger.info("📦 Final prefMap created", {
      keys: [...prefMap.keys()],
    });

    return prefMap;
  } catch (err) {
    logger.errorWrapper("❌ Failed to get queue preferences", err, {
      playerIds,
    });
    return new Map();
  }
}

function evaluateMatchPreferences(prefsMap, playerIds) {
  const prefs = playerIds.map((id) => prefsMap.get(id));

  const validPrefs = prefs.filter(Boolean);
  if (validPrefs.length !== 3) {
    logger.warn("⚠️ Missing preferences for some players", { playerIds });
    return null;
  }

  const [a, b, c] = prefs;

  const sharedBosses = a.nightlords.filter(
    (boss) => b.nightlords.includes(boss) && c.nightlords.includes(boss)
  );

  if (sharedBosses.length === 0) {
    logger.info("❌ No shared Nightlord preferences", {
      playerIds,
      individualPrefs: { a: a.nightlords, b: b.nightlords, c: c.nightlords },
    });
    return null;
  }

  const vcMatch = a.vc_ok && b.vc_ok && c.vc_ok;

  logger.info("✅ Valid match evaluation", {
    playerIds,
    sharedBosses,
    overlapCount: sharedBosses.length,
    vcMatch,
  });

  return {
    sharedBosses,
    overlapCount: sharedBosses.length,
    vcMatch,
  };
}

let isMatchmakingRunning = false;
let lastThreadLimitWarning = 0;
const matchedPlayerIds = new Set();

async function runMatchmaking(client, db) {
  logger.info("⏳ Starting matchmaking run...");

  // Clear any previously matched player IDs
  matchedPlayerIds.clear();
  // At start of runMatchmaking:

  if (isMatchmakingRunning) {
    logger.warn("🚨 Matchmaking already running. Skipping duplicate.");
    return;
  }

  isMatchmakingRunning = true;

  try {
    if (!client?.isReady?.()) return logger.warn("❌ Client not ready.");
    const guild = client.guilds.cache.first();
    if (!guild) return logger.warn("❌ No guild found.");

    const activeThreads = await guild.channels.fetchActiveThreads();
    const activeThreadCount = activeThreads?.threads?.size || 0;
    if (activeThreadCount >= 1000) {
      const now = Date.now();
      if (now - lastThreadLimitWarning > 60000) {
        logger.warn("🚨 Thread limit reached. Skipping matchmaking run.");
        lastThreadLimitWarning = now;
      }
      return;
    }

    const matchmakingPaused = await db
      .getAsync(`SELECT value FROM settings WHERE key = 'matchmaking_paused'`)
      .then((row) => row?.value === "1");
    if (matchmakingPaused) return logger.info("🚫 Matchmaking is paused.");

    const totalQueuedPlayers = await db
      .getAsync(`SELECT COUNT(*) AS count FROM players WHERE status = 'queued'`)
      .then((row) => row?.count || 0);
    if (totalQueuedPlayers < 3) {
      logger.info("🚦 Not enough players to form matches", {
        totalQueuedPlayers,
      });
      return;
    }

    if (totalQueuedPlayers === 0) return logger.info("🚫 No players in queue.");

    const prioritizedPlatforms = await prioritizePlatformsByQueueTime();
    const processedPlatforms = new Set();

    for (const platform of prioritizedPlatforms) {
      const queuedPlayers = await db.allAsync(
        `SELECT id, duoPartner, queue_entered_at FROM players 
         WHERE platform = ? AND status = 'queued' 
         ORDER BY queue_entered_at ASC`,
        [platform]
      );

      logger.info("✅ [TRACE] Retrieved queued players", {
        platform,
        count: queuedPlayers.length,
        firstFew: queuedPlayers.slice(0, 3),
      });

      // In runMatchmaking(), add this after getting queuedPlayers:

      if (!queuedPlayers.length) {
        logger.info("⏭️ Skipping platform with 0 players", { platform });
        continue;
      }

      processedPlatforms.add(platform);

      const solos = [];
      const duos = new Map();
      const playerEnteredMap = new Map();

      for (const player of queuedPlayers) {
        const isMember = await isPlayerInServer(player.id, client);
        if (!isMember) continue;

        playerEnteredMap.set(player.id, player.queue_entered_at);

        if (player.duoPartner) {
          duos.set(player.id, player.duoPartner);
        } else {
          solos.push(player.id);
        }
      }

      const activeTrios = await db.allAsync(
        `SELECT * FROM trio_partner_groups WHERE active = 1`
      );
      logger.info("📊 Current queue status", {
        platform,
        totalPlayers: queuedPlayers.length,
        solos: solos.length,
        duos: duos.size,
        trios: activeTrios.length,
      });

      // Add this right after getting queuedPlayers for each platform:
      for (const trio of activeTrios) {
        const trioIds = [trio.player1_id, trio.player2_id, trio.player3_id];
        if (trioIds.some((id) => matchedPlayerIds.has(id))) continue;

        const stillQueued = await db.allAsync(
          `SELECT id FROM players 
           WHERE status = 'queued' AND id IN (?, ?, ?)`,
          trioIds
        );

        if (stillQueued.length === 3) {
          trioIds.forEach((id) => matchedPlayerIds.add(id));
          trioIds.forEach((id) => solos.splice(solos.indexOf(id), 1));
          trioIds.forEach((id) => duos.delete(id));

          await startMatch(client, platform, trioIds, "trio", {
            vcMatch: true,
            overlapCount: null,
            sharedBosses: null,
          });

          logger.info("✅ Matched trio", { platform, players: trioIds });
          await db.runAsync(
            `UPDATE trio_partner_groups SET active = 0 WHERE trio_id = ?`,
            [trio.trio_id]
          );
        }
      }

      for (const player of queuedPlayers) {
        if (!matchedPlayerIds.has(player.id)) {
          await handleOrphanedDuos(player.id, guild);
          await handleOrphanedTrios(player.id, guild);
        }
      }

      const allRelevantIds = solos.concat(
        Array.from(duos.keys()),
        ...duos.values()
      );
      logger.info("🧭 [TRACE] Calling getFreshQueuePreferences...");

      const preferenceMap = await getFreshQueuePreferences(
        allRelevantIds,
        playerEnteredMap
      );
      const missingPrefs = solos.filter((id) => !preferenceMap.has(id));
      if (missingPrefs.length) {
        const details = missingPrefs.map((id) => ({
          playerId: id,
          enteredAt: playerEnteredMap.get(id),
        }));
        logger.warn("⚠️ Skipping players due to missing or stale preferences", {
          platform,
          missingPrefs: details,
        });
      }

      logger.debug("🗺️ Full preference map", {
        entries: [...preferenceMap.entries()],
      });
      logger.info("🧭 [TRACE] Preference map received", {
        keys: [...preferenceMap.keys()],
      });

      logger.info("📊 Platform queue details", {
        platform,
        totalPlayers: queuedPlayers.length,
        solos: solos.length,
        duos: duos.size,
        trios: activeTrios.length,
        samplePreferences: Array.from(preferenceMap.entries()).slice(0, 3), // Show first 3 prefs
      });

      let matchedAny = false;

      while (solos.length >= 1 || duos.size > 0) {
        let match = [];
        let formationType = "unknown";

        if (duos.size > 0 && solos.length > 0) {
          const [duoId, partnerId] = duos.entries().next().value;
          const soloId = solos.shift();
          duos.delete(duoId);

          if (
            matchedPlayerIds.has(duoId) ||
            matchedPlayerIds.has(partnerId) ||
            matchedPlayerIds.has(soloId)
          )
            continue;

          const minTimestamp = Math.min(
            playerEnteredMap.get(soloId),
            playerEnteredMap.get(duoId),
            playerEnteredMap.get(partnerId)
          );

          // Simplify the evaluation block to:
          const score = evaluateMatchPreferences(preferenceMap, [
            soloId,
            duoId,
            partnerId,
          ]);

          if (!score) {
            logger.info("❌ No valid match configuration found", {
              candidates: [soloId, duoId, partnerId],
            });
            continue;
          }

          if (score.sharedBosses.length === 0) {
            logger.info("❌ No shared Nightlord preferences", {
              candidates: [soloId, duoId, partnerId],
              individualBosses: {
                solo: preferenceMap.get(soloId)?.nightlords,
                duo1: preferenceMap.get(duoId)?.nightlords,
                duo2: preferenceMap.get(partnerId)?.nightlords,
              },
            });
            continue;
          }

          if (score.sharedBosses.length === 0) {
            logger.info("❌ Match skipped due to no shared Nightlord overlap", {
              candidates: [soloId, duoId, partnerId],
              individualPrefs: {
                solo: preferenceMap.get(soloId),
                duo: preferenceMap.get(duoId),
                partner: preferenceMap.get(partnerId),
              },
            });
            continue;
          }

          // Fallback: allow VC mismatch if no better match
          if (!score.vcMatch) {
            logger.debug("🔍 Scanning solos for better VC-compatible match", {
              soloId,
              currentScore: score.sharedBosses.length,
            });

            const soloHasOtherOptions = solos.some((id) => {
              if (id === soloId) return false;
              const otherScore = evaluateMatchPreferences(preferenceMap, [
                id,
                duoId,
                partnerId,
              ]);
              return (
                otherScore?.sharedBosses?.length > score.sharedBosses.length &&
                otherScore?.vcMatch
              );
            });

            logger.debug("✅ VC-compatible match scan completed", {
              soloId,
              foundBetter: soloHasOtherOptions,
            });

            if (soloHasOtherOptions) {
              logger.info(
                "⚠️ VC mismatch skipped in favor of waiting for better match",
                {
                  soloId,
                  duo: [duoId, partnerId],
                }
              );
              continue;
            } else {
              logger.info("✅ Proceeding with VC mismatch fallback", {
                soloId,
                duo: [duoId, partnerId],
              });
            }
          }

          match = [soloId, duoId, partnerId];
          formationType = "duo+solo";

          // ✅ ADD THIS HERE
          match.forEach((id) => matchedPlayerIds.add(id));

          const existing = await db.getAsync(
            `SELECT threadId FROM match_players WHERE playerId IN (?, ?, ?) LIMIT 1`,
            match
          );
          if (existing) {
            logger.warn(
              "⚠️ Skipping match: one or more players already in a match",
              {
                match,
                existing,
              }
            );
            continue; // ✅ now conditional
          }

          const stillQueued = await db.allAsync(
            `SELECT id FROM players WHERE id IN (?, ?, ?) AND status = 'queued'`,
            match
          );
          if (stillQueued.length !== 3) {
            logger.warn(
              "⚠️ Skipping match: one or more players are no longer queued",
              {
                match,
                stillQueuedIds: stillQueued.map((p) => p.id),
              }
            );
            continue;
          }

          await db.runAsync(
            `UPDATE players SET status = 'active' WHERE id IN (?, ?, ?) AND status = 'queued'`,
            match
          );

          try {
            await startMatch(client, platform, match, formationType, {
              vcMatch: score.vcMatch,
              overlapCount: score.overlapCount,
              sharedBosses: score.sharedBosses,
            });
            matchedAny = true;

            match.forEach((id) => matchedPlayerIds.add(id));
            logger.info(`✅ Match created on ${platform}`, {
              match,
              formationType,
              sharedBosses: score.sharedBosses,
              vcMatch: score.vcMatch,
            });
          } catch (err) {
            logger.errorWrapper("❌ Failed to start match", err, {
              match,
              formationType,
            });
          }
        } else if (solos.length >= 3) {
          const candidates = solos.slice(0, 5); // check 5 to find best combo
          let bestCombo = null;
          let bestScore = -Infinity;
          const rejectedTriplets = [];

          for (let i = 0; i < candidates.length - 2; i++) {
            for (let j = i + 1; j < candidates.length - 1; j++) {
              for (let k = j + 1; k < candidates.length; k++) {
                const triplet = [candidates[i], candidates[j], candidates[k]];
                const minTimestamp = Math.min(
                  ...triplet.map((id) => playerEnteredMap.get(id) || 0)
                );
                logger.debug("🔍 Evaluating solo triplet", {
                  triplet,
                  prefs: triplet.map((id) => preferenceMap.get(id)),
                });

                logger.debug("🔍 Evaluating triplet", { triplet });
                const score = evaluateMatchPreferences(preferenceMap, triplet);
                logger.debug("📊 Evaluation result", { triplet, score });

                if (!score) {
                  const reason = "no score returned";
                  rejectedTriplets.push({
                    triplet,
                    prefs: triplet.map((id) => preferenceMap.get(id)),
                    reason,
                  });
                  logger.debug("⛔ Skipping solo triplet", { triplet, reason });

                  continue;
                }

                if (score.sharedBosses.length === 0) {
                  rejectedTriplets.push({
                    triplet,
                    prefs: triplet.map((id) => preferenceMap.get(id)),
                    reason: "no Nightlord overlap",
                  });
                  logger.debug("⛔ Skipping solo triplet", {
                    triplet,
                    prefs: triplet.map((id) => preferenceMap.get(id)),
                    reason: "no Nightlord overlap",
                  });

                  logger.info("❌ Match skipped due to no Nightlord overlap", {
                    triplet,
                  });
                  continue;
                }

                const latestEntry = Math.max(
                  ...triplet.map((id) => playerEnteredMap.get(id) || 0)
                );

                // Prefer more overlap, then VC match, then longer queue time
                const oldestQueueEntry = Math.min(
                  ...triplet.map((id) => playerEnteredMap.get(id))
                );
                const queueWaitSeconds = Math.floor(
                  (Date.now() - oldestQueueEntry) / 1000
                );

                const compositeScore =
                  score.overlapCount * 1000 +
                  (score.vcMatch ? 100 : 0) +
                  queueWaitSeconds;

                logger.debug("🧮 Score calculated for triplet", {
                  triplet,
                  score,
                  compositeScore,
                });
                logger.debug("🔢 Composite score components", {
                  overlapCount: score.overlapCount,
                  vcMatch: score.vcMatch,
                  latestEntry,
                });

                if (compositeScore > bestScore) {
                  bestCombo = { triplet, score };
                  bestScore = compositeScore;
                } else {
                  logger.debug("↩️ Triplet not better than best so far", {
                    triplet,
                    compositeScore,
                    bestScore,
                  });
                }
              }
            }
          }
          logger.debug("🧪 Finished evaluating all solo triplets", {
            triedTriplets: rejectedTriplets.length,
            rejectedTriplets, // comment out in production if too noisy
          });
          if (bestCombo) {
            logger.debug("🎯 Best solo combo selected", {
              triplet: bestCombo.triplet,
              score: bestCombo.score,
            });
          } else {
            logger.warn(
              "🚫 No valid solo match found despite candidate evaluation"
            );
          }

          if (!bestCombo) {
            logger.warn("🛑 No valid 3-solo match found from candidates", {
              candidates,
              preferenceMapSize: preferenceMap.size,
              soloCount: solos.length,
              candidatePrefs: candidates.map((id) => preferenceMap.get(id)),
            });

            break;
          }

          match = bestCombo.triplet;
          formationType = "3 solos";

          // ✅ Immediately reserve the IDs
          match.forEach((id) => matchedPlayerIds.add(id));

          for (const id of match) {
            const idx = solos.indexOf(id);
            if (idx !== -1) solos.splice(idx, 1);
          }

          const existing = await db.getAsync(
            `SELECT threadId FROM match_players WHERE playerId IN (${match
              .map(() => "?")
              .join(",")}) LIMIT 1`,
            match
          );
          if (existing) {
            logger.warn(
              "⚠️ Skipping solo match: one or more players already in match",
              {
                match,
                existing,
              }
            );
            continue;
          }

          const stillQueued = await db.allAsync(
            `SELECT id FROM players WHERE id IN (${match
              .map(() => "?")
              .join(",")}) AND status = 'queued'`,
            match
          );
          if (stillQueued.length !== 3) {
            logger.warn(
              "⚠️ Skipping solo match: not all players still queued",
              {
                match,
                stillQueuedIds: stillQueued.map((p) => p.id),
              }
            );
            continue;
          }

          await db.runAsync(
            `UPDATE players SET status = 'active' WHERE id IN (${match
              .map(() => "?")
              .join(",")}) AND status = 'queued'`,
            match
          );

          try {
            logger.info("🚀 Attempting to start 3-solo match", {
              match,
              score: bestCombo.score,
            });

            await startMatch(client, platform, match, formationType, {
              vcMatch: bestCombo.score.vcMatch,
              overlapCount: bestCombo.score.overlapCount,
              sharedBosses: bestCombo.score.sharedBosses,
            });
            matchedAny = true;

            logger.info(`✅ Match created on ${platform}`, {
              match,
              formationType,
              sharedBosses: bestCombo.score.sharedBosses,
              vcMatch: bestCombo.score.vcMatch,
            });
          } catch (err) {
            logger.errorWrapper("❌ Failed to start match", err, {
              match,
              formationType,
            });
          }
        } else {
          break;
        }
      }
      if (!matchedAny && solos.length >= 3) {
        logger.warn(
          "🛑 No solo match formed despite 3+ valid solo candidates",
          {
            platform,
            solos,
            prefMapKeys: [...preferenceMap.keys()],
          }
        );
      }
    }
    // ⬇️ Place fallback logic *after* all platforms are processed
    const allPlatforms = ["pc", "xbox", "playstation"];
    const missedPlatforms = allPlatforms.filter(
      (p) => !processedPlatforms.has(p)
    );

    if (missedPlatforms.length) {
      logger.warn("🔁 Fallback pass for missed platforms", { missedPlatforms });

      for (const fallbackPlatform of missedPlatforms) {
        try {
          logger.info("🧪 Retrying matchmaking for fallback platform", {
            platform: fallbackPlatform,
          });

          // Optional: reuse logic (e.g., await processPlatform(...));
        } catch (err) {
          logger.errorWrapper(
            "❌ Fallback matchmaking failed for platform",
            err,
            {
              platform: fallbackPlatform,
            }
          );
        }
      }
    }
  } catch (error) {
    logger.errorWrapper("❌ Error in runMatchmaking", error);
  } finally {
    isMatchmakingRunning = false;
    logger.info("🏁 Matchmaking run completed");
    logger.info(`🎯 Total players matched this run: ${matchedPlayerIds.size}`);
  }
}

module.exports = { runMatchmaking };
