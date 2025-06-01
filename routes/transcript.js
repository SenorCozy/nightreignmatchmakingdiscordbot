const express = require("express");
const router = express.Router();
const db = require("../database");
const checkAuth = require("../middleware/checkAuth");

router.get("/:id", checkAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const transcript = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM transcripts WHERE id = ?`, [id], (err, row) =>
        err ? reject(err) : resolve(row)
      );
    });

    if (!transcript) {
      return res.status(404).send("Transcript not found");
    }

    const messages = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM transcript_messages WHERE transcript_id = ? ORDER BY timestamp ASC`,
        [id],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    res.render("transcript", {
      transcript,
      messages,
      user: req.user,
    });
  } catch (err) {
    console.error("❌ Failed to load transcript:", err);
    res.status(500).send("Server Error");
  }
});

module.exports = router;
