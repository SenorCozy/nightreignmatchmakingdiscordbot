/**
 * Stores temporary duo queue metadata before final queue entry.
 * Each playerId maps to an object like:
 * {
 *   friendId: "234567890123456789",
 *   platform: "pc"
 * }
 */

const pendingDuoQueue = new Map();

module.exports = {
  pendingDuoQueue,
};
