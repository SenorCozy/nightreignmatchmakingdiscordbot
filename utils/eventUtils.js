const db = require("../database");
const logger = require("../logger");
const goalTypes = require("../utils/goalTypes");
const goalTypeHandlers = require("../utils/goalTypeHandlers");
const {
  unlockAchievementIfNotEarned,
  checkEventCompletionAchievements,
  checkCurrencyAchievements,
} = require("./achievementHelpers");

const cron = require("node-cron");

async function evaluateEventProgress(
  playerId,
  goalType,
  manualValue = 1,
  metadata = {}
) {
  const now = Date.now();

  try {
    // ✅ Validate goal type
    const knownGoalTypes = goalTypes.map((g) => g.key);
    if (!knownGoalTypes.includes(goalType)) {
      logger.warn(
        `⚠️ Invalid goalType '${goalType}' passed to evaluateEventProgress`
      );
      return;
    }

    // 🔍 Get all active events for this goal type
    const events = await db.allAsync(
      `SELECT * FROM events
         WHERE goal_type = ? AND start_time <= ? AND end_time >= ? AND active = 1`,
      [goalType, now, now]
    );

    for (const event of events) {
      try {
        const cooldownMs = event.cooldown_ms || 0;
        const progressRow = await db.getAsync(
          `SELECT * FROM event_progress WHERE player_id = ? AND event_id = ?`,
          [playerId, event.event_id]
        );

        const alreadyComplete = progressRow?.completed === 1;
        const currentProgress = progressRow?.progress || 0;
        const lastAwardedTier = progressRow?.last_tier_index_awarded || 0;
        const lastIncrementAt = progressRow?.last_increment_at || 0;

        // ⏳ Enforce cooldown
        if (cooldownMs > 0 && now - lastIncrementAt < cooldownMs) continue;

        // 🔄 Resolve increment
        const handler = goalTypeHandlers[goalType];
        const incrementValue =
          typeof handler === "function"
            ? handler({ playerId, metadata }) ?? 0
            : manualValue;

        if (!incrementValue || incrementValue <= 0) continue;

        const newProgress = currentProgress + incrementValue;

        // 🧾 Insert or update progress
        if (!progressRow) {
          await db.runAsync(
            `INSERT INTO event_progress 
               (player_id, event_id, progress, completed, last_tier_index_awarded, last_increment_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            [playerId, event.event_id, newProgress, 0, 0, now]
          );
        } else {
          await db.runAsync(
            `UPDATE event_progress
               SET progress = ?, completed = ?, last_increment_at = ?
               WHERE player_id = ? AND event_id = ?`,
            [
              newProgress,
              newProgress >= event.goal_target ? 1 : 0,
              now,
              playerId,
              event.event_id,
            ]
          );
        }

        // 🏆 Tiered rewards
        const tiers = await db.allAsync(
          `SELECT * FROM event_tiers WHERE event_id = ? ORDER BY tier_index ASC`,
          [event.event_id]
        );

        for (const tier of tiers) {
          if (
            tier.tier_index > lastAwardedTier &&
            newProgress >= tier.goal_target
          ) {
            await db.runAsync(
              `INSERT INTO player_currency (player_id, balance)
                 VALUES (?, ?)
                 ON CONFLICT(player_id) DO UPDATE SET balance = balance + ?`,
              [playerId, tier.reward, tier.reward]
            );

            await db.runAsync(
              `INSERT INTO currency_audit 
                 (player_id, amount_changed, source, source_id, modified_by, modified_at, reason)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                playerId,
                tier.reward,
                "event_tier",
                `${event.event_id}-tier${tier.tier_index}`,
                "system",
                now,
                `Tier ${tier.tier_index} reward for event: ${event.name}`,
              ]
            );

            await db.runAsync(
              `UPDATE event_progress SET last_tier_index_awarded = ?
                 WHERE player_id = ? AND event_id = ?`,
              [tier.tier_index, playerId, event.event_id]
            );

            // ✅ Defer achievement check
            setImmediate(() =>
              checkCurrencyAchievements(playerId, db).catch((err) =>
                logger.error("❌ Currency achievement check failed (tier)", {
                  playerId,
                  error: err,
                  eventId: event.event_id,
                  tierIndex: tier.tier_index,
                })
              )
            );
          }
        }

        // 🎁 Flat reward fallback
        if (
          tiers.length === 0 &&
          newProgress >= event.goal_target &&
          !alreadyComplete
        ) {
          await db.runAsync(
            `INSERT INTO player_currency (player_id, balance)
               VALUES (?, ?)
               ON CONFLICT(player_id) DO UPDATE SET balance = balance + ?`,
            [playerId, event.reward, event.reward]
          );

          await db.runAsync(
            `INSERT INTO currency_audit 
               (player_id, amount_changed, source, source_id, modified_by, modified_at, reason)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              playerId,
              event.reward,
              "event",
              event.event_id,
              "system",
              now,
              `Completed event: ${event.name}`,
            ]
          );

          // ✅ Defer achievement check
          setImmediate(() =>
            checkCurrencyAchievements(playerId, db).catch((err) =>
              logger.error("❌ Currency achievement check failed (flat)", {
                playerId,
                error: err,
                eventId: event.event_id,
              })
            )
          );
        }

        // 🎖️ Event completion achievements (inline okay)
        try {
          await checkEventCompletionAchievements(playerId);
        } catch (err) {
          logger.error("❌ Failed to check event completion achievements", {
            playerId,
            error: err,
          });
        }
      } catch (eventError) {
        logger.error("❌ Failed to evaluate progress for event", {
          playerId,
          goalType,
          eventId: event.event_id,
          error: eventError,
        });
      }
    }
  } catch (err) {
    logger.error("❌ Unexpected error in evaluateEventProgress", {
      playerId,
      goalType,
      error: err,
    });
  }
}

function setupRecurringEventHandler() {
  cron.schedule("0 0 * * *", async () => {
    const now = Date.now();
    const dayMs = 86400000;

    const recurringEvents = await db.allAsync(
      `SELECT * FROM events WHERE active = 1 AND event_type IN ('daily', 'weekly')`
    );

    for (const ev of recurringEvents) {
      const expired = ev.end_time <= now;
      if (!expired) continue;

      const newStart = now;
      const newEnd = ev.event_type === "daily" ? now + dayMs : now + 7 * dayMs;

      const newEventId = `${ev.event_id.split("-")[0]}-${Date.now()}`;

      await db.runAsync(
        `INSERT INTO events (event_id, name, description, goal_type, start_time, end_time, event_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          newEventId,
          ev.name,
          ev.description,
          ev.goal_type,
          newStart,
          newEnd,
          ev.event_type,
        ]
      );

      logger.info(`🔁 Auto-replicated ${ev.event_type} event: ${ev.name}`);
    }

    // Also mark expired events as inactive
    await db.runAsync(`UPDATE events SET active = 0 WHERE end_time <= ?`, [
      now,
    ]);
  });
}

