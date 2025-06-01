// seedAchievements.js
const db = require("../database");
const { allAchievements } = require("../data/achievements");

async function seedAchievements() {
  try {
    for (const a of allAchievements) {
      await db.runAsync(
        `INSERT OR IGNORE INTO achievements (achievement_id, name, description, reward)
         VALUES (?, ?, ?, ?)`,
        [a.id, a.name, a.description, a.reward]
      );
    }
    console.log(`✅ Seeded ${allAchievements.length} achievements`);
  } catch (err) {
    console.error("❌ Error seeding achievements:", err);
  }
}

seedAchievements();
