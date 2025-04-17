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
    logger.error("Error opening database:", err.message);
  } else {
    console.log("Connected to the matchmaking database.");

    // ✅ Players Table
    db.run(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        status TEXT NOT NULL,
        duoPartner TEXT DEFAULT NULL,
        queue_entered_at INTEGER DEFAULT NULL
      )
    `);

    // ✅ Channels Table (Bot-created threads and voice channels)
    db.run(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        threadId TEXT NOT NULL,
        voiceChannelId TEXT DEFAULT NULL,
        playerIds TEXT NOT NULL,
        lastActivity INTEGER NOT NULL,
        lastReadyCheck INTEGER DEFAULT 0
      )
    `);

    // Ensure matchmaking settings exist
    db.run(`
   INSERT INTO settings (key, value) VALUES 
  ('matchmaking_paused', '0'),
  ('matchmaking_interval', '10000')
  ON CONFLICT(key) DO NOTHING;
`);

    // ✅ Player Statistics Table
    db.run(`
      CREATE TABLE IF NOT EXISTS player_statistics (
        id TEXT PRIMARY KEY,
        queue_entries INTEGER DEFAULT 0,
        queue_entries_solo INTEGER DEFAULT 0,
        queue_entries_duo INTEGER DEFAULT 0,
        matches_played INTEGER DEFAULT 0,
        top_platform TEXT DEFAULT NULL,
        vc_time INTEGER DEFAULT 0,
        messages_sent INTEGER DEFAULT 0,
        queue_entered_at INTEGER DEFAULT NULL,
        queue_left_at INTEGER DEFAULT NULL,
        duoPartner TEXT DEFAULT NULL,
        status TEXT DEFAULT 'completed',  -- Ensures tracking of queue completion
        platform TEXT DEFAULT 'unknown',  -- Fixes missing platform column
        failed_ready_checks INTEGER DEFAULT 0,
        longest_match_time INTEGER DEFAULT 0
      )
    `);

    // ✅ Blacklist Table
    db.run(`
      CREATE TABLE IF NOT EXISTS blacklist (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        reason TEXT DEFAULT ''
      )
    `);

    // ✅ Duo Partner Counts Table
    db.run(`
      CREATE TABLE IF NOT EXISTS duo_partner_counts (
        player_id TEXT NOT NULL,
        partner_id TEXT NOT NULL,
        pair_count INTEGER DEFAULT 0,
        PRIMARY KEY (player_id, partner_id)
      )
    `);

    // ✅ Bot Statistics Table
    db.run(`
      CREATE TABLE IF NOT EXISTS bot_statistics (
        stat_key TEXT PRIMARY KEY,
        stat_value INTEGER DEFAULT 0
      )
    `);

    // ✅ Settings Table (Queue Lock Feature)
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    console.log("✅ Database schema verified and initialized.");
  }
});

// Schedule daily database backups at midnight
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

module.exports = db;
