const fs = require("fs");
const path = require("path");
const axios = require("axios");
const zlib = require("zlib");
const FormData = require("form-data");
const logger = require("./logger");

require("dotenv").config();

const DISCORD_WEBHOOK_URL = process.env.BACKUP_WEBHOOK_URL;
const backupDir = path.join(__dirname, "backups");

async function uploadLatestBackup() {
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.endsWith(".db"))
      .sort(
        (a, b) =>
          fs.statSync(path.join(backupDir, b)).mtime -
          fs.statSync(path.join(backupDir, a)).mtime
      );

    if (!files.length) {
      console.log("⚠️ No backup files found.");
      return;
    }

    const latestFile = files[0];
    const originalPath = path.join(backupDir, latestFile);
    const compressedPath = originalPath + ".gz";

    // Compress to .gz
    await new Promise((resolve, reject) => {
      const gzip = zlib.createGzip();
      const source = fs.createReadStream(originalPath);
      const destination = fs.createWriteStream(compressedPath);

      source.pipe(gzip).pipe(destination);
      destination.on("finish", resolve);
      destination.on("error", reject);
    });

    const form = new FormData();
    form.append(
      "file",
      fs.createReadStream(compressedPath),
      path.basename(compressedPath)
    );
    form.append(
      "payload_json",
      JSON.stringify({
        content: `📦 Uploaded compressed database backup: \`${path.basename(
          compressedPath
        )}\``,
      })
    );

    await axios.post(DISCORD_WEBHOOK_URL, form, {
      headers: form.getHeaders(),
    });

    console.log(
      `✅ Uploaded backup ${path.basename(compressedPath)} to Discord.`
    );

    // Optional: remove the compressed file after upload
    fs.unlink(compressedPath, (err) => {
      if (err) {
        console.warn("⚠️ Failed to delete compressed file:", err.message);
      }
    });
  } catch (err) {
    logger.errorWrapper("❌ DB Backup Upload Failed", err);
  }
}

module.exports = uploadLatestBackup;
