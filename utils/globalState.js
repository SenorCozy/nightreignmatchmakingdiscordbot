// utils/globalState.js
const db = require("../database");
if (!global.playerPlatformSelection) {
  global.playerPlatformSelection = {};
}

module.exports = {
  playerPlatformSelection: global.playerPlatformSelection,
};
