// utils/matchVoteState.js
const activeMatchEndVotes = new Map(); // threadId => Set of userIds
const matchEndCollectors = new Map(); // threadId => MessageComponentCollector
const activeKickVotes = new Map(); // `${threadId}:${targetId}` => Set of userIds
const kickCollectors = new Map(); // `${threadId}:${targetId}` => Collector
const voteMessages = new Map(); // voteKey => Message

module.exports = {
  activeMatchEndVotes,
  matchEndCollectors,
  activeKickVotes,
  kickCollectors,
  voteMessages,
};
