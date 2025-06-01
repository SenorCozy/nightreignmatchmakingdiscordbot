const express = require("express");
const router = express.Router();
const db = require("../database");
const checkAuth = require("../middleware/checkAuth");

const PAGE_SIZE = 10;

router.get("/", checkAuth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * PAGE_SIZE;

  try {
    // Get total count to calculate descending index
    const totalCount = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as count FROM transcripts`, [], (err, row) =>
        err ? reject(err) : resolve(row.count)
      );
    });
    // Query transcripts + platform info from matches
    const transcripts = await new Promise((resolve, reject) => {
      db.all(
        `
        SELECT 
  t.id,
  t.created_at,
  t.closed_at,
  t.closure_reason,
  t.platform,
  t.initial_player_ids,
  t.interim_player_ids,
  t.final_player_ids
FROM transcripts t
ORDER BY t.closed_at DESC
LIMIT ? OFFSET ?

      `,
        [PAGE_SIZE, offset],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    // Check if there's a next page
    const hasNextPage = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as count FROM transcripts`, [], (err, row) =>
        err ? reject(err) : resolve(offset + PAGE_SIZE < row.count)
      );
    });

    res.render("transcripts", {
      transcripts,
      page,
      offset,
      hasNextPage,
      totalCount,
      user: req.user,
    });
  } catch (error) {
    console.error("❌ Failed to load transcripts:", error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
