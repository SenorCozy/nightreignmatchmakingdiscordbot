const activeReadyChecks = new Map();

function isReadyCheckActive(threadId) {
  return activeReadyChecks.has(threadId);
}

function startReadyCheck(threadId, initialPlayerId) {
  activeReadyChecks.set(threadId, {
    initiator: initialPlayerId, // ✅ store initiator
    readyPlayers: new Set([initialPlayerId]),
    startedAt: Date.now(),
  });
}

function addReadyPlayer(threadId, playerId) {
  const state = activeReadyChecks.get(threadId);
  if (state) state.readyPlayers.add(playerId);
}

function getReadyPlayers(threadId) {
  return activeReadyChecks.get(threadId)?.readyPlayers ?? new Set();
}

function getReadyCheckInitiator(threadId) {
  return activeReadyChecks.get(threadId)?.initiator ?? null;
}

function endReadyCheck(threadId) {
  activeReadyChecks.delete(threadId);
}

module.exports = {
  isReadyCheckActive,
  startReadyCheck,
  addReadyPlayer,
  getReadyPlayers,
  getReadyCheckInitiator, // ✅ make sure this is exported
  endReadyCheck,
};
