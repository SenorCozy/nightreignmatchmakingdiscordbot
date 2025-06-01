const readyCheckAchievements = [
  statThresholdAchievement({
    id: "ready_check_1",
    name: "Locked and Loaded",
    description: "Passed first ready check",
    reward: 2,
    statKey: "ready_checks_passed",
    threshold: 1,
  }),
  statThresholdAchievement({
    id: "ready_check_10",
    name: "Eager Beaver",
    description: "Passed 10 ready checks",
    reward: 4,
    statKey: "ready_checks_passed",
    threshold: 10,
  }),
  statThresholdAchievement({
    id: "ready_check_25",
    name: "Glued to the Screen",
    description: "Passed 25 ready checks",
    reward: 8,
    statKey: "ready_checks_passed",
    threshold: 25,
  }),
  statThresholdAchievement({
    id: "ready_check_50",
    name: "Strapped To The Chair",
    description: "Passed 50 ready checks",
    reward: 12,
    statKey: "ready_checks_passed",
    threshold: 50,
  }),
  statThresholdAchievement({
    id: "ready_check_100",
    name: "No Bathroom Breaks",
    description: "Passed 100 ready checks",
    reward: 18,
    statKey: "ready_checks_passed",
    threshold: 100,
  }),
  statThresholdAchievement({
    id: "ready_check_250",
    name: "Ready Player One",
    description: "Passed 250 ready checks",
    reward: 25,
    statKey: "ready_checks_passed",
    threshold: 250,
  }),
  statThresholdAchievement({
    id: "ready_check_500",
    name: "I Was Born Ready",
    description: "Passed 500 ready checks",
    reward: 50,
    statKey: "ready_checks_passed",
    threshold: 500,
  }),
];

const allQueueEntryAchievements = [
  statThresholdAchievement({
    id: "queue_entry_1",
    name: "A Journey of A Thousand Miles Begins With A Single Step",
    description: "First queue entry",
    reward: 2,
    statKey: "queue_entries",
    threshold: 1,
  }),
  statThresholdAchievement({
    id: "queue_entry_10",
    name: "Getting Your Feet Wet",
    description: "10 queue entries",
    reward: 4,
    statKey: "queue_entries",
    threshold: 10,
  }),
  statThresholdAchievement({
    id: "queue_entry_25",
    name: "Queue Curious",
    description: "25 queue entries",
    reward: 8,
    statKey: "queue_entries",
    threshold: 25,
  }),
  statThresholdAchievement({
    id: "queue_entry_50",
    name: "Finding A Groove",
    description: "50 queue entries",
    reward: 12,
    statKey: "queue_entries",
    threshold: 50,
  }),
  statThresholdAchievement({
    id: "queue_entry_100",
    name: "Matchmaker",
    description: "100 queue entries",
    reward: 18,
    statKey: "queue_entries",
    threshold: 100,
  }),
  statThresholdAchievement({
    id: "queue_entry_250",
    name: "Queue Walker",
    description: "250 queue entries",
    reward: 20,
    statKey: "queue_entries",
    threshold: 250,
  }),
  statThresholdAchievement({
    id: "queue_entry_500",
    name: `"Do You Know What We're In Line For?"`,
    description: "500 queue entries",
    reward: 30,
    statKey: "queue_entries",
    threshold: 500,
  }),
  statThresholdAchievement({
    id: "queue_entry_1000",
    name: `"Addicted? Me? Nooooooo…"`,
    description: "1000 queue entries",
    reward: 50,
    statKey: "queue_entries",
    threshold: 1000,
  }),
];

const matchesPlayedAchievements = [
  statThresholdAchievement({
    id: "matches_played_1",
    name: "First Blood",
    description: "First match played",
    reward: 2,
    statKey: "matches_played",
    threshold: 1,
  }),
  statThresholdAchievement({
    id: "matches_played_10",
    name: "Getting The Hang of This",
    description: "10 matches played",
    reward: 4,
    statKey: "matches_played",
    threshold: 10,
  }),
  statThresholdAchievement({
    id: "matches_played_25",
    name: "Matchmaker",
    description: "25 matches played",
    reward: 8,
    statKey: "matches_played",
    threshold: 25,
  }),
  statThresholdAchievement({
    id: "matches_played_50",
    name: "Match Veteran",
    description: "50 matches played",
    reward: 15,
    statKey: "matches_played",
    threshold: 50,
  }),
  statThresholdAchievement({
    id: "matches_played_100",
    name: "Are Ya Winning Son?",
    description: "100 matches played",
    reward: 20,
    statKey: "matches_played",
    threshold: 100,
  }),
  statThresholdAchievement({
    id: "matches_played_250",
    name: "You Could Say I Like The Game",
    description: "250 matches played",
    reward: 25,
    statKey: "matches_played",
    threshold: 250,
  }),
  statThresholdAchievement({
    id: "matches_played_500",
    name: `"Ahh Shit, Here We Go Again!"`,
    description: "500 matches played",
    reward: 30,
    statKey: "matches_played",
    threshold: 500,
  }),
  statThresholdAchievement({
    id: "matches_played_1000",
    name: "I Don't Own Any Other Games",
    description: "1000 matches played",
    reward: 50,
    statKey: "matches_played",
    threshold: 1000,
  }),
];

