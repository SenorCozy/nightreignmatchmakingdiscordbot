// utils/permissions.js
require("dotenv").config();

const ALLOWED_ROLE_IDS = [
  process.env.TICKET_HANDLER_ROLE,
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
];

function hasModRole(member) {
  return ALLOWED_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId));
}

module.exports = { hasModRole };
