// clean-global-commands.js
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");
require("dotenv").config();

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

const CLIENT_ID = process.env.CLIENT_ID;

(async () => {
  try {
    console.log("🧹 Fetching global commands...");
    const commands = await rest.get(Routes.applicationCommands(CLIENT_ID));

    if (!commands.length) {
      console.log("✅ No global commands to delete.");
      return;
    }

    for (const command of commands) {
      await rest.delete(Routes.applicationCommand(CLIENT_ID, command.id));
      console.log(`❌ Deleted global command: ${command.name}`);
    }

    console.log("✅ All global commands removed.");
  } catch (error) {
    console.error("❌ Error cleaning up global commands:", error);
  }
})();