const vcTimeAchievements = [
  vcTimeAchievement({
    id: "vc_time_10m",
    name: `"Testing, Testing, Mic Check"`,
    description: "Spend 10 minutes in VC",
    reward: 3,
    threshold: 10 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_30m",
    name: "Talkative",
    description: "Spend 30 minutes in VC",
    reward: 5,
    threshold: 30 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_1h",
    name: "Loqaucious",
    description: "Spend an hour in VC",
    reward: 8,
    threshold: 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_4h",
    name: "Certified Yapper",
    description: "Spend 4 hours in VC",
    reward: 15,
    threshold: 4 * 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_10h",
    name: "Talk Radio",
    description: "Spend 10 hours in VC",
    reward: 20,
    threshold: 10 * 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_24h",
    name: "A Day Well Spent!",
    description: "Spend 24 hours in VC",
    reward: 25,
    threshold: 24 * 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_50h",
    name: "A Career in Broadcast",
    description: "Spend 50 hours in VC",
    reward: 40,
    threshold: 50 * 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_100h",
    name: "Yap God",
    description: "Spend 100 hours in VC",
    reward: 50,
    threshold: 100 * 60 * 60 * 1000,
  }),
  vcTimeAchievement({
    id: "vc_time_250h",
    name: "The One Who Speaks",
    description: "Spend 250 hours in VC",
    reward: 60,
    threshold: 250 * 60 * 60 * 1000,
  }),
];

const messageAchievements = [
  messageCountAchievement({
    id: "messages_1",
    name: "Hello, World.",
    description: "First message sent",
    reward: 1,
    threshold: 1,
  }),
  messageCountAchievement({
    id: "messages_25",
    name: "Speak From Your Chest",
    description: "Send 25 Messages",
    reward: 2,
    threshold: 25,
  }),
  messageCountAchievement({
    id: "messages_50",
    name: "Did You Get My Message?",
    description: "Send 50 Messages",
    reward: 4,
    threshold: 50,
  }),
  messageCountAchievement({
    id: "messages_75",
    name: "Chatterbox",
    description: "Send 75 Messages",
    reward: 6,
    threshold: 75,
  }),
  messageCountAchievement({
    id: "messages_100",
    name: "Message Received",
    description: "Send 100 messages",
    reward: 8,
    threshold: 100,
  }),
  messageCountAchievement({
    id: "messages_150",
    name: "Socialite",
    description: "Send 150 messages",
    reward: 10,
    threshold: 150,
  }),
  messageCountAchievement({
    id: "messages_250",
    name: "Talking Talking Talking",
    description: "Send 250 messages",
    reward: 12,
    threshold: 250,
  }),
  messageCountAchievement({
    id: "messages_500",
    name: "Keyboard Warrior",
    description: "Send 500 messages",
    reward: 14,
    threshold: 500,
  }),
  messageCountAchievement({
    id: "messages_1000",
    name: "You Got Something To Say?",
    description: "Send 1000 messages",
    reward: 16,
    threshold: 1000,
  }),
  messageCountAchievement({
    id: "messages_1500",
    name: "Preacher",
    description: "Send 1500 messages",
    reward: 18,
    threshold: 1500,
  }),
  messageCountAchievement({
    id: "messages_2000",
    name: "Echo Chamber",
    description: "Send 2000 messages",
    reward: 20,
    threshold: 2000,
  }),
  messageCountAchievement({
    id: "messages_3000",
    name: "Spamurai",
    description: "Send 3000 messages",
    reward: 22,
    threshold: 3000,
  }),
  messageCountAchievement({
    id: "messages_4000",
    name: "The Gift Of Gab",
    description: "Send 4000 messages",
    reward: 24,
    threshold: 4000,
  }),
  messageCountAchievement({
    id: "messages_5000",
    name: "Wall Of Text",
    description: "Send 5000 messages",
    reward: 25,
    threshold: 5000,
  }),
  messageCountAchievement({
    id: "messages_7500",
    name: "Captcha Failed",
    description: "Send 7500 messages",
    reward: 50,
    threshold: 7500,
  }),
  messageCountAchievement({
    id: "messages_10000",
    name: "Bot Detected",
    description: "Send 10000 messages",
    reward: 75,
    threshold: 10000,
  }),
];

