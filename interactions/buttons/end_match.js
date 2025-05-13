const { PermissionFlagsBits, ComponentType } = require("discord.js");
const db = require("../../database");

const { cleanupMatch } = require("../../utils/matchmakingUtils/matchUtils");
const { hasModRole } = require("../../utils/permissions");

module.exports = {
  customId: "end_match",
  async execute(interaction) {
    const thread = interaction.channel;

    try {
      const dbResult = await new Promise((resolve, reject) => {
        db.get(
          `SELECT playerIds, voiceChannelId FROM channels WHERE threadId = ?`,
          [thread.id],
          (err, row) => {
            if (err) return reject(err);
            resolve(row);
          }
        );
      });

      if (!dbResult) {
        return interaction.reply({
          content: "❌ No match found in the database for this thread.",
          flags: 64,
        });
      }

      const { voiceChannelId } = dbResult;

      const playerList = await new Promise((resolve, reject) => {
        db.all(
          `SELECT playerId FROM match_players WHERE threadId = ? AND status = 'active'`,
          [thread.id],
          (err, rows) =>
            err ? reject(err) : resolve(rows.map((r) => r.playerId))
        );
      });

      // ✅ Instant End if Moderator
      if (hasModRole(interaction.member)) {
        const stillExists = await thread.guild.channels
          .fetch(thread.id)
          .catch(() => null);
        if (!stillExists) return;

        await cleanupMatch({
          thread,
          voiceChannelId,
          closedByUserOrBot: interaction.user,
          closureReason: "Ended by moderator via vote bypass",
        });

        return;
      }

      // ✅ Player Voting
      const collectedUsers = new Set();
      const collector = thread.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      await interaction.reply({
        content: "🗳️ Vote started: 2 players must confirm to end the match.",
        flags: 64,
      });

      collector.on("collect", async (btnInt) => {
        if (!playerList.includes(btnInt.user.id)) {
          return btnInt
            .reply({
              content: "🚫 You are not part of this match.",
              flags: 64,
            })
            .catch(() => {});
        }

        collectedUsers.add(btnInt.user.id);

        if (collectedUsers.size >= 2) {
          collector.stop();

          await cleanupMatch({
            thread,
            voiceChannelId,
            closedByUserOrBot: btnInt.user,
            closureReason: "Match ended by player vote",
          });
        } else {
          return btnInt
            .reply({
              content: `✅ Confirmed. Waiting for one more player. (${collectedUsers.size}/2)`,
              flags: 64,
            })
            .catch(() => {});
        }
      });

      collector.on("end", async () => {
        if (collectedUsers.size < 2) {
          await thread
            .send("❌ Match vote expired without enough confirmations.")
            .catch(() => {});
        }
      });
    } catch (err) {
      console.error("❌ Error handling end_match:", err.message);
      return interaction
        .reply({
          content: "❌ Something went wrong while ending the match.",
          flags: 64,
        })
        .catch(() => {});
    }
  },
};
