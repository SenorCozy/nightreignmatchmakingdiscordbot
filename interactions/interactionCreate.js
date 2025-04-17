const fs = require("fs");
const path = require("path");
const { InteractionType } = require("discord.js");

const buttonHandlers = new Map();
const regexHandlers = [];

// Load button handlers
const buttonFiles = fs
  .readdirSync(path.join(__dirname, "buttons"))
  .filter((file) => file.endsWith(".js"));

for (const file of buttonFiles) {
  const button = require(`./buttons/${file}`);

  if (button.customId && typeof button.execute === "function") {
    buttonHandlers.set(button.customId, button.execute);
  } else if (button.regex && typeof button.execute === "function") {
    regexHandlers.push(button);
  }
}

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

module.exports = async (interaction) => {
  if (!interaction.isButton()) return;

  const customId = interaction.customId.toLowerCase();

  try {
    // Exact match
    if (buttonHandlers.has(customId)) {
      return await buttonHandlers.get(customId)(interaction);
    }

    // Regex match
    const matched = regexHandlers.find((b) => b.regex.test(customId));
    if (matched) {
      return await matched.execute(interaction);
    }

    // No match found
    logger.warn(`⚠️ No button handler found for customId: ${customId}`);
  } catch (error) {
    logger.error(`❌ Error handling button ${customId}:`, error);

    const errorReply = {
      content: "❌ Something went wrong while handling this button.",
      flags: 64,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorReply).catch(() => {});
    } else {
      await interaction.reply(errorReply).catch(() => {});
    }
  }
};