const mentionAchievement = mentionChastisedAchievement({
  id: "mention_blocked",
  name: "Busted!",
  description: "@ Mention Chastised triggered",
  reward: 3,
});

const duoQueueAchievements = [
  statThresholdAchievement({
    id: "duo_queue_1",
    name: "Phone A Friend",
    description: "Queue as a Duo for the first time",
    reward: 2,
    statKey: "queue_entries_duo",
    threshold: 1,
  }),
  statThresholdAchievement({
    id: "duo_queue_10",
    name: "2 for 1",
    description: "Queue as a Duo 10 times",
    reward: 4,
    statKey: "queue_entries_duo",
    threshold: 10,
  }),
  statThresholdAchievement({
    id: "duo_queue_25",
    name: "Packaged Deal",
    description: "Queue as a Duo 25 times",
    reward: 8,
    statKey: "queue_entries_duo",
    threshold: 25,
  }),
  statThresholdAchievement({
    id: "duo_queue_50",
    name: "Partner In Crime",
    description: "Queue as a Duo 50 times",
    reward: 12,
    statKey: "queue_entries_duo",
    threshold: 50,
  }),
  statThresholdAchievement({
    id: "duo_queue_100",
    name: "I Can't Play Without Them",
    description: "Queue as a Duo 100 times",
    reward: 18,
    statKey: "queue_entries_duo",
    threshold: 100,
  }),
  statThresholdAchievement({
    id: "duo_queue_250",
    name: "Best Friends For Life!",
    description: "Queue as a Duo 250 times",
    reward: 20,
    statKey: "queue_entries_duo",
    threshold: 250,
  }),
  statThresholdAchievement({
    id: "duo_queue_500",
    name: "Siamese Twins",
    description: "Queue as a Duo 500 times",
    reward: 30,
    statKey: "queue_entries_duo",
    threshold: 500,
  }),
];

const trioQueueAchievements = [
  statThresholdAchievement({
    id: "trio_queue_1",
    name: "Seats Taken",
    description: "Queue as a Trio for the first time",
    reward: 2,
    statKey: "queue_entries_trio",
    threshold: 1,
  }),
  statThresholdAchievement({
    id: "trio_queue_10",
    name: "The Gangs All Here!",
    description: "Queue as a Trio 10 times",
    reward: 4,
    statKey: "queue_entries_trio",
    threshold: 10,
  }),
  statThresholdAchievement({
    id: "trio_queue_25",
    name: "We're Shy",
    description: "Queue as a Trio 25 times",
    reward: 8,
    statKey: "queue_entries_trio",
    threshold: 25,
  }),
  statThresholdAchievement({
    id: "trio_queue_50",
    name: "Three's Company",
    description: "Queue as a Trio 50 times",
    reward: 12,
    statKey: "queue_entries_trio",
    threshold: 50,
  }),
  statThresholdAchievement({
    id: "trio_queue_100",
    name: "The Holy Trinity",
    description: "Queue as a Trio 100 times",
    reward: 18,
    statKey: "queue_entries_trio",
    threshold: 100,
  }),
  statThresholdAchievement({
    id: "trio_queue_250",
    name: "No Social Skills",
    description: "Queue as a Trio 250 times",
    reward: 20,
    statKey: "queue_entries_trio",
    threshold: 250,
  }),
  statThresholdAchievement({
    id: "trio_queue_500",
    name: "You Guys Really, Really Don't Like Other People Do You?",
    description: "Queue as a Trio 500 times",
    reward: 30,
    statKey: "queue_entries_trio",
    threshold: 500,
  }),
];

