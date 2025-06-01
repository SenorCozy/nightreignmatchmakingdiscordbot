// middleware/checkAuth.js
require("dotenv").config();
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const MODERATOR_ROLE_IDS = [
  process.env.TICKET_HANDLER_ROLE,
  process.env.ELDEN_MODERATOR_ROLE,
  process.env.ELDEN_ENFORCER_ROLE,
].filter(Boolean); // Filter out undefined roles

const cache = new Map(); // In-memory cache with TTL (Time-To-Live)

// Rate limit tracking
const rateLimit = {
  lastRequest: 0,
  remaining: 1,
  resetAfter: 0,
};

module.exports = async function checkAuth(req, res, next) {
  // 1. Authentication Check
  if (!req.isAuthenticated?.()) {
    return res.redirect("/auth/discord");
  }

  const { id: userId, accessToken: token } = req.user;
  const guildId = process.env.GUILD_ID;

  // 2. Check Session Storage First (Lightweight)
  if (req.session.isModerator !== undefined) {
    return req.session.isModerator ? next() : denyAccess(res);
  }

  // 3. Check Memory Cache
  const cachedData = cache.get(userId);
  if (cachedData?.expires > Date.now()) {
    req.session.isModerator = cachedData.isModerator; // Sync to session
    return cachedData.isModerator ? next() : denyAccess(res);
  }

  // 4. Rate Limit Protection
  const now = Date.now();
  if (now < rateLimit.resetAfter) {
    const waitTime = rateLimit.resetAfter - now;
    console.warn(`⚠️ Preemptive rate limit cooldown: ${waitTime}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  try {
    // 5. Fetch from Discord API
    const response = await fetch(
      `https://discord.com/api/v10/users/@me/guilds/${guildId}/member`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    // 6. Handle Rate Limits (with retry logic)
    if (response.status === 429) {
      const retryAfter =
        (parseInt(response.headers.get("Retry-After")) || 1) * 1000;
      rateLimit.resetAfter = now + retryAfter;
      console.warn(`⏳ Rate limited. Waiting ${retryAfter}ms...`);
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
      return checkAuth(req, res, next); // Recursive retry
    }

    // 7. Update Rate Limit Headers
    rateLimit.remaining =
      parseInt(response.headers.get("X-RateLimit-Remaining")) || 1;
    rateLimit.resetAfter =
      parseInt(response.headers.get("X-RateLimit-Reset-After")) * 1000 ||
      now + 1000;

    // 8. Process Response
    if (!response.ok) {
      console.warn(
        `❌ Discord API Error: ${response.status}`,
        await response.text()
      );
      return res
        .status(403)
        .send("⛔ Unable to verify permissions (API error)");
    }

    const { roles = [] } = await response.json();
    const isModerator = MODERATOR_ROLE_IDS.some((roleId) =>
      roles.includes(roleId)
    );

    // 9. Cache Results (Both Memory and Session)
    const cacheTTL = 5 * 60 * 1000; // 5 minutes
    cache.set(userId, {
      isModerator,
      expires: now + cacheTTL,
    });
    req.session.isModerator = isModerator;

    return isModerator ? next() : denyAccess(res);
  } catch (err) {
    console.error("🔥 Auth Check Error:", err);
    // Fallback: Allow access if we have cached data (even expired)
    if (cachedData) {
      console.warn("⚠️ Using expired cache due to API failure");
      req.session.isModerator = cachedData.isModerator;
      return cachedData.isModerator ? next() : denyAccess(res);
    }
    return res.status(500).send("Internal server error");
  }
};

// Helper function for consistent denial responses
function denyAccess(res) {
  return res.status(403).render("error", {
    message: "⛔ Insufficient permissions",
    details: "You need moderator privileges to access this page.",
  });
}
