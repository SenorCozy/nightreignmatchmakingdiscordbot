require("dotenv").config();
require("./logFlusher");

const db = require("./database.js");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const { setupRecurringEventHandler } = require("./utils/eventUtils");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  VoiceConnectionStatus,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const { checkThreadIntegrity } = require("./utils/threadIntegrityChecker");

const googleTTS = require("google-tts-api"); // TTS API to generate speech
const { createAudioStream } = require("prism-media"); // Convert to audio stream
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

client.on("ready", async () => {
  logger.info(`Logged in as: ${client.user.tag}`);

  try {
    const guild = client.guilds.cache.first();
    await guild.commands.set(commandDataArray);
    logger.info(`Registered ${commandDataArray.length} commands.`);
  } catch (err) {
    logger.errorWrapper("RegisterCommands", err);
  }

  // ✅ Start hourly reminder loop
  scheduleHourlyMessage(client);
});

//TTS test function
async function announceVCWarning(voiceChannel, message) {
  if (!voiceChannel) return console.error("No valid voice channel provided.");

  // ✅ Generate TTS audio URL
  const ttsUrl = googleTTS.getAudioUrl(message, {
    lang: "en",
    slow: false,
    host: "https://translate.google.com",
  });

  // ✅ Create a voice connection
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false, // Keep bot undeafened to interact
  });

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log("🔊 Bot is ready in the VC!");
  });

  // ✅ Create an audio player
  const player = createAudioPlayer();
  const resource = createAudioResource(ttsUrl); // Load the TTS URL

  // ✅ Handle audio events
  player.on(AudioPlayerStatus.Idle, () => {
    console.log("✅ Finished playing the message. Leaving VC...");
    connection.destroy(); // Leave the VC
  });

  player.on("error", (err) => {
    console.error("❌ Error in voice playback:", err);
    connection.destroy();
  });

  // ✅ Play the TTS message
  player.play(resource);
  connection.subscribe(player);
}

// clean up inactive matches function scans for matches to clean up then executes cleanupmatch
setInterval(() => cleanupMatches(client), 10000);
// Run every 5 minutes CHANGE BACK!!
setupRecurringEventHandler();

setTimeout(() => {
  setInterval(() => checkThreadIntegrity(client), 480000); // runs every 10s
}, 30000); // wait 30s before starting the loop
// 3 minutes CHANGE BACK

// STATISTICS
// Player statistics

// bot login token
client.login(process.env.BOT_TOKEN);
client.on("ready", async () => {
  console.log(`Logged in as: ${client.user.tag}`);
  console.log(`Connected to ${client.guilds.cache.size} guilds.`);
});

global.client = client;

// reports # of servers bot is active in
client.guilds.cache.forEach(async (guild) => {
  console.log(`Checking guild: ${guild.name}`);
});

console.log("🔁 Registered interactionCreate");