const uniquePartnerAchievements = [
  uniquePartnersAchievement({
    id: "unique_players_2",
    name: "Making Friends",
    description: "Play with 2 Unique Players",
    reward: 2,
    threshold: 2,
  }),
  uniquePartnersAchievement({
    id: "unique_players_5",
    name: "Putting Yourself Out There",
    description: "Play with 5 Unique Players",
    reward: 5,
    threshold: 5,
  }),
  uniquePartnersAchievement({
    id: "unique_players_10",
    name: "Getting To Know New People",
    description: "Play with 10 Unique Players",
    reward: 5,
    threshold: 10,
  }),
  uniquePartnersAchievement({
    id: "unique_players_25",
    name: "New Names, New Faces",
    description: "Play with 25 Unique Players",
    reward: 5,
    threshold: 25,
  }),
  uniquePartnersAchievement({
    id: "unique_players_50",
    name: "I'm Social",
    description: "Play with 50 Unique Players",
    reward: 8,
    threshold: 50,
  }),
  uniquePartnersAchievement({
    id: "unique_players_75",
    name: "Branching Out",
    description: "Play with 75 Unique Players",
    reward: 10,
    threshold: 75,
  }),
  uniquePartnersAchievement({
    id: "unique_players_100",
    name: "Well-Connected",
    description: "Play with 100 Unique Players",
    reward: 10,
    threshold: 100,
  }),
  uniquePartnersAchievement({
    id: "unique_players_150",
    name: "Social Butterfly",
    description: "Play with 150 Unique Players",
    reward: 15,
    threshold: 150,
  }),
  uniquePartnersAchievement({
    id: "unique_players_225",
    name: "Popular",
    description: "Play with 225 Unique Players",
    reward: 15,
    threshold: 225,
  }),
  uniquePartnersAchievement({
    id: "unique_players_300",
    name: "I Get Around",
    description: "Play with 300 Unique Players",
    reward: 15,
    threshold: 300,
  }),
  uniquePartnersAchievement({
    id: "unique_players_500",
    name: "No Man Is Unknown To Me",
    description: "Play with 500 Unique Players",
    reward: 25,
    threshold: 500,
  }),
  uniquePartnersAchievement({
    id: "unique_players_1000",
    name: "Friend To All Humankind",
    description: "Play with 1000 Unique Players",
    reward: 50,
    threshold: 1000,
  }),
];

const repeatPartnerAchievements = [
  repeatPartnerAchievement({
    id: "repeat_partner_2",
    name: "Funny Seeing You Here",
    description: "Play with the same player randomly twice",
    reward: 4,
    threshold: 2,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_4",
    name: "What Are The Odds?",
    description: "Play with the same player randomly four times",
    reward: 8,
    threshold: 4,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_8",
    name: "Déjà Vu",
    description: "Play with the same player randomly eight times",
    reward: 12,
    threshold: 8,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_10",
    name: "Are You Following Me?",
    description: "Play with the same player randomly 10 times",
    reward: 15,
    threshold: 10,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_25",
    name: "Stalker",
    description: "Play with the same player randomly 25 times",
    reward: 20,
    threshold: 25,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_50",
    name: "Have I Seen You Somewhere Before?",
    description: "Play with the same player randomly 50 times",
    reward: 25,
    threshold: 50,
  }),
  repeatPartnerAchievement({
    id: "repeat_partner_100",
    name: "It's A Small World Afterall",
    description: "Play with the same player randomly 100 times",
    reward: 50,
    threshold: 100,
  }),
];

// 🟢 All Platforms Played
const platformAchievements = [
  platformUsageAchievement({
    id: "platforms_all",
    name: "Well Traveled",
    description: "Completed a match on all 3 platforms",
    reward: 20,
  }),
];

// 🟢 Events Completed
const eventCompletionAchievements = [
  eventCompletionAchievement({
    id: "events_1",
    name: "Extra Credit",
    description: "Complete your first event",
    reward: 2,
    threshold: 1,
  }),
  eventCompletionAchievement({
    id: "events_3",
    name: "New Hobby",
    description: "Complete your third event",
    reward: 4,
    threshold: 3,
  }),
  eventCompletionAchievement({
    id: "events_10",
    name: "On The Board",
    description: "Complete your 10th event",
    reward: 8,
    threshold: 10,
  }),
  eventCompletionAchievement({
    id: "events_25",
    name: "Habit Forming",
    description: "Complete your 25th event",
    reward: 12,
    threshold: 25,
  }),
  eventCompletionAchievement({
    id: "events_50",
    name: "Overachiever",
    description: "Complete your 50th event",
    reward: 18,
    threshold: 50,
  }),
  eventCompletionAchievement({
    id: "events_100",
    name: "Teacher's Pet",
    description: "Complete your 100th event",
    reward: 25,
    threshold: 100,
  }),
  eventCompletionAchievement({
    id: "events_250",
    name: "Organized Activities Soothe Me",
    description: "Complete your 250th event",
    reward: 50,
    threshold: 250,
  }),
  eventCompletionAchievement({
    id: "events_500",
    name: "Full Calendar",
    description: "Complete your 500th event",
    reward: 75,
    threshold: 500,
  }),
];

