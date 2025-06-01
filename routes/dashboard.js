const express = require("express");
const router = express.Router();
const db = require("../database");
const checkAuth = require("../middleware/checkAuth");

router.get("/dashboard", checkAuth, async (req, res) => {
  try {
    const client = global.client;
    const botUser = client?.user;
    const botAvatar = "/bot-avatar.png";

    console.log("🖼️ Bot avatar URL:", botAvatar); // ✅ Check output

    const transcripts = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, username, closed_by_username, closed_at FROM transcripts ORDER BY closed_at DESC LIMIT 5`,
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    res.render("dashboard", {
      user: req.user,
      transcripts,
      botName: botUser?.username || "Night Reign Match Bot",
      botAvatar,
      botStatus: {
        uptime: process.uptime(),
        serverCount: client?.guilds?.cache?.size || 1,
        userCount: client?.users?.cache?.size || 1,
      },
      activeTickets: 0,
    });
  } catch (error) {
    console.error("❌ Error loading dashboard:", error);
    res.status(500).send("Internal server error");
  }
});

module.exports = router;
