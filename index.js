require("dotenv").config();
require("./logFlusher");

const db = require("./database.js");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const { setupRecurringEventHandler } = require("./utils/eventUtils");

const {
  createAudioPlayer,
  createAudioResource,
  VoiceConnectionStatus,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const { checkThreadIntegrity } = require("./utils/threadIntegrityChecker");

const handleInteraction = require("./interactions/interactionCreate");
const { cleanupMatches } = require("./utils/matchmakingUtils/matchUtils");
const eventsPath = path.join(__dirname, "interactions", "events");
const threadMemberUpdateHandler = require("./interactions/events/threadMemberUpdate");
const scheduleHourlyMessage = require("./hourlyMessage");

const eventFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith(".js"));

console.log("✅ DB from index.js:", typeof db !== "undefined");

db.get("SELECT name FROM sqlite_master WHERE type='table'", (err, row) => {
  if (err) console.error("Database error:", err);
  else console.log("Database tables:", row);
});
const {
  Client,
  Intents,
  GatewayIntentBits,
  ButtonBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonStyle,
  ChannelType,
  InteractionType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
  ComponentType,
} = require("discord.js");
const { setTimeout } = require("timers");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// load events
for (const file of eventFiles) {
  try {
    const event = require(path.join(eventsPath, file));
    if (event.once) client.once(event.name, (...a) => event.execute(...a));
    else client.on(event.name, (...a) => event.execute(...a));
    logger.info(`Loaded event: ${event.name}`);
  } catch (err) {
    logger.errorWrapper("EventLoad", err, { file });
  }
}

// Load commands into client.commands
client.commands = new Map();
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

const commandDataArray = [];
const loadedCommandNames = new Set();

for (const file of commandFiles) {
  try {
    const command = require(path.join(commandsPath, file));
    if (
      command?.data &&
      typeof command.execute === "function" &&
      !loadedCommandNames.has(command.data.name)
    ) {
      client.commands.set(command.data.name, command);
      commandDataArray.push(command.data);
      loadedCommandNames.add(command.data.name);
      logger.info(`Loaded command: ${command.data.name}`);
    } else {
      logger.warn(
        loadedCommandNames.has(command.data?.name)
          ? `Duplicate command skipped: ${command.data.name}`
          : `Invalid command skipped: ${file}`
      );
    }
  } catch (err) {
    logger.errorWrapper("CommandLoad", err, { file });
  }
}

// clean up inactive matches function scans for matches to clean up then executes cleanupmatch
setInterval(() => cleanupMatches(client), 300000);
// Run every 5 minutes CHANGE BACK!!
setupRecurringEventHandler();

// STATISTICS
// Player statistics

// bot login token
client.login(process.env.BOT_TOKEN);
client.on("ready", async () => {
  logger.info(`Logged in as: ${client.user.tag}`);
  console.log(`Logged in as: ${client.user.tag}`);
  console.log(`Connected to ${client.guilds.cache.size} guilds.`);

  try {
    const guild = client.guilds.cache.first();
    await guild.commands.set(commandDataArray);
    logger.info(`Registered ${commandDataArray.length} commands.`);
  } catch (err) {
    logger.errorWrapper("RegisterCommands", err);
  }

  // ✅ Start hourly reminder loop
  scheduleHourlyMessage(client);

  // 🔁 Report connected guilds
  client.guilds.cache.forEach((guild) => {
    console.log(`Checking guild: ${guild.name}`);
  });
});

global.client = client;

// reports # of servers bot is active in
client.guilds.cache.forEach(async (guild) => {
  console.log(`Checking guild: ${guild.name}`);
});

console.log("🔁 Registered interactionCreate");