// 🟢 MVPs Given
const mvpGivenAchievements = [
  mvpGivenAchievement({
    id: "mvp_given_1",
    name: "Give 1 Get 1",
    description: "Give Your First MVP Award",
    reward: 1,
    threshold: 1,
  }),
  mvpGivenAchievement({
    id: "mvp_given_5",
    name: "I Know Talent When I See It",
    description: "Give Your 5th MVP Award",
    reward: 3,
    threshold: 5,
  }),
  mvpGivenAchievement({
    id: "mvp_given_10",
    name: "Giving Is Receiving",
    description: "Give Your 10th MVP Award",
    reward: 4,
    threshold: 10,
  }),
  mvpGivenAchievement({
    id: "mvp_given_25",
    name: "Spread The Love",
    description: "Give Your 25th MVP Award",
    reward: 5,
    threshold: 25,
  }),
  mvpGivenAchievement({
    id: "mvp_given_50",
    name: "Charitable",
    description: "Give Your 50th MVP Award",
    reward: 8,
    threshold: 50,
  }),
  mvpGivenAchievement({
    id: "mvp_given_100",
    name: "Giver",
    description: "Give Your 100th MVP Award",
    reward: 10,
    threshold: 100,
  }),
  mvpGivenAchievement({
    id: "mvp_given_250",
    name: "Give Until It Hurts",
    description: "Give Your 250th MVP Award",
    reward: 25,
    threshold: 250,
  }),
  mvpGivenAchievement({
    id: "mvp_given_500",
    name: "Philanthropist",
    description: "Give Your 500th MVP Award",
    reward: 50,
    threshold: 500,
  }),
];

// 🟢 MVPs Received
const mvpReceivedAchievements = [
  mvpReceivedAchievement({
    id: "mvp_received_1",
    name: "Skill Bonus",
    description: "Receive your first MVP award",
    reward: 1,
    threshold: 1,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_5",
    name: "Recognition",
    description: "Receive your 5th MVP award",
    reward: 4,
    threshold: 5,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_10",
    name: "Fan Favorite",
    description: "Receive your 10th MVP award",
    reward: 5,
    threshold: 10,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_25",
    name: "Admired",
    description: "Receive your 25th MVP award",
    reward: 8,
    threshold: 25,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_50",
    name: "Teach Me How To Play",
    description: "Receive your 50th MVP award",
    reward: 10,
    threshold: 50,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_100",
    name: "Exalted",
    description: "Receive your 100th MVP award",
    reward: 15,
    threshold: 100,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_250",
    name: "Paragon",
    description: "Receive your 250th MVP award",
    reward: 25,
    threshold: 250,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_500",
    name: "Local Legend",
    description: "Receive your 500th MVP award",
    reward: 50,
    threshold: 500,
  }),
  mvpReceivedAchievement({
    id: "mvp_received_1000",
    name: "Let Me Solo Them",
    description: "Receive your 1000th MVP award",
    reward: 50,
    threshold: 1000,
  }),
];

// 🟡 MVP Special Logic
const dualMvpAchieved = dualMvpAchievement({
  id: "mvp_dual",
  name: "Universally Recognized",
  description: "Receive two MVP from both other players in the match",
  reward: 5,
});

const mvpCooldownAbuseAchievement = {
  id: "mvp_cooldown_abuse",
  name: "Stop Glazing Bro",
  description:
    "Attempt to Award an MVP award to the same player before the cooldown is up",
  reward: 1,
  goal_type: "mvp_cooldown_abuse",
};

// 🟢 Match Completion Points
const matchCompletionPointAchievements = [
  matchCompletionPointAchievement({
    id: "completion_1",
    name: "Here's One On The House",
    description: "Obtain your first match completion point",
    reward: 1,
    threshold: 1,
  }),
  matchCompletionPointAchievement({
    id: "completion_50",
    name: "Milestone",
    description: "Get 50 match completion points",
    reward: 10,
    threshold: 50,
  }),
  matchCompletionPointAchievement({
    id: "completion_100",
    name: "No Casuals",
    description: "Get 100 match completion points",
    reward: 20,
    threshold: 100,
  }),
  matchCompletionPointAchievement({
    id: "completion_250",
    name: "This Is My Game",
    description: "Get 250 match completion points",
    reward: 35,
    threshold: 250,
  }),
  matchCompletionPointAchievement({
    id: "completion_500",
    name: "Match Point Farmer",
    description: "Get 500 match completion points",
    reward: 50,
    threshold: 500,
  }),
  matchCompletionPointAchievement({
    id: "completion_1000",
    name: "Completionist",
    description: "Get 1000 match completion points",
    reward: 75,
    threshold: 1000,
  }),
];

