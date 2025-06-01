const { EmbedBuilder } = require("discord.js");
const db = require("../database");
const logger = require("../logger");
const { logCurrencyChange } = require("./logCurrencyChange");
const QUEUE_ALERT_CHANNEL = process.env.QUEUE_ALERT_CHANNEL;
function statThresholdAchievement({
  id,
  name,
  description,
  reward,
  statKey,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    statKey,
    threshold,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT ${statKey} FROM player_statistics WHERE id = ?`,
        [playerId]
      );
      return row?.[statKey] >= threshold;
    },
  };
}

function vcTimeAchievement({ id, name, description, reward, threshold }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT vc_time FROM player_statistics WHERE id = ?`,
        [playerId]
      );
      return row?.vc_time >= threshold;
    },
  };
}

function messageCountAchievement({ id, name, description, reward, threshold }) {
  return {
    id,
    name,
    description,
    reward,
    statKey: "messages_sent",
    threshold,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT messages_sent FROM player_statistics WHERE id = ?`,
        [playerId]
      );
      return row?.messages_sent >= threshold;
    },
  };
}

function mentionChastisedAchievement({ id, name, description, reward }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM player_mention_violations WHERE player_id = ?`,
        [playerId]
      );
      return (row?.count || 0) >= 1;
    },
  };
}

function uniquePartnersAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(DISTINCT partner_id) AS count FROM player_partners WHERE player_id = ?`,
        [playerId]
      );
      return row?.count >= threshold;
    },
  };
}
function repeatPartnerAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    goal_type: "repeat_partner",
    threshold,
  };
}

function eventCompletionAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    threshold,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM event_progress WHERE player_id = ? AND completed = 1`,
        [playerId]
      );
      return row?.count >= threshold;
    },
  };
}

function mvpGivenAchievement({ id, name, description, reward, threshold = 1 }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM mvp_awards WHERE giver_id = ?`,
        [playerId]
      );
      return (row?.count || 0) >= threshold;
    },
  };
}

function mvpReceivedAchievement({
  id,
  name,
  description,
  reward,
  threshold = 1,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM mvp_awards WHERE receiver_id = ?`,
        [playerId]
      );
      return (row?.count || 0) >= threshold;
    },
  };
}

function matchCompletionPointAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT SUM(points) AS total FROM match_completion_awards WHERE player_id = ?`,
        [playerId]
      );
      return row?.total >= threshold;
    },
  };
}

function matchCompletionStreakAchievement({
  id,
  name,
  description,
  reward,
  statKey,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    goal_type: "matches_completed_streak_24h",
    statKey,
    threshold,
  };
}

function dailyMatchStreakAchievement({ id, name, description, reward, days }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const results = await db.allAsync(
        `SELECT DISTINCT DATE(timestamp / 1000.0, 'unixepoch', 'localtime') AS play_date
                 FROM match_completion_awards
                 WHERE player_id = ?
                 ORDER BY play_date DESC
                 LIMIT ?`,
        [playerId, days]
      );

      const today = new Date();
      for (let i = 0; i < days; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() - i);
        const iso = checkDate.toISOString().slice(0, 10);

        if (!results.some((r) => r.play_date === iso)) {
          return false;
        }
      }

      return true;
    },
  };
}

function matchDurationAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT longest_match_time FROM player_statistics WHERE id = ?`,
        [playerId]
      );
      return row?.longest_match_time >= threshold;
    },
  };
}

function achievementCountAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM player_achievements WHERE player_id = ?`,
        [playerId]
      );
      return row?.count >= threshold;
    },
  };
}

function currencyThresholdAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT balance FROM player_currency WHERE player_id = ?`,
        [playerId]
      );
      return (row?.balance || 0) >= threshold;
    },
  };
}

function platformUsageAchievement({ id, name, description, reward }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT platform_usage_pc, platform_usage_xbox, platform_usage_playstation
             FROM player_statistics WHERE id = ?`,
        [playerId]
      );

      return (
        row &&
        row.platform_usage_pc > 0 &&
        row.platform_usage_xbox > 0 &&
        row.platform_usage_playstation > 0
      );
    },
  };
}

function samePartnerCountAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT MAX(match_count) AS max_count FROM (
               SELECT COUNT(*) AS match_count
               FROM duo_partner_history
               WHERE player_id = ?
               GROUP BY partner_id
             )`,
        [playerId]
      );
      return row?.max_count >= threshold;
    },
  };
}

function storePurchaseAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM player_purchases WHERE player_id = ?`,
        [playerId]
      );
      return row?.count >= threshold;
    },
  };
}
function dualMvpAchievement({ id, name, description, reward }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT match_id
             FROM mvp_awards
             WHERE receiver_id = ?
             GROUP BY match_id
             HAVING COUNT(DISTINCT giver_id) >= 2
             LIMIT 1`,
        [playerId]
      );
      return !!row;
    },
  };
}

function currencySpentAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT SUM(amount_changed) AS total FROM currency_audit WHERE player_id = ? AND amount_changed < 0`,
        [playerId]
      );
      return Math.abs(row?.total || 0) >= threshold;
    },
  };
}

function currencyZeroedAchievement({ id, name, description, reward }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT balance FROM player_currency WHERE player_id = ?`,
        [playerId]
      );
      return row?.balance === 0;
    },
  };
}

function storeCompleteAchievement({ id, name, description, reward }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const total = await db.getAsync(
        `SELECT COUNT(*) AS total FROM shop_roles`
      );
      const owned = await db.getAsync(
        `SELECT COUNT(*) AS count FROM player_purchases WHERE player_id = ?`,
        [playerId]
      );
      return owned?.count >= total?.total;
    },
  };
}

function botMentionAchievement({ id, name, description, reward }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM bot_mentions WHERE player_id = ?`,
        [playerId]
      );
      return row?.count >= 1;
    },
  };
}

function formationDiversityAchievement({ id, name, description, reward }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const results = await db.allAsync(
        `SELECT DISTINCT formation_type FROM match_players WHERE playerId = ?`,
        [playerId]
      );
      const types = results.map((r) => r.formation_type);
      return (
        types.includes("solo") &&
        types.includes("duo") &&
        types.includes("trio")
      );
    },
  };
}

function playersInMatchAchievement({
  id,
  name,
  description,
  reward,
  threshold,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const rows = await db.allAsync(
        `SELECT match_id FROM match_players WHERE playerId = ? ORDER BY joined_at DESC LIMIT 20`,
        [playerId]
      );

      for (const { match_id } of rows) {
        const count = await db.getAsync(
          `SELECT COUNT(*) AS count FROM match_players WHERE match_id = ?`,
          [match_id]
        );
        if (count?.count >= threshold) return true;
      }

      return false;
    },
  };
}

function leaveWhileQueuedAchievement({
  id,
  name,
  description,
  reward,
  formation,
}) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM queue_leave_log WHERE player_id = ? AND formation = ?`,
        [playerId, formation]
      );
      return row?.count >= 1;
    },
  };
}

