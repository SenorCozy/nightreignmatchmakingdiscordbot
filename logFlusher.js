const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cron = require("node-cron");
const FormData = require("form-data");

const DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1346678762527391836/iD9AddosVbO7glszPqDH1oI_jr6weHDC5nfJZBvZYqmbxbe-a7x74QwwP8eybH6R3AVf";

const logFilePath = path.join(__dirname, "logs", "error.log");

function flushLogFile() {
  if (!fs.existsSync(logFilePath)) {
    console.log("No log file to flush.");
    return;
  }

  const form = new FormData();
  form.append("file", fs.createReadStream(logFilePath), "error.log");

  axios
    .post(DISCORD_WEBHOOK_URL, form, {
      headers: form.getHeaders(),
    })
    .then(() => {
      // Clear the log after sending
      fs.truncate(logFilePath, 0, (err) => {
        if (err) {
          console.error("Failed to truncate log:", err.message);
        } else {
          console.log("✅ error.log sent to Discord and truncated.");
        }
      });
    })
    .catch((err) => {
      console.error("❌ Failed to send log to Discord webhook:", err.message);
    });
}

// Run every day at midnight server time
cron.schedule("0 0 * * *", flushLogFile);

module.exports = flushLogFile;