// 💰 Currency Milestones
const currencyAchievements = [
  currencyThresholdAchievement({
    id: "currency_55",
    name: "Bank",
    description: "Have 55 currency",
    reward: 5,
    threshold: 55,
  }),
  currencyThresholdAchievement({
    id: "currency_105",
    name: "Interest",
    description: "Have 105 currency",
    reward: 15,
    threshold: 105,
  }),
  currencyThresholdAchievement({
    id: "currency_235",
    name: "Capital Gains",
    description: "Have 235 currency",
    reward: 20,
    threshold: 235,
  }),
  currencyThresholdAchievement({
    id: "currency_505",
    name: "Takes Money To Make Money",
    description: "Have 505 currency",
    reward: 25,
    threshold: 505,
  }),
  currencyThresholdAchievement({
    id: "currency_1005",
    name: "Insider Trading",
    description: "Have 1005 currency",
    reward: 50,
    threshold: 1005,
  }),
  currencyThresholdAchievement({
    id: "currency_1805",
    name: "The Rich Get Richer…",
    description: "Have 1805 currency",
    reward: 75,
    threshold: 1805,
  }),
  currencyThresholdAchievement({
    id: "currency_2501",
    name: "Dragon's Hoard",
    description: "Have 2501 currency",
    reward: 100,
    threshold: 2501,
  }),
];

// 💸 Currency Spent
const currencySpentAchievements = [
  currencySpentAchievement({
    id: "currency_spent_100",
    name: "Paycheck to Paycheck",
    description: "Spend 100 currency",
    reward: 5,
    threshold: 100,
  }),
  currencySpentAchievement({
    id: "currency_spent_400",
    name: "Shut Up And Take My Money",
    description: "Spend 400 currency",
    reward: 10,
    threshold: 400,
  }),
];

const currencyZeroedAchievements = currencyZeroedAchievement({
  id: "currency_zero",
  name: "On Welfare",
  description: "Spend all of your money",
  reward: 5,
});

// 🛍️ Store Purchases
const storePurchaseAchievements = [
  storePurchaseAchievement({
    id: "store_buy_1",
    name: "Cashback Activated",
    description: "Buy 1 thing from the store",
    reward: 5,
    threshold: 1,
  }),
  storePurchaseAchievement({
    id: "store_buy_3",
    name: "Keep The Change You Filthy Animal",
    description: "Buy 3 things from the store",
    reward: 8,
    threshold: 3,
  }),
  storePurchaseAchievement({
    id: "store_buy_5",
    name: "Customer Loyalty Program",
    description: "Buy 5 things from the store",
    reward: 15,
    threshold: 5,
  }),
  storeCompleteAchievement({
    id: "store_all",
    name: "Shopping Spree",
    description: "Buy everything from the store",
    reward: 25,
    threshold: 9,
  }),
];

const matchCompletionStreakAchievements = [
  matchCompletionStreakAchievement({
    id: "matches_completed_3_24h",
    name: "Playing The Game",
    description: "Complete 3 matches in a 24 hour time period",
    reward: 3,
    statKey: "matches_completed_24h",
    threshold: 3,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_5_24h",
    name: "Momentum",
    description: "Complete 5 matches in a 24 hour time period",
    reward: 5,
    statKey: "matches_completed_24h",
    threshold: 5,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_8_24h",
    name: "I'll Take A Break After This Next Match",
    description: "Complete 8 matches in a 24 hour time period",
    reward: 8,
    statKey: "matches_completed_24h",
    threshold: 8,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_10_24h",
    name: "Weekend Warrior",
    description: "Complete 10 matches in a 24 hour time period",
    reward: 12,
    statKey: "matches_completed_24h",
    threshold: 10,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_15_24h",
    name: "Machine, Not Man",
    description: "Complete 15 matches in a 24 hour time period",
    reward: 15,
    statKey: "matches_completed_24h",
    threshold: 15,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_20_24h",
    name: "Would Some Fresh Air Kill Ya?",
    description: "Complete 20 matches in a 24 hour time period",
    reward: 20,
    statKey: "matches_completed_24h",
    threshold: 20,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_25_24h",
    name: "You Have A Lot Of Free Time Don't You?",
    description: "Complete 25 matches in a 24 hour time period",
    reward: 25,
    statKey: "matches_completed_24h",
    threshold: 25,
  }),
  matchCompletionStreakAchievement({
    id: "matches_completed_50_24h",
    name: "Shower, Touch Grass, Call Your Parents",
    description: "Complete 50 matches in a 24 hour time period",
    reward: 50,
    statKey: "matches_completed_24h",
    threshold: 50,
  }),
];

