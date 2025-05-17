const fs = require("fs");
const path = require("path");
const { logger } = require("../logger"); // Make sure you have this

const buttonHandlers = new Map();
const regexHandlers = [];
const commandHandlers = new Map();
const modalHandlers = new Map();

const modalPath = path.join(__dirname, "modals");
if (fs.existsSync(modalPath)) {
  const modalFiles = fs
    .readdirSync(modalPath)
    .filter((file) => file.endsWith(".js"));

  for (const file of modalFiles) {
    const modal = require(path.join(modalPath, file));
    if (modal?.customId && typeof modal.execute === "function") {
      modalHandlers.set(modal.customId, modal.execute);
    }
  }
}

// Load button handlers from interactions/buttons
const buttonFiles = fs
  .readdirSync(path.join(__dirname, "buttons"))
  .filter((file) => file.endsWith(".js"));

for (const file of buttonFiles) {
  const button = require(`./buttons/${file}`);
  if (button.customId && typeof button.execute === "function") {
    buttonHandlers.set(button.customId, button.execute);
  } else if (
    (button.regex || button.customIdRegex) &&
    typeof button.execute === "function"
  ) {
    regexHandlers.push({
      ...button,
      regex: button.customIdRegex || button.regex,
    });
  }
}

// Load command handlers from ../commands (root level)
const commandsPath = path.join(__dirname, "..", "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && typeof command.execute === "function") {
    commandHandlers.set(command.data.name, command.execute);
  }
}

module.exports = async (interaction) => {
  try {
    if (interaction.isButton()) {
      const customId = interaction.customId.toLowerCase();

      if (buttonHandlers.has(customId)) {
        return await buttonHandlers.get(customId)(interaction);
      }

      const matched = regexHandlers.find((b) => b.regex.test(customId));
      if (matched) {
        console.info(`🔧 Routed to regex handler for ${customId}`);
        return await matched.execute(interaction);
      }

      console.warn(`⚠️ No button handler found for customId: ${customId}`);
    } else if (interaction.isCommand()) {
      const handler = commandHandlers.get(interaction.commandName);
      if (handler) {
        await handler(interaction);
      }
    } else if (interaction.isModalSubmit()) {
      const handler = modalHandlers.get(interaction.customId);
      if (handler) {
        return await handler(interaction);
      } else {
        console.warn(
          `⚠️ No modal handler for customId: ${interaction.customId}`
        );
      }
    }
  } catch (error) {
    console.error(`❌ Error handling interaction:`, error);

    const errorReply = {
      content: "❌ Something went wrong while handling this interaction.",
      flags: 64,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorReply).catch(() => {});
    } else {
      await interaction.reply(errorReply).catch(() => {});
    }
  }
};
