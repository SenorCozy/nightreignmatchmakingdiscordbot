const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const {
  areUsersInSameActiveMatch,
  isMatchOldEnough,
  hasGivenTooManyToday,
  hasCooldownActive,
  hasReceivedTooManyToday,
  applyMvpAward,
} = require("../utils/mvpUtils");
const db = require("../database");
const logger = require("../logger");
const { ELDEN_MODERATOR_ROLE, ELDEN_ENFORCER_ROLE, TICKET_HANDLER_ROLE } =
  process.env;

const RESULTS_PER_PAGE = 10;
const {
  unlockAchievementIfNotEarned,
  checkMvpGivenAchievements,
  checkMvpReceivedAchievements,
  checkSelflessMvpAchievement,
  checkDualMvp,
} = require("../utils/achievementHelpers");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mvp")
    .setDescription("Award MVP to a user in your match")
    .addSubcommand((sub) =>
      sub
        .setName("give")
        .setDescription("Give an MVP point to a teammate")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Player").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("audit")
        .setDescription("View MVP awards received by a player")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Player").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt.setName("page").setDescription("Page number").setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "give") {
      const giverId = interaction.user.id;
      const receiver = interaction.options.getUser("user");
      const receiverId = receiver.id;

      if (giverId === receiverId) {
        return interaction.reply({
          content: "🚫 You can't award MVP to yourself.",
          flags: 64,
        });
      }

      try {
        const matchId = await areUsersInSameActiveMatch(giverId, receiverId);
        if (!matchId) {
          return interaction.reply({
            content:
              "⚠️ You can only award MVP to someone in your active match.",
            flags: 64,
          });
        }

        const [oldEnough, givenTooMany, cooldown, receivedTooMany] =
          await Promise.all([
            // isMatchOldEnough(matchId),
            // hasGivenTooManyToday(giverId),
            hasCooldownActive(giverId, receiverId),
            hasReceivedTooManyToday(receiverId),
          ]);

        // if (!oldEnough) {
        //   return interaction.reply({
        //     content:
        //       "⏱️ You can only award MVPs after 15 minutes into a match.",
        //     flags: 64,
        //   });
        // }

        // if (givenTooMany) {
        //   return interaction.reply({
        //     content: "🖐️ You've reached the daily MVP award limit (5 per 24h).",
        //     flags: 64,
        //   });
        // }

        if (cooldown) {
          await unlockAchievementIfNotEarned(giverId, "mvp_cooldown_abuse");
          return interaction.reply({
            content: `⏳ You must wait 25 minutes before giving MVP to <@${receiverId}> again.`,
            flags: 64,
          });
        }

        if (receivedTooMany) {
          return interaction.reply({
            content: `📥 <@${receiverId}> has reached their daily MVP receive limit (10 per 24h).`,
            flags: 64,
          });
        }

        await applyMvpAward(giverId, receiverId, matchId);

        // Force delay until SQLite write is guaranteed flushed
        await new Promise((res) => setTimeout(res, 50));

        // Then run the achievement checks
        await Promise.all([
          checkSelflessMvpAchievement(giverId, db),
          checkMvpGivenAchievements(giverId, db),
          checkMvpReceivedAchievements(receiverId, db),
          checkDualMvp(receiverId, matchId, db),
        ]);

        return interaction.reply({
          content: `✅ You awarded MVP to <@${receiverId}>! They gained **+1 currency**.`,
        });
      } catch (error) {
        logger.errorWrapper("❌ MVP award error", error, {
          giverId,
          receiverId,
        });
        return interaction.reply({
          content: "❌ An error occurred while processing your MVP.",
          flags: 64,
        });
      }
    }

    if (sub === "audit") {
      const modRoles = [
        ELDEN_MODERATOR_ROLE,
        ELDEN_ENFORCER_ROLE,
        TICKET_HANDLER_ROLE,
      ];

      const memberRoles = interaction.member.roles.cache;
      const isMod = modRoles.some((roleId) => memberRoles.has(roleId));

      if (!isMod) {
        return interaction.reply({
          content: "🚫 You do not have permission to use this subcommand.",
          flags: 64,
        });
      }

      const user = interaction.options.getUser("user");
      const playerId = user.id;
      const page = interaction.options.getInteger("page") || 1;
      const offset = (page - 1) * RESULTS_PER_PAGE;

      try {
        const rows = await db.allAsync(
          `SELECT giver_id, match_id, awarded_at FROM mvp_awards
               WHERE receiver_id = ?
               ORDER BY awarded_at DESC
               LIMIT ? OFFSET ?`,
          [playerId, RESULTS_PER_PAGE, offset]
        );

        if (!rows.length) {
          return interaction.reply({
            content: `📄 No MVP awards found for <@${playerId}> on page ${page}.`,
            flags: 64,
          });
        }

        const auditLog = rows
          .map((r, i) => {
            const date = new Date(r.awarded_at).toLocaleString();
            return `${i + 1 + offset}. 🏅 <@${r.giver_id}> ➝ Match: \`${
              r.match_id
            }\` • ${date}`;
          })
          .join("\n");

        return interaction.reply({
          content: `📘 MVP Audit for <@${playerId}> (Page ${page}):\n${auditLog}`,
          flags: 64,
        });
      } catch (err) {
        logger.errorWrapper("❌ Error fetching MVP audit", err, {
          playerId,
          page,
        });
        return interaction.reply({
          content: "❌ Failed to retrieve MVP history.",
          flags: 64,
        });
      }
    }
  },
};
