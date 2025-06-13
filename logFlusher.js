const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cron = require("node-cron");
const FormData = require("form-data");
const zlib = require("zlib");

require("dotenv").config();

// Discord webhook for log delivery
const DISCORD_WEBHOOK_URL = process.env.BACKUP_WEBHOOK_URL;

const logDir = path.join(__dirname, "logs");
const rawLogPath = path.join(logDir, "error.log");

function flushLogFile() {
  if (!fs.existsSync(rawLogPath)) {
    console.log("No error.log file found to flush.");
    return;
  }

  const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const compressedFileName = `error-${dateStr}.log.gz`;
  const compressedFilePath = path.join(logDir, compressedFileName);

  // Gzip the current error.log
  const input = fs.createReadStream(rawLogPath);
  const output = fs.createWriteStream(compressedFilePath);
  const gzip = zlib.createGzip();

  input.pipe(gzip).pipe(output);

  output.on("finish", async () => {
    try {
      const form = new FormData();
      form.append(
        "file",
        fs.createReadStream(compressedFilePath),
        compressedFileName
      );

      await axios.post(DISCORD_WEBHOOK_URL, form, {
        headers: form.getHeaders(),
      });

      // Truncate the original log after successful upload
      fs.truncate(rawLogPath, 0, (err) => {
        if (err) {
          console.error("❌ Failed to truncate error.log:", err.message);
        } else {
          console.log("✅ error.log sent, truncated.");
        }
      });

      // Optionally delete the .gz after sending (or archive it elsewhere)
      fs.unlink(compressedFilePath, () => {});
    } catch (err) {
      console.error(
        "❌ Failed to send compressed log to Discord webhook:",
        err.message
      );
    }
  });

  output.on("error", (err) => {
    console.error("❌ Failed to compress error.log:", err.message);
  });
}

// Run daily at midnight server time
cron.schedule("0 0 * * *", flushLogFile);

module.exports = flushLogFile;
