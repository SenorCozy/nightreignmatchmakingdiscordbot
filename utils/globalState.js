// utils/globalState.js
const logger = require("../logger");

// Initialize a global variable for player platform selections if not already present
if (!global.playerPlatformSelection) {
  global.playerPlatformSelection = {};
  logger.debug("Initialized global.playerPlatformSelection");
}

module.exports = {
  playerPlatformSelection: global.playerPlatformSelection,
};
