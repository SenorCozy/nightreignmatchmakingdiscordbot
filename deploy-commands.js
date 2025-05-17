const { REST, Routes } = require("discord.js");
const fs = require("fs");
require("dotenv").config();
const logger = require("./logger");

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.BOT_TOKEN;

const commands = [];
const commandFiles = fs
  .readdirSync("./commands")
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  try {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
    logger.info(`📦 Loaded command: ${command.data.name}`);
  } catch (err) {
    logger.errorWrapper("CommandLoadFailure", err, { file });
  }
}

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    logger.info(`🔁 Refreshing ${commands.length} application (/) commands...`);

    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });

    logger.info("✅ Successfully reloaded application (/) commands.");
  } catch (error) {
    logger.errorWrapper("CommandDeployFailure", error);
  }
})();
