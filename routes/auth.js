const express = require("express");
const passport = require("passport");
const router = express.Router();

// ⏩ Start Discord OAuth2 flow
router.get("/discord", passport.authenticate("discord"));

// 🔁 Discord OAuth2 callback
router.get(
  "/discord/callback",
  passport.authenticate("discord", {
    failureRedirect: "/auth/discord/failure",
  }),
  (req, res) => {
    // ✅ Successful login
    res.redirect("/dashboard");
  }
);

// 🚪 Logout and destroy session
router.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) {
      console.error("Logout failed:", err);
      return next(err);
    }

    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.redirect("/");
    });
  });
});

// ❌ Failure handler
router.get("/discord/failure", (req, res) => {
  res.status(401).send("❌ Login failed. Please try again.");
});

module.exports = router;