async function checkNewUniquePartners(playerId, partnerIds = []) {
  const allPriorMatches = await db.allAsync(
    `SELECT initial_player_ids FROM matches
       WHERE initial_player_ids LIKE ?`,
    [`%${playerId}%`]
  );

  const seenPartners = new Set();
  for (const row of allPriorMatches) {
    const ids = row.initial_player_ids.split(",");
    for (const id of ids) {
      if (id !== playerId) {
        seenPartners.add(id);
      }
    }
  }

  let newPartners = 0;
  for (const partnerId of partnerIds) {
    if (!seenPartners.has(partnerId)) {
      newPartners++;
    }
  }

  return newPartners;
}

async function checkRepeatDuo(playerId, duoPartnerId) {
  const row = await db.getAsync(
    `SELECT pair_count FROM duo_partner_counts WHERE player_id = ? AND partner_id = ?`,
    [playerId, duoPartnerId]
  );
  return !!row && row.pair_count > 0;
}

const crypto = require("crypto");

function generateTrioId(p1, p2, p3) {
  const sorted = [p1, p2, p3].sort().join("-");
  return crypto.createHash("sha256").update(sorted).digest("hex");
}

async function checkRepeatTrio(p1, p2, p3) {
  const trioId = generateTrioId(p1, p2, p3);
  const row = await db.getAsync(
    `SELECT 1 FROM trio_partner_groups WHERE trio_id = ?`,
    [trioId]
  );
  return !!row;
}

module.exports = {
  evaluateEventProgress,
  setupRecurringEventHandler,
  checkNewUniquePartners,
  checkRepeatDuo,
  checkRepeatTrio,
};
