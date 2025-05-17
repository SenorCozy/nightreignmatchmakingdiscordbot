const { createLogger, format, transports } = require("winston");
const TransportStream = require("winston-transport");
const axios = require("axios");

// Discord Webhook URL
const DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1346678762527391836/iD9AddosVbO7glszPqDH1oI_jr6weHDC5nfJZBvZYqmbxbe-a7x74QwwP8eybH6R3AVf"; // Replace with your webhook URL

// Define the logger
const logger = createLogger({
  level: "info", // Log only errors
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ level, message, timestamp, stack }) => {
          return stack
            ? `[${timestamp}] ${level}: ${message}\n${stack}`
            : `[${timestamp}] ${level}: ${message}`;
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
