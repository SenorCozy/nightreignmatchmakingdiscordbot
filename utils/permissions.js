// utils/permissions.js
require("dotenv").config();
const logger = require("../logger");

let ALLOWED_ROLE_IDS = [];

try {
  ALLOWED_ROLE_IDS = [
    process.env.TICKET_HANDLER_ROLE,
    process.env.ELDEN_MODERATOR_ROLE,
    process.env.ELDEN_ENFORCER_ROLE,
  ].filter(Boolean);

  if (ALLOWED_ROLE_IDS.length === 0) {
    logger.warn("No valid moderator role IDs found in environment variables.");
  }
} catch (err) {
  logger.errorWrapper("permissions_env_init", err);
}

function hasModRole(member) {
  try {
    return ALLOWED_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId));
  } catch (err) {
    logger.errorWrapper("hasModRole_check", err, { userId: member.id });
    return false;
  }
}

module.exports = { hasModRole };
