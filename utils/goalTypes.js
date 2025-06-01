module.exports = [
  // 📌 General Match Participation
  { key: "matches_played", description: "Complete any match." },
  { key: "play_match", description: "Participate in any match." },
  { key: "play_match_duo", description: "Participate in a duo match." },
  { key: "play_match_trio", description: "Participate in a trio match." },

  // 📌 Match Completion
  { key: "complete_match", description: "Complete a full match." },
  { key: "matches_completed", description: "Stay until the end of any match." },
  {
    key: "matches_completed_duo",
    description: "Stay until the end of a duo match.",
  },
  {
    key: "matches_completed_trio",
    description: "Stay until the end of a trio match.",
  },
  {
    key: "complete_with_user",
    description: "Complete a match with specific players.",
  },
  {
    key: "complete_long_match",
    description: "Complete a long match (90+ min).",
  },
  {
    key: "complete_1_hour_match",
    description: "Complete a match 60+ minutes long.",
  },

  // 📌 Queuing
  { key: "queue_entries", description: "Enter any queue." },
  { key: "solo_queues", description: "Queue as a solo." },
  { key: "duo_queues", description: "Queue as a duo." },
  { key: "trio_queues", description: "Queue as a trio." },

  // 📌 Team Dynamics
  { key: "unique_partners", description: "Play with unique teammates." },
  {
    key: "repeat_duo",
    description: "Play matches with the same duo partner(s).",
  },
  { key: "repeat_trio", description: "Play matches with the same trio group." },
  { key: "play_with_user", description: "Play matches with specific players." },

  // 📌 Special Match Types
  {
    key: "solo_stranger_matches",
    description: "Play solo matches with no known teammates.",
  },
  { key: "platforms_played", description: "Play on multiple platforms." },

  // 📌 Communication & Performance
  { key: "vc_minutes", description: "Time spent in voice channels." },
  { key: "messages_sent", description: "Messages sent in match threads." },
  { key: "mvp_earned", description: "Receive MVP awards." },
  {
    key: "ready_checks_clean",
    description: "Finish matches without failing ready checks.",
  },

  // 📌 Reward System Integration
  {
    key: "match_completion_points",
    description: "Earn match completion points for full participation.",
  },

  // 📌 Manual Review
  {
    key: "manual_submission",
    description: "Manual review tasks like submitting videos or screenshots.",
  },
];