function mvpDailyCapAchievement({ id, name, description, reward, cap = 10 }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM mvp_awards WHERE receiver_id = ? AND awarded_at > ?`,
        [playerId, Date.now() - 24 * 60 * 60 * 1000]
      );
      return row?.count >= cap;
    },
  };
}

function mvpCooldownAttemptAchievement({ id, name, description, reward }) {
  return {
    id,
    name,
    description,
    reward,
    check: async (playerId, db) => {
      const row = await db.getAsync(
        `SELECT COUNT(*) AS count FROM mvp_award_attempts WHERE player_id = ? AND was_blocked = 1`,
        [playerId]
      );
      return row?.count >= 1;
    },
  };
}

const readyCheckAchievements = [
  statThresholdAchievement({
    id: "ready_check_1",
    name: "Locked and Loaded",
    description: "Passed first ready check",
    reward: 2,
    statKey: "ready_checks_passed",
    threshold: 1,
  }),
  statThresholdAchievement({
    id: "ready_check_10",
    name: "Eager Beaver",
    description: "Passed 10 ready checks",
    reward: 4,
    statKey: "ready_checks_passed",
    threshold: 10,
  }),
  statThresholdAchievement({
    id: "ready_check_25",
    name: "Glued to the Screen",
    description: "Passed 25 ready checks",
    reward: 8,
    statKey: "ready_checks_passed",
    threshold: 25,
  }),
  statThresholdAchievement({
    id: "ready_check_50",
    name: "Strapped To The Chair",
    description: "Passed 50 ready checks",
    reward: 12,
    statKey: "ready_checks_passed",
    threshold: 50,
  }),
  statThresholdAchievement({
    id: "ready_check_100",
    name: "No Bathroom Breaks",
    description: "Passed 100 ready checks",
    reward: 18,
    statKey: "ready_checks_passed",
    threshold: 100,
  }),
  statThresholdAchievement({
    id: "ready_check_250",
    name: "Ready Player One",
    description: "Passed 250 ready checks",
    reward: 25,
    statKey: "ready_checks_passed",
    threshold: 250,
  }),
  statThresholdAchievement({
    id: "ready_check_500",
    name: "I Was Born Ready",
    description: "Passed 500 ready checks",
    reward: 50,
    statKey: "ready_checks_passed",
    threshold: 500,
  }),
];

const allQueueEntryAchievements = [
  statThresholdAchievement({
    id: "queue_entry_1",
    name: "A Journey of A Thousand Miles Begins With A Single Step",
    description: "First queue entry",
    reward: 2,
    statKey: "queue_entries",
    threshold: 1,
  }),
  statThresholdAchievement({
    id: "queue_entry_10",
    name: "Getting Your Feet Wet",
    description: "10 queue entries",
    reward: 4,
    statKey: "queue_entries",
    threshold: 10,
  }),
  statThresholdAchievement({
    id: "queue_entry_25",
    name: "Queue Curious",
    description: "25 queue entries",
    reward: 8,
    statKey: "queue_entries",
    threshold: 25,
  }),
  statThresholdAchievement({
    id: "queue_entry_50",
    name: "Finding A Groove",
    description: "50 queue entries",
    reward: 12,
    statKey: "queue_entries",
    threshold: 50,
  }),
  statThresholdAchievement({
    id: "queue_entry_100",
    name: "Matchmaker",
    description: "100 queue entries",
    reward: 18,
    statKey: "queue_entries",
    threshold: 100,
  }),
  statThresholdAchievement({
    id: "queue_entry_250",
    name: "Queue Walker",
    description: "250 queue entries",
    reward: 20,
    statKey: "queue_entries",
    threshold: 250,
  }),
  statThresholdAchievement({
    id: "queue_entry_500",
    name: `"Do You Know What We're In Line For?"`,
    description: "500 queue entries",
    reward: 30,
    statKey: "queue_entries",
    threshold: 500,
  }),
  statThresholdAchievement({
    id: "queue_entry_1000",
    name: `"Addicted? Me? Nooooooo…"`,
    description: "1000 queue entries",
    reward: 50,
    statKey: "queue_entries",
    threshold: 1000,
  }),
];

const matchesPlayedAchievements = [
  statThresholdAchievement({
    id: "matches_played_1",
    name: "First Blood",
    description: "First match played",
    reward: 2,
    statKey: "matches_played",
    threshold: 1,
  }),
  statThresholdAchievement({
    id: "matches_played_10",
    name: "Getting The Hang of This",
    description: "10 matches played",
    reward: 4,
    statKey: "matches_played",
    threshold: 10,
  }),
  statThresholdAchievement({
    id: "matches_played_25",
    name: "Matchmaker",
    description: "25 matches played",
    reward: 8,
    statKey: "matches_played",
    threshold: 25,
  }),
  statThresholdAchievement({
    id: "matches_played_50",
    name: "Match Veteran",
    description: "50 matches played",
    reward: 15,
    statKey: "matches_played",
    threshold: 50,
  }),
  statThresholdAchievement({
    id: "matches_played_100",
    name: "Are Ya Winning Son?",
    description: "100 matches played",
    reward: 20,
    statKey: "matches_played",
    threshold: 100,
  }),
  statThresholdAchievement({
    id: "matches_played_250",
    name: "You Could Say I Like The Game",
    description: "250 matches played",
    reward: 25,
    statKey: "matches_played",
    threshold: 250,
  }),
  statThresholdAchievement({
    id: "matches_played_500",
    name: `"Ahh Shit, Here We Go Again!"`,
    description: "500 matches played",
    reward: 30,
    statKey: "matches_played",
    threshold: 500,
  }),
  statThresholdAchievement({
    id: "matches_played_1000",
    name: "I Don't Own Any Other Games",
    description: "1000 matches played",
    reward: 50,
    statKey: "matches_played",
    threshold: 1000,
  }),
];

const vcTimeAchievements = [
  vcTimeAchievement({
    id: "vc_time_10m",
    name: `"Testing, Testing, Mic Check"`,
    description: "Spend 10 minutes in VC",
    reward: 3,
    threshold: 10 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_30m",
    name: "Talkative",
    description: "Spend 30 minutes in VC",
    reward: 5,
    threshold: 30 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_1h",
    name: "Loqaucious",
    description: "Spend an hour in VC",
    reward: 8,
    threshold: 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_4h",
    name: "Certified Yapper",
    description: "Spend 4 hours in VC",
    reward: 15,
    threshold: 4 * 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_10h",
    name: "Talk Radio",
    description: "Spend 10 hours in VC",
    reward: 20,
    threshold: 10 * 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_24h",
    name: "A Day Well Spent!",
    description: "Spend 24 hours in VC",
    reward: 25,
    threshold: 24 * 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_50h",
    name: "A Career in Broadcast",
    description: "Spend 50 hours in VC",
    reward: 40,
    threshold: 50 * 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_100h",
    name: "Yap God",
    description: "Spend 100 hours in VC",
    reward: 50,
    threshold: 100 * 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_250h",
    name: "The One Who Speaks",
    description: "Spend 250 hours in VC",
    reward: 60,
    threshold: 250 * 60 * 60 * 1000,
  }),
];

const messageAchievements = [
  messageCountAchievement({
    id: "messages_1",
    name: "Hello, World.",
    description: "First message sent",
    reward: 1,
    threshold: 1,
  }),
  messageCountAchievement({
    id: "messages_25",
    name: "Speak From Your Chest",
    description: "Send 25 Messages",
    reward: 2,
    threshold: 25,
  }),
  messageCountAchievement({
    id: "messages_50",
    name: "Did You Get My Message?",
    description: "Send 50 Messages",
    reward: 4,
    threshold: 50,
  }),
  messageCountAchievement({
    id: "messages_75",
    name: "Chatterbox",
    description: "Send 75 Messages",
    reward: 6,
    threshold: 75,
  }),
  messageCountAchievement({
    id: "messages_100",
    name: "Message Received",
    description: "Send 100 messages",
    reward: 8,
    threshold: 100,
  }),
  messageCountAchievement({
    id: "messages_150",
    name: "Socialite",
    description: "Send 150 messages",
    reward: 10,
    threshold: 150,
  }),
  messageCountAchievement({
    id: "messages_250",
    name: "Talking Talking Talking",
    description: "Send 250 messages",
    reward: 12,
    threshold: 250,
  }),
  messageCountAchievement({
    id: "messages_500",
    name: "Keyboard Warrior",
    description: "Send 500 messages",
    reward: 14,
    threshold: 500,
  }),
  messageCountAchievement({
    id: "messages_1000",
    name: "You Got Something To Say?",
    description: "Send 1000 messages",
    reward: 16,
    threshold: 1000,
  }),
  messageCountAchievement({
    id: "messages_1500",
    name: "Preacher",
    description: "Send 1500 messages",
    reward: 18,
    threshold: 1500,
  }),
  messageCountAchievement({
    id: "messages_2000",
    name: "Echo Chamber",
    description: "Send 2000 messages",
    reward: 20,
    threshold: 2000,
  }),
  messageCountAchievement({
    id: "messages_3000",
    name: "Spamurai",
    description: "Send 3000 messages",
    reward: 22,
    threshold: 3000,
  }),
  messageCountAchievement({
    id: "messages_4000",
    name: "The Gift Of Gab",
    description: "Send 4000 messages",
    reward: 24,
    threshold: 4000,
  }),
  messageCountAchievement({
    id: "messages_5000",
    name: "Wall Of Text",
    description: "Send 5000 messages",
    reward: 25,
    threshold: 5000,
  }),
  messageCountAchievement({
    id: "messages_7500",
    name: "Captcha Failed",
    description: "Send 7500 messages",
    reward: 50,
    threshold: 7500,
  }),
  messageCountAchievement({
    id: "messages_10000",
    name: "Bot Detected",
    description: "Send 10000 messages",
    reward: 75,
    threshold: 10000,
  }),
];

const mentionAchievement = mentionChastisedAchievement({
  id: "mention_blocked",
  name: "Busted!",
  description: "@ Mention Chastised triggered",
  reward: 3,
});

const duoQueueAchievements = [
  statThresholdAchievement({
    id: "duo_queue_1",
    name: "Phone A Friend",
    description: "Queue as a Duo for the first time",
    reward: 2,
    statKey: "queue_entries_duo",
    threshold: 1,
  }),
  statThresholdAchievement({
    id: "duo_queue_10",
    name: "2 for 1",
    description: "Queue as a Duo 10 times",
    reward: 4,
    statKey: "queue_entries_duo",
    threshold: 10,
  }),
  statThresholdAchievement({
    id: "duo_queue_25",
    name: "Packaged Deal",
    description: "Queue as a Duo 25 times",
    reward: 8,
    statKey: "queue_entries_duo",
    threshold: 25,
  }),
  statThresholdAchievement({
    id: "duo_queue_50",
    name: "Partner In Crime",
    description: "Queue as a Duo 50 times",
    reward: 12,
    statKey: "queue_entries_duo",
    threshold: 50,
  }),
  statThresholdAchievement({
    id: "duo_queue_100",
    name: "I Can't Play Without Them",
    description: "Queue as a Duo 100 times",
    reward: 18,
    statKey: "queue_entries_duo",
    threshold: 100,
  }),
  statThresholdAchievement({
    id: "duo_queue_250",
    name: "Best Friends For Life!",
    description: "Queue as a Duo 250 times",
    reward: 20,
    statKey: "queue_entries_duo",
    threshold: 250,
  }),
  statThresholdAchievement({
    id: "duo_queue_500",
    name: "Siamese Twins",
    description: "Queue as a Duo 500 times",
    reward: 30,
    statKey: "queue_entries_duo",
    threshold: 500,
  }),
];

const trioQueueAchievements = [
  statThresholdAchievement({
    id: "trio_queue_1",
    name: "Seats Taken",
    description: "Queue as a Trio for the first time",
    reward: 2,
    statKey: "queue_entries_trio",
    threshold: 1,
  }),
  statThresholdAchievement({
    id: "trio_queue_10",
    name: "The Gangs All Here!",
    description: "Queue as a Trio 10 times",
    reward: 4,
    statKey: "queue_entries_trio",
    threshold: 10,
  }),
  statThresholdAchievement({
    id: "trio_queue_25",
    name: "We're Shy",
    description: "Queue as a Trio 25 times",
    reward: 8,
    statKey: "queue_entries_trio",
    threshold: 25,
  }),
  statThresholdAchievement({
    id: "trio_queue_50",
    name: "Three's Company",
    description: "Queue as a Trio 50 times",
    reward: 12,
    statKey: "queue_entries_trio",
    threshold: 50,
  }),
  statThresholdAchievement({
    id: "trio_queue_100",
    name: "The Holy Trinity",
    description: "Queue as a Trio 100 times",
    reward: 18,
    statKey: "queue_entries_trio",
    threshold: 100,
  }),
  statThresholdAchievement({
    id: "trio_queue_250",
    name: "No Social Skills",
    description: "Queue as a Trio 250 times",
    reward: 20,
    statKey: "queue_entries_trio",
    threshold: 250,
  }),
  statThresholdAchievement({
    id: "trio_queue_500",
    name: "You Guys Really, Really Don't Like Other People Do You?",
    description: "Queue as a Trio 500 times",
    reward: 30,
    statKey: "queue_entries_trio",
    threshold: 500,
  }),
];

const uniquePartnerAchievements = [
  uniquePartnersAchievement({
    id: "unique_players_2",
    name: "Making Friends",
    description: "Play with 2 Unique Players",
    reward: 2,
    threshold: 2,
  }),
  uniquePartnersAchievement({
    id: "unique_players_5",
    name: "Putting Yourself Out There",
    description: "Play with 5 Unique Players",
    reward: 5,
    threshold: 5,
  }),
  uniquePartnersAchievement({
    id: "unique_players_10",
    name: "Getting To Know New People",
    description: "Play with 10 Unique Players",
    reward: 5,
    threshold: 10,
  }),
  uniquePartnersAchievement({
    id: "unique_players_25",
    name: "New Names, New Faces",
    description: "Play with 25 Unique Players",
    reward: 5,
    threshold: 25,
  }),
  uniquePartnersAchievement({
    id: "unique_players_50",
    name: "I'm Social",
    description: "Play with 50 Unique Players",
    reward: 8,
    threshold: 50,
  }),
  uniquePartnersAchievement({
    id: "unique_players_75",
    name: "Branching Out",
    description: "Play with 75 Unique Players",
    reward: 10,
    threshold: 75,
  }),
  uniquePartnersAchievement({
    id: "unique_players_100",
    name: "Well-Connected",
    description: "Play with 100 Unique Players",
    reward: 10,
    threshold: 100,
  }),
  uniquePartnersAchievement({
    id: "unique_players_150",
    name: "Social Butterfly",
    description: "Play with 150 Unique Players",
    reward: 15,
    threshold: 150,
  }),
  uniquePartnersAchievement({
    id: "unique_players_225",
    name: "Popular",
    description: "Play with 225 Unique Players",
    reward: 15,
    threshold: 225,
  }),
  uniquePartnersAchievement({
    id: "unique_players_300",
    name: "I Get Around",
    description: "Play with 300 Unique Players",
    reward: 15,
    threshold: 300,
  }),
  uniquePartnersAchievement({
    id: "unique_players_500",
    name: "No Man Is Unknown To Me",
    description: "Play with 500 Unique Players",
    reward: 25,
    threshold: 500,
  }),
  uniquePartnersAchievement({
    id: "unique_players_1000",
    name: "Friend To All Humankind",
    description: "Play with 1000 Unique Players",
    reward: 50,
    threshold: 1000,
  }),
];

const repeatPartnerAchievements = [
  repeatPartnerAchievement({
    id: "repeat_partner_2",
    name: "Funny Seeing You Here",
    description: "Play with the same player randomly twice",
    reward: 4,
    threshold: 2,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_4",
    name: "What Are The Odds?",
    description: "Play with the same player randomly four times",
    reward: 8,
    threshold: 4,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_8",
    name: "Déjà Vu",
    description: "Play with the same player randomly eight times",
    reward: 12,
    threshold: 8,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_10",
    name: "Are You Following Me?",
    description: "Play with the same player randomly 10 times",
    reward: 15,
    threshold: 10,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_25",
    name: "Stalker",
    description: "Play with the same player randomly 25 times",
    reward: 20,
    threshold: 25,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_50",
    name: "Have I Seen You Somewhere Before?",
    description: "Play with the same player randomly 50 times",
    reward: 25,
    threshold: 50,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_100",
    name: "It's A Small World Afterall",
    description: "Play with the same player randomly 100 times",
    reward: 50,
    threshold: 100,
  }),
];

// 🟢 All Platforms Played
const platformAchievements = [
  platformUsageAchievement({
    id: "platforms_all",
    name: "Well Traveled",
    description: "Completed a match on all 3 platforms",
    reward: 20,
  }),
];

// 🟢 Events Completed
const eventCompletionAchievements = [
  eventCompletionAchievement({
    id: "events_1",
    name: "Extra Credit",
    description: "Complete your first event",
    reward: 2,
    threshold: 1,
  }),
  eventCompletionAchievement({
    id: "events_3",
    name: "New Hobby",
    description: "Complete your third event",
    reward: 4,
    threshold: 3,
  }),
  eventCompletionAchievement({
    id: "events_10",
    name: "On The Board",
    description: "Complete your 10th event",
    reward: 8,
    threshold: 10,
  }),
  eventCompletionAchievement({
    id: "events_25",
    name: "Habit Forming",
    description: "Complete your 25th event",
    reward: 12,
    threshold: 25,
  }),
  eventCompletionAchievement({
    id: "events_50",
    name: "Overachiever",
    description: "Complete your 50th event",
    reward: 18,
    threshold: 50,
  }),
  eventCompletionAchievement({
    id: "events_100",
    name: "Teacher's Pet",
    description: "Complete your 100th event",
    reward: 25,
    threshold: 100,
  }),
  eventCompletionAchievement({
    id: "events_250",
    name: "Organized Activities Soothe Me",
    description: "Complete your 250th event",
    reward: 50,
    threshold: 250,
  }),
  eventCompletionAchievement({
    id: "events_500",
    name: "Full Calendar",
    description: "Complete your 500th event",
    reward: 75,
    threshold: 500,
  }),
];

// 🟢 MVPs Given
const mvpGivenAchievements = [
  mvpGivenAchievement({
    id: "mvp_given_1",
    name: "Give 1 Get 1",
    description: "Give Your First MVP Award",
    reward: 1,
    threshold: 1,
  }),
  mvpGivenAchievement({
    id: "mvp_given_5",
    name: "I Know Talent When I See It",
    description: "Give Your 5th MVP Award",
    reward: 3,
    threshold: 5,
  }),
  mvpGivenAchievement({
    id: "mvp_given_10",
    name: "Giving Is Receiving",
    description: "Give Your 10th MVP Award",
    reward: 4,
    threshold: 10,
  }),
  mvpGivenAchievement({
    id: "mvp_given_25",
    name: "Spread The Love",
    description: "Give Your 25th MVP Award",
    reward: 5,
    threshold: 25,
  }),
  mvpGivenAchievement({
    id: "mvp_given_50",
    name: "Charitable",
    description: "Give Your 50th MVP Award",
    reward: 8,
    threshold: 50,
  }),
  mvpGivenAchievement({
    id: "mvp_given_100",
    name: "Giver",
    description: "Give Your 100th MVP Award",
    reward: 10,
    threshold: 100,
  }),
  mvpGivenAchievement({
    id: "mvp_given_250",
    name: "Give Until It Hurts",
    description: "Give Your 250th MVP Award",
    reward: 25,
    threshold: 250,
  }),
  mvpGivenAchievement({
    id: "mvp_given_500",
    name: "Philanthropist",
    description: "Give Your 500th MVP Award",
    reward: 50,
    threshold: 500,
  }),
];

// 🟢 MVPs Received
const mvpReceivedAchievements = [
  mvpReceivedAchievement({
    id: "mvp_received_1",
    name: "Skill Bonus",
    description: "Receive your first MVP award",
    reward: 1,
    threshold: 1,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_5",
    name: "Recognition",
    description: "Receive your 5th MVP award",
    reward: 4,
    threshold: 5,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_10",
    name: "Fan Favorite",
    description: "Receive your 10th MVP award",
    reward: 5,
    threshold: 10,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_25",
    name: "Admired",
    description: "Receive your 25th MVP award",
    reward: 8,
    threshold: 25,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_50",
    name: "Teach Me How To Play",
    description: "Receive your 50th MVP award",
    reward: 10,
    threshold: 50,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_100",
    name: "Exalted",
    description: "Receive your 100th MVP award",
    reward: 15,
    threshold: 100,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_250",
    name: "Paragon",
    description: "Receive your 250th MVP award",
    reward: 25,
    threshold: 250,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_500",
    name: "Local Legend",
    description: "Receive your 500th MVP award",
    reward: 50,
    threshold: 500,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_1000",
    name: "Let Me Solo Them",
    description: "Receive your 1000th MVP award",
    reward: 50,
    threshold: 1000,
  }),
];

// 🟡 MVP Special Logic
const dualMvpAchieved = dualMvpAchievement({
  id: "mvp_dual",
  name: "Universally Recognized",
  description: "Receive two MVP from both other players in the match",
  reward: 5,
});

const mvpCooldownAbuseAchievement = {
  id: "mvp_cooldown_abuse",
  name: "Stop Glazing Bro",
  description:
    "Attempt to Award an MVP award to the same player before the cooldown is up",
  reward: 1,
  goal_type: "mvp_cooldown_abuse",
};

// 🟢 Match Completion Points
const matchCompletionPointAchievements = [
  matchCompletionPointAchievement({
    id: "completion_1",
    name: "Here's One On The House",
    description: "Obtain your first match completion point",
    reward: 1,
    threshold: 1,
  }),
  matchCompletionPointAchievement({
    id: "completion_50",
    name: "Milestone",
    description: "Get 50 match completion points",
    reward: 10,
    threshold: 50,
  }),
  matchCompletionPointAchievement({
    id: "completion_100",
    name: "No Casuals",
    description: "Get 100 match completion points",
    reward: 20,
    threshold: 100,
  }),
  matchCompletionPointAchievement({
    id: "completion_250",
    name: "This Is My Game",
    description: "Get 250 match completion points",
    reward: 35,
    threshold: 250,
  }),
  matchCompletionPointAchievement({
    id: "completion_500",
    name: "Match Point Farmer",
    description: "Get 500 match completion points",
    reward: 50,
    threshold: 500,
  }),
  matchCompletionPointAchievement({
    id: "completion_1000",
    name: "Completionist",
    description: "Get 1000 match completion points",
    reward: 75,
    threshold: 1000,
  }),
];

// 💰 Currency Milestones
const currencyAchievements = [
  currencyThresholdAchievement({
    id: "currency_55",
    name: "Bank",
    description: "Have 55 currency",
    reward: 5,
    threshold: 55,
  }),
  currencyThresholdAchievement({
    id: "currency_105",
    name: "Interest",
    description: "Have 105 currency",
    reward: 15,
    threshold: 105,
  }),
  currencyThresholdAchievement({
    id: "currency_235",
    name: "Capital Gains",
    description: "Have 235 currency",
    reward: 20,
    threshold: 235,
  }),
  currencyThresholdAchievement({
    id: "currency_505",
    name: "Takes Money To Make Money",
    description: "Have 505 currency",
    reward: 25,
    threshold: 505,
  }),
  currencyThresholdAchievement({
    id: "currency_1005",
    name: "Insider Trading",
    description: "Have 1005 currency",
    reward: 50,
    threshold: 1005,
  }),
  currencyThresholdAchievement({
    id: "currency_1805",
    name: "The Rich Get Richer…",
    description: "Have 1805 currency",
    reward: 75,
    threshold: 1805,
  }),
  currencyThresholdAchievement({
    id: "currency_2501",
    name: "Dragon's Hoard",
    description: "Have 2501 currency",
    reward: 100,
    threshold: 2501,
  }),
];

// 💸 Currency Spent
const currencySpentAchievements = [
  currencySpentAchievement({
    id: "currency_spent_100",
    name: "Paycheck to Paycheck",
    description: "Spend 100 currency",
    reward: 5,
    threshold: 100,
  }),
  currencySpentAchievement({
    id: "currency_spent_400",
    name: "Shut Up And Take My Money",
    description: "Spend 400 currency",
    reward: 10,
    threshold: 400,
  }),
];

const currencyZeroedAchievements = currencyZeroedAchievement({
  id: "currency_zero",
  name: "On Welfare",
  description: "Spend all of your money",
  reward: 5,
});

// 🛍️ Store Purchases
const storePurchaseAchievements = [
  storePurchaseAchievement({
    id: "store_buy_1",
    name: "Cashback Activated",
    description: "Buy 1 thing from the store",
    reward: 5,
    threshold: 1,
  }),
  storePurchaseAchievement({
    id: "store_buy_3",
    name: "Keep The Change You Filthy Animal",
    description: "Buy 3 things from the store",
    reward: 8,
    threshold: 3,
  }),
  storePurchaseAchievement({
    id: "store_buy_5",
    name: "Customer Loyalty Program",
    description: "Buy 5 things from the store",
    reward: 15,
    threshold: 5,
  }),
  storeCompleteAchievement({
    id: "store_all",
    name: "Shopping Spree",
    description: "Buy everything from the store",
    reward: 25,
    threshold: 9,
  }),
];

const matchCompletionStreakAchievements = [
  matchCompletionStreakAchievement({
    id: "matches_completed_3_24h",
    name: "Playing The Game",
    description: "Complete 3 matches in a 24 hour time period",
    reward: 3,
    statKey: "matches_completed_24h",
    threshold: 3,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_5_24h",
    name: "Momentum",
    description: "Complete 5 matches in a 24 hour time period",
    reward: 5,
    statKey: "matches_completed_24h",
    threshold: 5,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_8_24h",
    name: "I'll Take A Break After This Next Match",
    description: "Complete 8 matches in a 24 hour time period",
    reward: 8,
    statKey: "matches_completed_24h",
    threshold: 8,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_10_24h",
    name: "Weekend Warrior",
    description: "Complete 10 matches in a 24 hour time period",
    reward: 12,
    statKey: "matches_completed_24h",
    threshold: 10,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_15_24h",
    name: "Machine, Not Man",
    description: "Complete 15 matches in a 24 hour time period",
    reward: 15,
    statKey: "matches_completed_24h",
    threshold: 15,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_20_24h",
    name: "Would Some Fresh Air Kill Ya?",
    description: "Complete 20 matches in a 24 hour time period",
    reward: 20,
    statKey: "matches_completed_24h",
    threshold: 20,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_25_24h",
    name: "You Have A Lot Of Free Time Don't You?",
    description: "Complete 25 matches in a 24 hour time period",
    reward: 25,
    statKey: "matches_completed_24h",
    threshold: 25,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_50_24h",
    name: "Shower, Touch Grass, Call Your Parents",
    description: "Complete 50 matches in a 24 hour time period",
    reward: 50,
    statKey: "matches_completed_24h",
    threshold: 50,
  }),
];

const dailyMatchStreakAchievements = [
  dailyMatchStreakAchievement({
    id: "streak_7_days",
    name: "I Like The Game!",
    description: "Play at least one match every day for 1 week",
    reward: 10,
    days: 7,
  }),
  dailyMatchStreakAchievement({
    id: "streak_30_days",
    name: "Officially A Regular",
    description: "Play at least one match every day for 30 days",
    reward: 25,
    days: 30,
  }),
];

const matchDurationAchievements = [
  matchDurationAchievement({
    id: "match_duration_30m",
    name: "Just Getting Started",
    description: "Play a match lasting 30 minutes",
    reward: 2,
    threshold: 30 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_45m",
    name: "Warmed Up",
    description: "Play a match lasting 45 minutes",
    reward: 4,
    threshold: 45 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_60m",
    name: "Putting The Time In",
    description: "Play a match lasting 1 hour",
    reward: 5,
    threshold: 60 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_2h",
    name: "Now THIS Is Podracing!",
    description: "Play a match lasting 2 hours",
    reward: 10,
    threshold: 2 * 60 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_3h",
    name: "Dedication",
    description: "Play a match lasting 3 hours",
    reward: 20,
    threshold: 3 * 60 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_5h",
    name: "You Should Eat Something And Drink Some Water",
    description: "Play a match lasting 5 hours",
    reward: 25,
    threshold: 5 * 60 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_10h",
    name: `"MOM! BATHROOM! BATHROOM!"`,
    description: "Play a match lasting 10 hours",
    reward: 50,
    threshold: 10 * 60 * 60 * 1000,
  }),
];

const metaAchievements = [
  achievementCountAchievement({
    id: "achievements_5",
    name: "Wow, Look At You Go!",
    description: "Unlock 5 achievements",
    reward: 3,
    threshold: 5,
  }),
  achievementCountAchievement({
    id: "achievements_10",
    name: "We're All Very Proud!",
    description: "Unlock 10 achievements",
    reward: 5,
    threshold: 10,
  }),
  achievementCountAchievement({
    id: "achievements_20",
    name: "Golden Star Sticker",
    description: "Unlock 20 achievements",
    reward: 8,
    threshold: 20,
  }),
  achievementCountAchievement({
    id: "achievements_30",
    name: "Hard Work Pays Off",
    description: "Unlock 30 achievements",
    reward: 10,
    threshold: 30,
  }),
  achievementCountAchievement({
    id: "achievements_50",
    name: "Achievement Hunter",
    description: "Unlock 50 achievements",
    reward: 20,
    threshold: 50,
  }),
  achievementCountAchievement({
    id: "achievements_75",
    name: "Checking Things Off",
    description: "Unlock 75 achievements",
    reward: 25,
    threshold: 75,
  }),
  achievementCountAchievement({
    id: "achievements_100",
    name: "Certified Tryhard",
    description: "Unlock 100 achievements",
    reward: 50,
    threshold: 100,
  }),
  achievementCountAchievement({
    id: "achievements_150",
    name: "Getting Close…",
    description: "Unlock 150 achievements",
    reward: 250,
    threshold: 150,
  }),
  achievementCountAchievement({
    id: "achievements_all",
    name: "IMPOSSIBLE!!! Achievementception",
    description: "Unlock all achievements",
    reward: 1000,
    threshold: 168, // override dynamically in evaluation logic
  }),
];

const readyCheckFailAchievements = [
  statThresholdAchievement({
    id: "readycheck_fail_1",
    name: "Ready… Or Not!",
    description: "Fail A Ready Check",
    reward: 1,
    statKey: "failed_ready_checks",
    threshold: 1,
  }),
];

const playersInMatchAchievements = [
  {
    id: "players_4",
    name: "High Turnover Industry",
    description: "Play with 4 different players in a single match",
    reward: 5,
    goal_type: "players_in_single_match",
    threshold: 4,
  },
  {
    id: "players_6",
    name: "Is It Me?",
    description: "Play with 6 different players in a single match",
    reward: 10,
    goal_type: "players_in_single_match",
    threshold: 6,
  },
  {
    id: "players_8",
    name: "Revolving Door",
    description: "Play with 8 different players in a single match",
    reward: 20,
    goal_type: "players_in_single_match",
    threshold: 8,
  },
  {
    id: "players_10",
    name: "Cursed Lobby",
    description: "Play with 10 different players in a single match",
    reward: 40,
    goal_type: "players_in_single_match",
    threshold: 10,
  },
];

const formationDiversityAchievements = {
  id: "formation_diversity",
  name: "Versatile",
  description: "Play a single match as a solo, duo, and trio",
  reward: 10,
  goal_type: "formation_diversity",
  check: async (playerId, db) => {
    const rows = await db.allAsync(
      `SELECT formation_type FROM formation_progress WHERE player_id = ?`,
      [playerId]
    );
    const formations = rows.map((r) => r.formation_type);
    return (
      formations.includes("solo") &&
      formations.includes("duo") &&
      formations.includes("trio")
    );
  },
};

const botMentionAchievements = {
  id: "bot_mention_1",
  name: `"Customer Service, How Can I Help You?"`,
  description: "@ the Bot in a match",
  reward: 3,
  goal_type: "mention_bot",
};

const selflessMvpAchievement = {
  id: "selfless_mvp",
  name: "Selfless",
  description: "Give 10 MVP points before receiving 1 yourself",
  reward: 10,
  check: async (playerId, db) => {
    const lastReceived = await db.getAsync(
      `SELECT MAX(awarded_at) AS lastReceived FROM mvp_awards WHERE receiver_id = ?`,
      [playerId]
    );

    const since = lastReceived?.lastReceived || 0;

    const givenAfter = await db.getAsync(
      `SELECT COUNT(*) AS count FROM mvp_awards WHERE giver_id = ? AND awarded_at > ?`,
      [playerId, since]
    );

    return givenAfter?.count >= 10;
  },
};

const soloReadyCheckAchievement = {
  id: "solo_ready",
  name: "All By Myself 🎶",
  description: "Be the only player to pass the ready check",
  reward: 10,
  goal_type: "ready_check_solo",
};

const leaveDuoAchievement = {
  id: "leave_duo",
  name: "Fake Friend",
  description: "Leave the queue while queued as a duo",
  reward: 2,
  formation: "duo",
};

const leaveTrioAchievement = {
  id: "leave_trio",
  name: "Go On Without Me!",
  description: "Leave the queue while queued as a trio",
  reward: 3,
  formation: "trio",
};

const mvpMaxDailyAchievement = {
  id: "mvp_max_daily",
  name: "Show Off",
  description: "Receive the 24 hour MVP award limit",
  reward: 8,
  cap: 10, // from your config
};

async function unlockAchievementIfNotEarned(playerId, achievementId) {
  const alreadyUnlocked = await db.getAsync(
    `SELECT 1 FROM player_achievements WHERE player_id = ? AND achievement_id = ?`,
    [playerId, achievementId]
  );

  if (alreadyUnlocked) {
    logger.debug(
      `🎯 Achievement already unlocked: ${achievementId} for ${playerId}`
    );
    return false;
  }

  const achievement = await db.getAsync(
    `SELECT * FROM achievements WHERE achievement_id = ?`,
    [achievementId]
  );

  if (!achievement) {
    logger.warn(
      `❌ Achievement ID not found: ${achievementId} for ${playerId}`
    );
    return false;
  }

  logger.info(
    `🏆 Achievement unlocked: ${achievementId} for ${playerId} (Reward: ${achievement.reward})`
  );

  await db.runAsync(
    `INSERT INTO player_achievements (player_id, achievement_id, unlocked_at) VALUES (?, ?, ?)`,
    [playerId, achievementId, Date.now()]
  );

  // 💰 Apply reward if applicable
  if (achievement.reward > 0) {
    await db.runAsync(
      `INSERT INTO player_currency (player_id, balance)
         VALUES (?, ?)
         ON CONFLICT(player_id) DO UPDATE SET balance = balance + ?`,
      [playerId, achievement.reward, achievement.reward]
    );

    await logCurrencyChange({
      playerId,
      amount: achievement.reward,
      source: "achievement",
      source_id: achievementId,
      modified_by: "system",
      reason: `Unlocked achievement: ${achievement.name}`,
    });
  }
  // 🟢 Unlock meta “achievement count” achievements
  setImmediate(() => {
    unlockMetaAchievementThreshold(playerId, db).catch((err) => {
      logger.errorWrapper("Meta achievement unlock failed", err, { playerId });
    });
  });

  // 📢 Send Discord alert
  try {
    const user = await client.users.fetch(playerId);
    const channel = await client.channels.fetch(QUEUE_ALERT_CHANNEL);
    if (channel && channel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setAuthor({
          name: `${user.username} unlocked a new achievement!`,
          iconURL: user.displayAvatarURL(),
        })
        .setTitle(`🏆 ${achievement.name}`)
        .setDescription(achievement.description)
        .addFields({
          name: "Reward",
          value: `${achievement.reward} 🪙`,
          inline: true,
        })
        .setTimestamp();

      await channel.send({
        content: `<@${playerId}> just unlocked an achievement!`,
        embeds: [embed],
      });
    }
  } catch (err) {
    console.warn("⚠️ Failed to send achievement alert:", err);
  }

  return true;
}

async function unlockMetaAchievementThreshold(playerId, db) {
  const row = await db.getAsync(
    `SELECT COUNT(*) AS count FROM player_achievements WHERE player_id = ?`,
    [playerId]
  );

  const unlockedCount = row?.count || 0;

  const sorted = metaAchievements.sort((a, b) => a.threshold - b.threshold);

  for (const achievement of sorted) {
    const alreadyUnlocked = await db.getAsync(
      `SELECT 1 FROM player_achievements WHERE player_id = ? AND achievement_id = ?`,
      [playerId, achievement.id]
    );
    if (alreadyUnlocked) continue;

    // Handle special case for 'achievements_all'
    const totalAchievements =
      achievement.id === "achievements_all"
        ? (await db.getAsync(`SELECT COUNT(*) AS total FROM achievements`))
            .total
        : achievement.threshold;

    if (unlockedCount >= totalAchievements) {
      await unlockAchievementIfNotEarned(playerId, achievement.id);
      break; // ✅ Only unlock one at a time
    }
  }
}

async function unlockMatchDurationAchievementThreshold(
  playerId,
  newDuration,
  db
) {
  // Sort by ascending threshold
  const sorted = matchDurationAchievements.sort(
    (a, b) => a.check.threshold - b.check.threshold
  );

  for (const achievement of sorted) {
    const alreadyUnlocked = await db.getAsync(
      `SELECT 1 FROM player_achievements WHERE player_id = ? AND achievement_id = ?`,
      [playerId, achievement.id]
    );
    if (alreadyUnlocked) continue;

    // Check if they *just reached* this threshold
    if (newDuration >= achievement.check.threshold) {
      await unlockAchievementIfNotEarned(playerId, achievement.id, db);
      break; // ✅ Only unlock one per update
    }
  }
}

async function checkDailyMatchStreakAchievements(playerId) {
  try {
    for (const achievement of dailyMatchStreakAchievements) {
      const passed = await achievement.check(playerId, db);
      if (passed) {
        await unlockAchievementIfNotEarned(playerId, achievement.id);
      }
    }
  } catch (err) {
    logger.warn("⚠️ Failed to check daily match streak achievements", {
      playerId,
      error: err.message,
    });
  }
}

async function checkCurrencyAchievements(playerId, db) {
  try {
    const row = await db.getAsync(
      `SELECT balance FROM player_currency WHERE player_id = ?`,
      [playerId]
    );

    const balance = row?.balance || 0;

    for (const achievement of currencyAchievements) {
      if (balance >= achievement.threshold) {
        await unlockAchievementIfNotEarned(playerId, achievement.id);
      }
    }
  } catch (err) {
    console.error("❌ Failed to check currency achievements:", err);
  }
}

async function checkMatchCompletionPointAchievements(playerId, db) {
  try {
    const row = await db.getAsync(
      `SELECT SUM(points) AS total FROM match_completion_awards WHERE player_id = ?`,
      [playerId]
    );

    const total = row?.total || 0;

    for (const achievement of matchCompletionPointAchievements) {
      if (await achievement.check(playerId, db)) {
        await unlockAchievementIfNotEarned(playerId, achievement.id);
      }
    }
  } catch (err) {
    console.error("❌ Failed to check match completion achievements:", err);
  }
}

async function checkMvpGivenAchievements(playerId, db) {
  try {
    const row = await db.getAsync(
      `SELECT COUNT(*) as count FROM mvp_awards WHERE giver_id = ?`,
      [playerId]
    );

    const givenCount = row?.count || 0;
    await unlockThresholdAchievementsFromValue(
      playerId,
      givenCount,
      mvpGivenAchievements
    );
    logger.info(
      `Checking MVP achievements for ${playerId}, count: ${givenCount}`
    );
  } catch (err) {
    logger.error("❌ Failed to check/unlock MVP given achievements", {
      playerId,
      error: err,
    });
  }
}

async function checkMvpReceivedAchievements(playerId, db) {
  try {
    const row = await db.getAsync(
      `SELECT COUNT(*) as count FROM mvp_awards WHERE receiver_id = ?`,
      [playerId]
    );

    const receivedCount = row?.count || 0;
    await unlockThresholdAchievementsFromValue(
      playerId,
      receivedCount,
      mvpReceivedAchievements
    );
    logger.info(
      `Checking MVP achievements for ${playerId}, count: ${receivedCount}`
    );
  } catch (err) {
    logger.error("❌ Failed to check/unlock MVP received achievements", {
      playerId,
      error: err,
    });
  }
}

async function unlockRepeatPartnerAchievements(playerId, repeatCount) {
  const unlockable = repeatPartnerAchievements.filter(
    (a) => repeatCount >= a.threshold
  );

  for (const achievement of unlockable) {
    try {
      await unlockAchievementIfNotEarned(playerId, achievement.id);
    } catch (err) {
      logger.warn("⚠️ Failed to unlock repeat partner achievement", {
        playerId,
        achievementId: achievement.id,
        error: err.message,
      });
    }
  }
}

async function unlockThresholdAchievementsFromValue(
  playerId,
  value,
  achievements
) {
  const unlocks = achievements.filter((a) => value >= a.threshold);
  if (value <= 0) return;

  for (const a of unlocks) {
    await unlockAchievementIfNotEarned(playerId, a.id);
  }
}
async function checkDualMvp(receiverId, matchId, db) {
  const rows = await db.allAsync(
    `SELECT giver_id FROM mvp_awards WHERE receiver_id = ? AND match_id = ?`,
    [receiverId, matchId]
  );

  const uniqueGivers = [...new Set(rows.map((r) => r.giver_id))];

  if (uniqueGivers.length >= 2) {
    await unlockAchievementIfNotEarned(receiverId, "mvp_dual");
  }
}

async function unlockStatThresholdAchievements(
  playerId,
  statKey,
  achievements
) {
  const row = await db.getAsync(
    `SELECT ${statKey} FROM player_statistics WHERE id = ?`,
    [playerId]
  );
  const value = row?.[statKey] || 0;

  const unlocks = achievements.filter((a) => value >= a.threshold);
  await Promise.all(
    unlocks.map((a) => unlockAchievementIfNotEarned(playerId, a.id))
  );
}

async function checkEventCompletionAchievements(playerId) {
  try {
    const row = await db.getAsync(
      `SELECT COUNT(*) AS count FROM event_progress WHERE player_id = ? AND completed = 1`,
      [playerId]
    );

    const completedCount = row?.count || 0;

    await unlockThresholdAchievementsFromValue(
      playerId,
      completedCount,
      eventCompletionAchievements
    );
  } catch (err) {
    logger.error("❌ Failed to check/unlock event completion achievements", {
      playerId,
      error: err,
    });
  }
}

async function checkSelflessMvpAchievement(playerId, db) {
  const lastReceived = await db.getAsync(
    `SELECT MAX(awarded_at) AS lastReceived FROM mvp_awards WHERE receiver_id = ?`,
    [playerId]
  );

  const since = lastReceived?.lastReceived || 0;

  const givenAfter = await db.getAsync(
    `SELECT COUNT(*) AS count FROM mvp_awards WHERE giver_id = ? AND awarded_at > ?`,
    [playerId, since]
  );

  if (givenAfter?.count >= 10) {
    await unlockAchievementIfNotEarned(playerId, "selfless_mvp");
  }
}

async function awardHighTurnoverAchievements(matchId) {
  try {
    const match = await db.getAsync(
      `SELECT initial_player_ids, final_player_ids FROM transcripts WHERE match_id = ?`,
      [matchId]
    );

    const initial = new Set(
      (match?.initial_player_ids || "").split(",").filter(Boolean)
    );
    const final = new Set(
      (match?.final_player_ids || "").split(",").filter(Boolean)
    );

    const events = await db.allAsync(
      `SELECT playerId, eventType, timestamp FROM match_events
           WHERE match_id = ? AND eventType IN ('join', 'leave', 'match_cleanup')
           ORDER BY timestamp ASC`,
      [matchId]
    );

    if (!events.length) {
      logger.warn("No match events found for turnover achievement", {
        matchId,
      });
      return;
    }

    // 📊 Build presence intervals per player
    const intervals = {};
    for (const { playerId, eventType, timestamp } of events) {
      if (!intervals[playerId]) intervals[playerId] = [];

      if (eventType === "join") {
        intervals[playerId].push({ start: timestamp, end: null });
      } else if (["leave", "match_cleanup"].includes(eventType)) {
        const open = intervals[playerId]?.find((i) => i.end === null);
        if (open) open.end = timestamp;
      }
    }

    // 🧠 For each player who started and finished, check overlap
    for (const [playerId, spans] of Object.entries(intervals)) {
      if (!initial.has(playerId) || !final.has(playerId)) continue;

      const seen = new Set();

      for (const { start, end } of spans) {
        for (const [otherId, otherSpans] of Object.entries(intervals)) {
          if (otherId === playerId) continue;

          for (const other of otherSpans) {
            const overlap =
              !end || !other.end || (start < other.end && end > other.start);
            if (overlap) {
              seen.add(otherId);
              break;
            }
          }
        }
      }

      const count = seen.size;

      if (count >= 10) {
        await unlockAchievementIfNotEarned(playerId, "players_10");
      } else if (count >= 8) {
        await unlockAchievementIfNotEarned(playerId, "players_8");
      } else if (count >= 6) {
        await unlockAchievementIfNotEarned(playerId, "players_6");
      } else if (count >= 4) {
        await unlockAchievementIfNotEarned(playerId, "players_4");
      }
    }
  } catch (err) {
    logger.errorWrapper("awardHighTurnoverAchievements", err, { matchId });
  }
}

async function checkRepeatPartnerAchievements(matchId, formationType, players) {
  const isEligibleFormation =
    formationType === "solo" || formationType === "duo";
  if (!isEligibleFormation || players.length < 2) return;

  const uniquePlayerIds = [...new Set(players)];

  for (const playerId of uniquePlayerIds) {
    const partnerIds = uniquePlayerIds.filter((id) => id !== playerId);

    // Skip if player is in a premade duo
    if (formationType === "duo") {
      const row = await db.getAsync(
        `SELECT duoPartner FROM players WHERE id = ?`,
        [playerId]
      );
      if (row?.duoPartner && partnerIds.includes(row.duoPartner)) continue;
    }

    for (const partnerId of partnerIds) {
      // Check how many times this player has previously played with this partner (excluding current match)
      const countRow = await db.getAsync(
        `
          SELECT COUNT(*) AS count
          FROM matches
          WHERE match_id != ?
            AND formation_type IN ('solo', 'duo')
            AND (
              (initial_player_ids LIKE ? AND initial_player_ids LIKE ?)
            )
          `,
        [matchId, `%${playerId}%`, `%${partnerId}%`]
      );

      const previousCount = countRow?.count || 0;
      const newCount = previousCount + 1;

      await unlockRepeatPartnerAchievements(playerId, newCount);
    }
  }
}

async function check24hMatchCompletionStreak(playerId) {
  try {
    const since = Date.now() - 24 * 60 * 60 * 1000;

    const rows = await db.allAsync(
      `SELECT closed_at FROM transcripts
         WHERE (',' || final_player_ids || ',') LIKE ? AND closed_at >= ?`,
      [`%,${playerId},%`, since]
    );

    const count = rows.length;

    await unlockThresholdAchievementsFromValue(
      playerId,
      count,
      matchCompletionStreakAchievements
    );
  } catch (err) {
    logger.warn("⚠️ Failed to check 24h match streak", {
      playerId,
      error: err.message,
    });
  }
}

async function checkReadyCheckMilestones(playerId) {
  const row = await db.getAsync(
    `SELECT ready_checks_passed FROM player_statistics WHERE id = ?`,
    [playerId]
  );

  const value = row?.ready_checks_passed || 0;
  const thresholds = [
    { id: "locked_and_loaded", value: 1 },
    { id: "eager_beaver", value: 10 },
    { id: "glued_to_the_screen", value: 25 },
    { id: "strapped_to_the_chair", value: 50 },
    { id: "no_bathroom_breaks", value: 100 },
    { id: "ready_player_one", value: 250 },
    { id: "i_was_born_ready", value: 500 },
  ];

  for (const { id, value: threshold } of thresholds) {
    if (value >= threshold) {
      await unlockAchievementIfNotEarned(playerId, id);
    }
  }
}

async function trackNewUniquePartners(playerIds = []) {
  if (playerIds.length < 2) return;

  const uniquePlayerIds = [...new Set(playerIds)];

  try {
    for (const playerId of uniquePlayerIds) {
      const partners = uniquePlayerIds.filter((id) => id !== playerId);

      try {
        // Insert or ignore partner entries in parallel
        await Promise.all(
          partners.map((partnerId) => {
            return new Promise((resolve, reject) => {
              db.run(
                `INSERT OR IGNORE INTO player_partners (player_id, partner_id)
                     VALUES (?, ?)`,
                [playerId, partnerId],
                (err) => (err ? reject(err) : resolve())
              );
            });
          })
        );

        // Count current total unique partners
        const totalPartners = await new Promise((resolve, reject) => {
          db.get(
            `SELECT COUNT(*) AS total FROM player_partners WHERE player_id = ?`,
            [playerId],
            (err, row) => (err ? reject(err) : resolve(row?.total || 0))
          );
        });

        logger.info(`👥 ${playerId} has ${totalPartners} unique partners`);

        // Unlock achievements based on thresholds
        await unlockUniquePartnerAchievements(
          playerId,
          uniquePartnerAchievements
        );
      } catch (err) {
        logger.errorWrapper("trackNewUniquePartners - Player Loop Error", err, {
          playerId,
        });
      }
    }
  } catch (err) {
    logger.errorWrapper("trackNewUniquePartners - Outer Error", err, {
      playerIds,
    });
  }
}

async function unlockUniquePartnerAchievements(playerId, achievements) {
  const row = await db.getAsync(
    `SELECT COUNT(DISTINCT partner_id) AS count FROM player_partners WHERE player_id = ?`,
    [playerId]
  );
  const totalPartners = row?.count || 0;

  const unlocks = achievements.filter((a) => totalPartners >= a.threshold);
  await Promise.all(
    unlocks.map((a) => unlockAchievementIfNotEarned(playerId, a.id))
  );
}

async function checkFormationDiversity(playerId) {
  const row = await db.getAsync(
    `SELECT queue_entries_solo, queue_entries_duo, queue_entries_trio FROM player_statistics WHERE id = ?`,
    [playerId]
  );
  if (
    row?.queue_entries_solo &&
    row.queue_entries_duo &&
    row.queue_entries_trio
  ) {
    await unlockAchievementIfNotEarned(playerId, "formation_diversity");
  }
}

async function checkPlatformDiversity(playerId) {
  const row = await db.getAsync(
    `SELECT platform_usage_pc, platform_usage_xbox, platform_usage_playstation FROM player_statistics WHERE id = ?`,
    [playerId]
  );
  if (
    row?.platform_usage_pc &&
    row.platform_usage_xbox &&
    row.platform_usage_playstation
  ) {
    await unlockAchievementIfNotEarned(playerId, "platforms_all");
  }
}

const achieveExports = {
  readyCheckAchievements,
  allQueueEntryAchievements,
  matchesPlayedAchievements,
  vcTimeAchievements,
  messageAchievements,
  duoQueueAchievements,
  trioQueueAchievements,
  uniquePartnerAchievements,
  repeatPartnerAchievements,
  mentionAchievement,
  botMentionAchievements,
  selflessMvpAchievement,
  soloReadyCheckAchievement,
  leaveDuoAchievement,
  leaveTrioAchievement,
  mvpMaxDailyAchievement,
  currencyAchievements,
  currencySpentAchievements,
  dailyMatchStreakAchievements,
  eventCompletionAchievements,
  formationDiversityAchievements,
  matchCompletionPointAchievements,
  matchCompletionStreakAchievements,
  matchDurationAchievements,
  metaAchievements,
  mvpCooldownAbuseAchievement,
  mvpGivenAchievements,
  mvpReceivedAchievements,
  platformAchievements,
  playersInMatchAchievements,
  readyCheckFailAchievements,
  storePurchaseAchievements,
  currencyZeroedAchievements,
  dualMvpAchieved,

  // Combined list
  allAchievements: [
    ...readyCheckAchievements,
    ...allQueueEntryAchievements,
    ...matchesPlayedAchievements,
    ...vcTimeAchievements,
    ...messageAchievements,
    ...duoQueueAchievements,
    ...trioQueueAchievements,
    ...uniquePartnerAchievements,
    ...repeatPartnerAchievements,
    mentionAchievement,
    platformAchievements,
    botMentionAchievements,
    selflessMvpAchievement,
    soloReadyCheckAchievement,
    leaveDuoAchievement,
    leaveTrioAchievement,
    mvpMaxDailyAchievement,
    currencyZeroedAchievements,
    dualMvpAchieved,
    ...currencyAchievements,
    ...currencySpentAchievements,
    ...dailyMatchStreakAchievements,
    ...eventCompletionAchievements,
    formationDiversityAchievements,
    ...matchCompletionPointAchievements,
    ...matchCompletionStreakAchievements,
    ...matchDurationAchievements,
    ...metaAchievements,
    mvpCooldownAbuseAchievement,
    ...mvpGivenAchievements,
    ...mvpReceivedAchievements,
    ...platformAchievements,
    ...playersInMatchAchievements,
    ...readyCheckFailAchievements,
    ...storePurchaseAchievements,
  ],
  // Common stat helpers
  statThresholdAchievement,
  uniquePartnersAchievement,
  repeatPartnerAchievement,
  mvpGivenAchievement,
  mvpReceivedAchievement,
  eventCompletionAchievement,
  matchCompletionPointAchievement,
  matchCompletionStreakAchievement,
  dailyMatchStreakAchievement,
  matchDurationAchievement,
  achievementCountAchievement,
  currencyThresholdAchievement,

  vcTimeAchievement,
  messageCountAchievement,
  platformUsageAchievement,

  samePartnerCountAchievement,

  storePurchaseAchievement,

  // Custom logic helpers
  mentionChastisedAchievement,
  dualMvpAchievement,
  mvpCooldownAttemptAchievement,
  currencySpentAchievement,
  currencyZeroedAchievement,
  storeCompleteAchievement,

  botMentionAchievement,
  formationDiversityAchievement,
  playersInMatchAchievement,
  unlockAchievementIfNotEarned,
  awardHighTurnoverAchievements,
  checkRepeatPartnerAchievements,
  check24hMatchCompletionStreak,
  checkReadyCheckMilestones,
  trackNewUniquePartners,
  checkEventCompletionAchievements,
  unlockStatThresholdAchievements,
  unlockUniquePartnerAchievements,
  checkMvpGivenAchievements,
  checkMvpReceivedAchievements,
  checkSelflessMvpAchievement,
  checkMatchCompletionPointAchievements,
  checkCurrencyAchievements,
  checkDailyMatchStreakAchievements,
  unlockMatchDurationAchievementThreshold,
  checkFormationDiversity,
  checkPlatformDiversity,
  checkDualMvp,
};

module.exports = achieveExports;
