const fs = require("fs");
const path = require("path");
const logger = require("../logger");
const goalTypes = require("../utils/goalTypes");

const buttonHandlers = new Map();
const regexHandlers = [];
const commandHandlers = new Map();
const modalHandlers = new Map();
const regexModalHandlers = [];

// Load modal handlers
const modalPath = path.join(__dirname, "modals");
if (fs.existsSync(modalPath)) {
  const modalFiles = fs
    .readdirSync(modalPath)
    .filter((file) => file.endsWith(".js"));

  for (const file of modalFiles) {
    const modal = require(path.join(modalPath, file));
    if (modal?.customId && typeof modal.execute === "function") {
      modalHandlers.set(modal.customId, modal.execute);
      logger.info(`📥 Registered modal: ${modal.customId}`);
    } else if (modal?.customIdRegex && typeof modal.execute === "function") {
      regexModalHandlers.push({
        ...modal,
        regex: modal.customIdRegex,
      });
      logger.info(`📥 Registered regex modal handler: ${modal.customIdRegex}`);
    }
  }
}

// Load button handlers
const buttonFiles = fs
  .readdirSync(path.join(__dirname, "buttons"))
  .filter((file) => file.endsWith(".js"));

for (const file of buttonFiles) {
  const button = require(`./buttons/${file}`);
  if (button.customId && typeof button.execute === "function") {
    buttonHandlers.set(button.customId, button.execute);
    logger.info(`🔘 Registered button: ${button.customId}`);
  } else if (
    (button.regex || button.customIdRegex) &&
    typeof button.execute === "function"
  ) {
    regexHandlers.push({
      ...button,
      regex: button.customIdRegex || button.regex,
    });
    logger.info(`🔧 Registered regex button handler: ${file}`);
  }
}

// Load slash commands
const commandsPath = path.join(__dirname, "..", "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && typeof command.execute === "function") {
    commandHandlers.set(command.data.name, command.execute);
    logger.info(`⚡ Registered command: ${command.data.name}`);
  }
}

module.exports = async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused();

      const filtered = goalTypes
        .filter(
          (g) =>
            g.description.toLowerCase().includes(focused.toLowerCase()) ||
            g.key.toLowerCase().includes(focused.toLowerCase())
        )
        .slice(0, 25)
        .map((g) => ({ name: g.description, value: g.key }));

      return await interaction.respond(filtered);
    }

    if (interaction.isButton()) {
      const customId = interaction.customId.toLowerCase();

      if (buttonHandlers.has(customId)) {
        return await buttonHandlers.get(customId)(interaction);
      }

      const matched = regexHandlers.find((b) => b.regex.test(customId));
      if (matched) {
        logger.info("🔧 Routed to regex button handler", { customId });
        return await matched.execute(interaction);
      }

      logger.warn("⚠️ No button handler found", { customId });
    } else if (interaction.isCommand()) {
      const handler = commandHandlers.get(interaction.commandName);
      if (handler) {
        return await handler(interaction);
      } else {
        logger.warn("⚠️ No command handler found", {
          command: interaction.commandName,
        });
      }
    } else if (interaction.isModalSubmit()) {
      const exact = modalHandlers.get(interaction.customId);
      if (exact) {
        return await exact(interaction);
      }

      const matched = regexModalHandlers.find((m) =>
        m.regex.test(interaction.customId)
      );

      if (matched) {
        logger.info("📥 Routed to regex modal handler", {
          customId: interaction.customId,
        });
        return await matched.execute(interaction);
      }

      logger.warn("⚠️ No modal handler found", {
        customId: interaction.customId,
      });
    }
  } catch (error) {
    logger.errorWrapper("❌ Error handling interaction", error, {
      interactionType: interaction.type,
      user: interaction.user?.tag,
      customId: interaction.customId,
      command: interaction.commandName,
    });

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