const dailyMatchStreakAchievements = [
  dailyMatchStreakAchievement({
    id: "streak_7_days",
    name: "I Like The Game!",
    description: "Play at least one match every day for 1 week",
    reward: 10,
    days: 7,
  }),
  dailyMatchStreakAchievement({
    id: "streak_30_days",
    name: "Officially A Regular",
    description: "Play at least one match every day for 30 days",
    reward: 25,
    days: 30,
  }),
];

const matchDurationAchievements = [
  matchDurationAchievement({
    id: "match_duration_30m",
    name: "Just Getting Started",
    description: "Play a match lasting 30 minutes",
    reward: 2,
    threshold: 30 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_45m",
    name: "Warmed Up",
    description: "Play a match lasting 45 minutes",
    reward: 4,
    threshold: 45 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_60m",
    name: "Putting The Time In",
    description: "Play a match lasting 1 hour",
    reward: 5,
    threshold: 60 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_2h",
    name: "Now THIS Is Podracing!",
    description: "Play a match lasting 2 hours",
    reward: 10,
    threshold: 2 * 60 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_3h",
    name: "Dedication",
    description: "Play a match lasting 3 hours",
    reward: 20,
    threshold: 3 * 60 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_5h",
    name: "You Should Eat Something And Drink Some Water",
    description: "Play a match lasting 5 hours",
    reward: 25,
    threshold: 5 * 60 * 60 * 1000,
  }),
  matchDurationAchievement({
    id: "match_duration_10h",
    name: `"MOM! BATHROOM! BATHROOM!"`,
    description: "Play a match lasting 10 hours",
    reward: 50,
    threshold: 10 * 60 * 60 * 1000,
  }),
];

const metaAchievements = [
  achievementCountAchievement({
    id: "achievements_5",
    name: "Wow, Look At You Go!",
    description: "Unlock 5 achievements",
    reward: 3,
    threshold: 5,
  }),
  achievementCountAchievement({
    id: "achievements_10",
    name: "We're All Very Proud!",
    description: "Unlock 10 achievements",
    reward: 5,
    threshold: 10,
  }),
  achievementCountAchievement({
    id: "achievements_20",
    name: "Golden Star Sticker",
    description: "Unlock 20 achievements",
    reward: 8,
    threshold: 20,
  }),
  achievementCountAchievement({
    id: "achievements_30",
    name: "Hard Work Pays Off",
    description: "Unlock 30 achievements",
    reward: 10,
    threshold: 30,
  }),
  achievementCountAchievement({
    id: "achievements_50",
    name: "Achievement Hunter",
    description: "Unlock 50 achievements",
    reward: 20,
    threshold: 50,
  }),
  achievementCountAchievement({
    id: "achievements_75",
    name: "Checking Things Off",
    description: "Unlock 75 achievements",
    reward: 25,
    threshold: 75,
  }),
  achievementCountAchievement({
    id: "achievements_100",
    name: "Certified Tryhard",
    description: "Unlock 100 achievements",
    reward: 50,
    threshold: 100,
  }),
  achievementCountAchievement({
    id: "achievements_150",
    name: "Getting Close…",
    description: "Unlock 150 achievements",
    reward: 250,
    threshold: 150,
  }),
  achievementCountAchievement({
    id: "achievements_all",
    name: "IMPOSSIBLE!!! Achievementception",
    description: "Unlock all achievements",
    reward: 1000,
    threshold: 168, // override dynamically in evaluation logic
  }),
];

const readyCheckFailAchievements = [
  statThresholdAchievement({
    id: "readycheck_fail_1",
    name: "Ready… Or Not!",
    description: "Fail A Ready Check",
    reward: 1,
    statKey: "failed_ready_checks",
    threshold: 1,
  }),
];

const playersInMatchAchievements = [
  {
    id: "players_4",
    name: "High Turnover Industry",
    description: "Play with 4 different players in a single match",
    reward: 5,
    goal_type: "players_in_single_match",
    threshold: 4,
  },
  {
    id: "players_6",
    name: "Is It Me?",
    description: "Play with 6 different players in a single match",
    reward: 10,
    goal_type: "players_in_single_match",
    threshold: 6,
  },
  {
    id: "players_8",
    name: "Revolving Door",
    description: "Play with 8 different players in a single match",
    reward: 20,
    goal_type: "players_in_single_match",
    threshold: 8,
  },
  {
    id: "players_10",
    name: "Cursed Lobby",
    description: "Play with 10 different players in a single match",
    reward: 40,
    goal_type: "players_in_single_match",
    threshold: 10,
  },
];

