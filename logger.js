const { createLogger, format, transports } = require("winston");
const TransportStream = require("winston-transport");
const axios = require("axios");

// Discord Webhook URL
const DISCORD_WEBHOOK_URL = process.env.BACKUP_WEBHOOK_URL; // Replace with your webhook URL

// Define the logger
const logger = createLogger({
  level: "debug", // Log only errors
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      level: "debug", // ✅ Enable debug logs in PM2 console
      format: format.combine(
        format.colorize(),
        format.printf(({ level, message, timestamp, ...meta }) => {
          return `[${timestamp}] ${level}: ${message}${
            Object.keys(meta).length ? "\n" + JSON.stringify(meta, null, 2) : ""
          }`;
        })
      ),
    }),
    new transports.File({ filename: "logs/error.log" }),
  ],
});

// Custom Discord Transport
class DiscordTransport extends TransportStream {
  constructor(opts) {
    super(opts);
  }

  log(info, callback) {
    setImmediate(() => this.emit("logged", info));

    if (info.level === "error") {
      axios
        .post(DISCORD_WEBHOOK_URL, {
          content: `**Critical Error Logged:**\n\`\`\`${info.message}\n${
            info.stack || ""
          }\`\`\``,
        })
        .catch((err) => {
          console.error("Failed to send log to Discord:", err.message);
        });
    }

    callback();
  }
}

// Add the Discord transport to the logger
logger.add(new DiscordTransport());

// Add this just before `module.exports = logger;`

logger.errorWrapper = function (context, err, extra = {}) {
  const baseMessage = `[${context}] ${err?.message || err}`;
  const meta = {
    stack: err?.stack,
    ...extra,
  };
  this.error(baseMessage, meta);
};

module.exports = logger;
