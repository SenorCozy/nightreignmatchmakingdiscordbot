require("dotenv").config();
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

// 🔌 Database + Middleware
const db = require("./database");
const checkAuth = require("./middleware/checkAuth");

// 🧠 Passport Session Config
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// 🌐 Static Files
app.use(express.static(path.join(__dirname, "public")));

// 🔐 Discord Strategy Setup
passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: `${process.env.PUBLIC_URL}/auth/discord/callback`,
      scope: ["identify", "guilds", "guilds.members.read"],
    },
    (accessToken, refreshToken, profile, done) => {
      profile.accessToken = accessToken;
      process.nextTick(() => done(null, profile));
    }
  )
);

// 🧠 Session Management
app.use(
  session({
    secret: process.env.SESSION_SECRET || "nightreign_secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());

// 🌐 Static Files
app.use(express.static(path.join(__dirname, "public")));

// 🎨 Templating
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// 🛣️ Routes
app.use("/auth", require("./routes/auth"));
app.use("/", require("./routes/dashboard"));
app.use("/transcripts", require("./routes/transcripts"));
app.use("/transcripts", require("./routes/transcript"));

// 🌐 Root Redirect
app.get("/", (req, res) => res.redirect("/dashboard"));

// 🔄 Restart Endpoint
app.post("/restart", checkAuth, (req, res) => {
  console.log("♻️ Restart command received from dashboard");
  res.status(200).send("Restarting bot...");

  setTimeout(() => {
    process.exit(1); // Let PM2/systemd restart the process
  }, 500);
});

// 💾 Manual Backup Endpoint
app.post("/backup", checkAuth, (req, res) => {
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const src = path.join(__dirname, "matchmaking.db");
  const dest = path.join(__dirname, "backups", `manual-backup-${timestamp}.db`);

  fs.copyFile(src, dest, (err) => {
    if (err) {
      console.error("❌ Manual backup failed:", err.message);
      return res.status(500).send("Backup failed.");
    }

    console.log("✅ Manual database backup created:", dest);
    res.status(200).send("Backup successful.");
  });
});

// 🚀 Launch Server
app.listen(PORT, "127.0.0.1", () => {
  console.log(`🌐 Dashboard running at http://127.0.0.1:${PORT}`);
});