const formationDiversityAchievement = {
  id: "formation_diversity",
  name: "Versatile",
  description: "Play a single match as a solo, duo, and trio",
  reward: 10,
  goal_type: "formation_diversity",
  check: async (playerId, db) => {
    const rows = await db.allAsync(
      `SELECT formation_type FROM formation_progress WHERE player_id = ?`,
      [playerId]
    );
    const formations = rows.map((r) => r.formation_type);
    return (
      formations.includes("solo") &&
      formations.includes("duo") &&
      formations.includes("trio")
    );
  },
};

const botMentionAchievement = {
  id: "bot_mention_1",
  name: `"Customer Service, How Can I Help You?"`,
  description: "@ the Bot in a match",
  reward: 3,
  goal_type: "mention_bot",
};

const selflessMvpAchievement = {
  id: "selfless_mvp",
  name: "Selfless",
  description: "Give 10 MVP points before receiving 1 yourself",
  reward: 10,
  check: async (playerId, db) => {
    const lastReceived = await db.getAsync(
      `SELECT MAX(awarded_at) AS lastReceived FROM mvp_awards WHERE receiver_id = ?`,
      [playerId]
    );

    const since = lastReceived?.lastReceived || 0;

    const givenAfter = await db.getAsync(
      `SELECT COUNT(*) AS count FROM mvp_awards WHERE giver_id = ? AND awarded_at > ?`,
      [playerId, since]
    );

    return givenAfter?.count >= 10;
  },
};

const soloReadyCheckAchievement = {
  id: "solo_ready",
  name: "All By Myself 🎶",
  description: "Be the only player to pass the ready check",
  reward: 10,
  goal_type: "ready_check_solo",
};

const leaveDuoAchievement = {
  id: "leave_duo",
  name: "Fake Friend",
  description: "Leave the queue while queued as a duo",
  reward: 2,
  formation: "duo",
};

const leaveTrioAchievement = {
  id: "leave_trio",
  name: "Go On Without Me!",
  description: "Leave the queue while queued as a trio",
  reward: 3,
  formation: "trio",
};

const mvpMaxDailyAchievement = {
  id: "mvp_max_daily",
  name: "Show Off",
  description: "Receive the 24 hour MVP award limit",
  reward: 8,
  cap: 10, // from your config
};

const achieveExports = {
  readyCheckAchievements,
  allQueueEntryAchievements,
  matchesPlayedAchievements,
  vcTimeAchievements,
  messageAchievements,
  duoQueueAchievements,
  trioQueueAchievements,
  uniquePartnerAchievements,
  repeatPartnerAchievements,
  mentionAchievement,
  botMentionAchievement,
  selflessMvpAchievement,
  soloReadyCheckAchievement,
  leaveDuoAchievement,
  leaveTrioAchievement,
  mvpMaxDailyAchievement,
  currencyAchievements,
  currencySpentAchievements,
  dailyMatchStreakAchievements,
  eventCompletionAchievements,
  formationDiversityAchievement,
  matchCompletionPointAchievements,
  matchCompletionStreakAchievements,
  matchDurationAchievements,
  metaAchievements,
  mvpCooldownAbuseAchievement,
  mvpGivenAchievements,
  mvpReceivedAchievements,
  platformAchievements,
  playersInMatchAchievements,
  readyCheckFailAchievements,
  storePurchaseAchievements,
  currencyZeroedAchievements,
  dualMvpAchieved,

  // Combined list
  allAchievements: [
    ...readyCheckAchievements,
    ...allQueueEntryAchievements,
    ...matchesPlayedAchievements,
    ...vcTimeAchievements,
    ...messageAchievements,
    ...duoQueueAchievements,
    ...trioQueueAchievements,
    ...uniquePartnerAchievements,
    ...repeatPartnerAchievements,
    mentionAchievement,
    platformAchievements,
    botMentionAchievement,
    selflessMvpAchievement,
    soloReadyCheckAchievement,
    leaveDuoAchievement,
    leaveTrioAchievement,
    mvpMaxDailyAchievement,
    currencyZeroedAchievements,
    dualMvpAchieved,
    ...currencyAchievements,
    ...currencySpentAchievements,
    ...dailyMatchStreakAchievements,
    ...eventCompletionAchievements,
    formationDiversityAchievement,
    ...matchCompletionPointAchievements,
    ...matchCompletionStreakAchievements,
    ...matchDurationAchievements,
    ...metaAchievements,
    mvpCooldownAbuseAchievement,
    ...mvpGivenAchievements,
    ...mvpReceivedAchievements,
    ...platformAchievements,
    ...playersInMatchAchievements,
    ...readyCheckFailAchievements,
    ...storePurchaseAchievements,
  ],
};

module.exports = achieveExports;
