const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");
const logger = require("./logger");

// Path to the database
const dbPath = path.join(__dirname, "matchmaking.db");

// Backup directory
const backupDir = path.join(__dirname, "backups");

// Ensure the backup directory exists
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir);
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.errorWrapper("DatabaseOpen", err);
    return;
  }

  logger.info("✅ Connected to the matchmaking database.");

  db.serialize(() => {
    // Players
    db.run(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        status TEXT NOT NULL,
        duoPartner TEXT DEFAULT NULL,
        trioPartner1 TEXT DEFAULT NULL,
        trioPartner2 TEXT DEFAULT NULL,
        queue_entered_at INTEGER DEFAULT NULL,
        last_queue_exit_at INTEGER DEFAULT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS queue_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playerId TEXT NOT NULL,
        platform TEXT,
        duoPartner TEXT,
        queue_entered_at INTEGER,
        queue_left_at INTEGER,
        trioPartner1 TEXT,
        trioPartner2 TEXT
      )
    `);

    // Channels
    db.run(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        threadId TEXT NOT NULL,
        voiceChannelId TEXT DEFAULT NULL,
        match_id TEXT NOT NULL,
        playerIds TEXT NOT NULL,
        lastActivity INTEGER NOT NULL,
        lastReadyCheck INTEGER DEFAULT 0
      )
    `);

    // Matches and Events
    db.run(`
      CREATE TABLE IF NOT EXISTS match_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id TEXT NOT NULL,
        threadId TEXT NOT NULL,
        playerId TEXT NOT NULL,
        eventType TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        reason TEXT DEFAULT NULL,
        final_status TEXT DEFAULT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS mvp_awards (
        giver_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        match_id TEXT NOT NULL,
        awarded_at INTEGER NOT NULL,
        PRIMARY KEY (giver_id, receiver_id, match_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        goal_type TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        event_type TEXT DEFAULT 'one_time',
        active INTEGER DEFAULT 1,
        reward INTEGER,
        goal_target INTEGER,
        cooldown_ms INTEGER DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS event_tiers (
        tier_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        tier_index INTEGER NOT NULL,
        goal_target INTEGER NOT NULL,
        reward INTEGER NOT NULL,
        FOREIGN KEY (event_id) REFERENCES events(event_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS event_progress (
        player_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        last_tier_index_awarded INTEGER DEFAULT 0,
        last_increment_at INTEGER DEFAULT 0,
        PRIMARY KEY (player_id, event_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS event_submissions (
        submission_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        submitted_at INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        content TEXT,
        attachment_url TEXT,
        status TEXT DEFAULT 'pending',
        admin_note TEXT,
        reviewed_by TEXT,
        reviewed_at INTEGER,
        is_duplicate INTEGER DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS event_submission_participants (
        submission_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        PRIMARY KEY (submission_id, player_id),
        FOREIGN KEY (submission_id) REFERENCES event_submissions(submission_id)
      )
    `);

    // Achievements and Currency
    db.run(`
      CREATE TABLE IF NOT EXISTS achievements (
        achievement_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        reward INTEGER NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS player_achievements (
        player_id TEXT NOT NULL,
        achievement_id TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, achievement_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS player_currency (
        player_id TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS currency_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL,
        amount_changed INTEGER NOT NULL,
        source TEXT NOT NULL,
        source_id TEXT DEFAULT NULL,
        modified_by TEXT NOT NULL,
        modified_at INTEGER NOT NULL,
        reason TEXT DEFAULT NULL
      )
    `);

    // Shop Roles
    db.run(`
      CREATE TABLE IF NOT EXISTS shop_roles (
        role_id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        price INTEGER NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS player_purchases (
        player_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        purchased_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, role_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS match_completion_awards (
        match_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        awarded_at INTEGER NOT NULL,
        points INTEGER NOT NULL,
        modified_by TEXT,
        action_type TEXT,
        PRIMARY KEY (match_id, player_id)
      )
    `);

    // Player Stats
    db.run(`
      CREATE TABLE IF NOT EXISTS player_statistics (
        id TEXT PRIMARY KEY,
        queue_entries INTEGER DEFAULT 0,
        queue_entries_solo INTEGER DEFAULT 0,
        queue_entries_duo INTEGER DEFAULT 0,
        matches_played INTEGER DEFAULT 0,
        matches_completed INTEGER DEFAULT 0,
        top_platform TEXT DEFAULT NULL,
        vc_time INTEGER DEFAULT 0,
        messages_sent INTEGER DEFAULT 0,
        queue_entered_at INTEGER DEFAULT NULL,
        queue_left_at INTEGER DEFAULT NULL,
        duoPartner TEXT DEFAULT NULL,
        status TEXT DEFAULT 'completed',
        platform TEXT DEFAULT 'unknown',
        failed_ready_checks INTEGER DEFAULT 0,
        longest_match_time INTEGER DEFAULT 0,
        total_match_time INTEGER DEFAULT 0,
        platform_usage_pc INTEGER DEFAULT 0,
        platform_usage_xbox INTEGER DEFAULT 0,
        platform_usage_playstation INTEGER DEFAULT 0,
        queue_entries_trio INTEGER DEFAULT 0,
        ready_checks_passed INTEGER DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS blacklist (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        reason TEXT DEFAULT ''
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS duo_partner_counts (
        player_id TEXT NOT NULL,
        partner_id TEXT NOT NULL,
        pair_count INTEGER DEFAULT 0,
        PRIMARY KEY (player_id, partner_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS player_partners (
        player_id TEXT NOT NULL,
        partner_id TEXT NOT NULL,
        PRIMARY KEY (player_id, partner_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS trio_partner_counts (
        player_id TEXT NOT NULL,
        partner_id TEXT NOT NULL,
        pair_count INTEGER DEFAULT 0,
        PRIMARY KEY (player_id, partner_id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS trio_partner_groups (
        trio_id TEXT PRIMARY KEY,
        player1_id TEXT NOT NULL,
        player2_id TEXT NOT NULL,
        player3_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        active INTEGER DEFAULT 1
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS bot_statistics (
        stat_key TEXT PRIMARY KEY,
        stat_value INTEGER DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS match_players (
        match_id TEXT NOT NULL,
        threadId TEXT NOT NULL,
        playerId TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        leave_in_progress INTEGER DEFAULT 0,
        joined_at INTEGER DEFAULT NULL,
        PRIMARY KEY (match_id, playerId)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS matches (
        match_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        platform TEXT,
        created_by TEXT,
        created_at TIMESTAMP NOT NULL,
        closed_at TIMESTAMP DEFAULT NULL,
        closed_by TEXT DEFAULT NULL,
        closure_reason TEXT DEFAULT NULL,
        match_start_time INTEGER DEFAULT 0,
        formation_type TEXT DEFAULT NULL,
        initial_player_ids TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS formation_progress (
        player_id TEXT NOT NULL,
        formation_type TEXT NOT NULL,
        achieved_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (player_id, formation_type)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        user_id TEXT,
        username TEXT,
        closed_by TEXT,
        closed_by_username TEXT,
        closure_reason TEXT DEFAULT NULL,
        created_at TIMESTAMP NOT NULL,
        closed_at TIMESTAMP NOT NULL,
        player_ids TEXT NOT NULL,
        initial_player_ids TEXT DEFAULT NULL,
        interim_player_ids TEXT DEFAULT NULL,
        final_player_ids TEXT DEFAULT NULL,
        platform TEXT DEFAULT NULL
      )
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_transcripts_final 
      ON transcripts(final_player_ids, closed_at)
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS transcript_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transcript_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        avatar_url TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        attachment_url TEXT DEFAULT NULL,
        embed_data TEXT DEFAULT NULL,
        reactions TEXT DEFAULT NULL,
        FOREIGN KEY (transcript_id) REFERENCES transcripts(id)
      )
    `);

    // ✅ Settings Table
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    db.run(`
      INSERT INTO settings (key, value) VALUES 
        ('matchmaking_paused', '0'),
        ('matchmaking_interval', '10000')
      ON CONFLICT(key) DO NOTHING
    `);

    logger.info("✅ Database schema verified and initialized.");
  });
});

// Daily backup job
cron.schedule("0 0 * * *", () => {
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const backupFile = path.join(backupDir, `matchmaking-backup-${timestamp}.db`);
  const backupRetentionDays = 7;

  fs.readdir(backupDir, (err, files) => {
    if (err) {
      logger.error("Failed to read backup directory:", err.message);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(backupDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          logger.error(`Failed to stat file ${file}:`, err.message);
          return;
        }

        const fileAgeInDays =
          (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
        if (fileAgeInDays > backupRetentionDays) {
          fs.unlink(filePath, (err) => {
            if (err) {
              logger.error(`Failed to delete old backup ${file}:`, err.message);
            } else {
              console.log(`Deleted old backup: ${file}`);
            }
          });
        }
      });
    });
  });

  fs.copyFile(dbPath, backupFile, (err) => {
    if (err) {
      logger.error("Failed to back up the database:", err.message);
    } else {
      console.log(`Database backed up successfully to ${backupFile}`);
    }
  });
});

const { promisify } = require("util");

db.runAsync = promisify(db.run.bind(db));
db.getAsync = promisify(db.get.bind(db));
db.allAsync = promisify(db.all.bind(db));

module.exports = db;
