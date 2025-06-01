// utils/goalTypeHandlers.js
module.exports = {
  // Called during startMatch (thread creation)
  play_match: ({ playerId, metadata }) => 1,
  matches_played: ({ playerId, metadata }) => 1,
  play_match_trio: ({ playerId, metadata }) =>
    metadata.formationType === "trio" ? 1 : 0,
  play_with_user: ({ playerId, metadata }) =>
    metadata.partnerIds?.includes(playerId) ? 1 : 0,

  // Called during cleanupMatch for staying till end
  complete_match: ({ playerId, metadata }) => (metadata.stayedUntilEnd ? 1 : 0),
  complete_long_match: ({ playerId, metadata }) =>
    metadata.matchDuration >= 90 * 60 * 1000 ? 1 : 0,
  complete_1_hour_match: ({ playerId, metadata }) =>
    metadata.matchDuration >= 60 * 60 * 1000 ? 1 : 0,
  complete_with_user: ({ playerId, metadata }) =>
    metadata.partnerIds?.includes(playerId) && metadata.stayedUntilEnd ? 1 : 0,

  // Called from queue handlers
  queue_entries: () => 1,
  solo_queues: ({ metadata }) => (metadata.queueType === "solo" ? 1 : 0),
  duo_queues: ({ metadata }) => (metadata.queueType === "duo" ? 1 : 0),
  trio_queues: ({ metadata }) => (metadata.queueType === "trio" ? 1 : 0),
  solo_stranger_matches: ({ metadata }) =>
    metadata.queueType === "solo" && metadata.partnerIds?.length === 0 ? 1 : 0,

  // Called during VC tracking
  vc_minutes: ({ metadata }) => metadata.minutes || 0,

  // Called during MVP awards
  mvp_earned: () => 1,

  // Called during message tracking
  messages_sent: () => 1,

  //called during ready check
  ready_checks_clean: (playerId, options) => {
    // Return "disqualified" if the player failed
    if (options?.disqualified) return "disqualified";
    return 1;
  },

  // Called during match completion point award
  match_completion_points: ({ metadata }) => metadata.points || 0,

  // Called during duo/trio tracking
  repeat_duo: ({ metadata }) => (metadata.duoPartner ? 1 : 0),
  repeat_trio: ({ metadata }) => (metadata.trioGroup ? 1 : 0),
  unique_partners: ({ metadata }) => metadata.newUniquePartners || 0,

  // Called manually
  manual_submission: ({ metadata }) => (metadata.submitted ? 1 : 0),

  matches_completed: ({ playerId, metadata }) =>
    metadata.stayedUntilEnd ? 1 : 0,
  matches_completed_duo: ({ playerId, metadata }) =>
    metadata.stayedUntilEnd && metadata.formationType === "duo" ? 1 : 0,
  matches_completed_trio: ({ playerId, metadata }) =>
    metadata.stayedUntilEnd && metadata.formationType === "trio" ? 1 : 0,
  play_match_duo: ({ metadata }) => (metadata.formationType === "duo" ? 1 : 0),
  platforms_played: ({ metadata }) => (metadata.platform ? 1 : 0), // or track unique platforms per player if needed
};
