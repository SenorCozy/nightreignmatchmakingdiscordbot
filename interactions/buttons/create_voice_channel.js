const { ChannelType, PermissionsBitField } = require("discord.js");
const db = require("../../database");
const logger = require("../../logger");
const { safeSend } = require("../../utils/matchmakingUtils/matchUtils");

module.exports = {
  customId: "create_voice_channel",

  async execute(interaction) {
    const thread = interaction.channel;
    const threadId = thread.id;
    const guildId = thread.guild.id;

    try {
      await interaction.deferReply({ flags: 64 }).catch((err) => {
        logger.warn("⚠️ Failed to defer interaction reply", {
          error: err.message,
        });
      });

      // 🔍 Fetch match data
      const { match_id, voiceChannelId } = await new Promise(
        (resolve, reject) => {
          db.get(
            `SELECT match_id, voiceChannelId FROM channels WHERE threadId = ?`,
            [threadId],
            (err, row) => (err ? reject(err) : resolve(row || {}))
          );
        }
      );

      if (!match_id) {
        return interaction
          .editReply({ content: "❌ No match found for this thread." })
          .catch(() => {});
      }

      if (voiceChannelId) {
        return interaction
          .editReply({
            content: "⚠️ A voice channel already exists for this match.",
          })
          .catch(() => {});
      }

      // 🔍 Get active players
      const activePlayers = await new Promise((resolve, reject) => {
        db.all(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id],
          (err, rows) =>
            err ? reject(err) : resolve(rows.map((r) => r.playerId))
        );
      });

      if (!activePlayers.length) {
        return interaction
          .editReply({ content: "❌ No active players found for this match." })
          .catch(() => {});
      }

      // 🔍 Validate parent categories
      const parentChannel = thread?.parent;
      const parentCategory = parentChannel?.parent;

      if (!parentChannel || !parentCategory) {
        return interaction
          .editReply({
            content:
              "❌ Unable to determine the parent category for this thread.",
          })
          .catch(() => {});
      }

      // 🔍 Server channel limit check
      const fetchedChannels = await interaction.guild.channels.fetch();
      if (fetchedChannels.size >= 500) {
        return interaction
          .editReply({
            content:
              "⚠️ Cannot create a voice channel. Server channel limit (500) reached.",
          })
          .catch(() => {});
      }

      // 🔐 Permissions
      const moderatorRoleIds = [
        process.env.TICKET_HANDLER_ROLE,
        process.env.ELDEN_MODERATOR_ROLE,
        process.env.ELDEN_ENFORCER_ROLE,
        process.env.BOT_ROLE,
      ].filter(Boolean);

      let voiceChannel;
      try {
        voiceChannel = await interaction.guild.channels.create({
          name: `match-voice-${activePlayers.join("-")}`,
          type: ChannelType.GuildVoice,
          parent: parentCategory.id,
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone.id,
              deny: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.Connect,
              ],
            },
            ...activePlayers.map((id) => ({
              id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
              ],
            })),
            ...moderatorRoleIds.map((id) => ({
              id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
                PermissionsBitField.Flags.MuteMembers,
                PermissionsBitField.Flags.MoveMembers,
              ],
            })),
          ],
        });
      } catch (err) {
        const msg =
          err.code === 30013
            ? "⚠️ Cannot create voice channel: server has reached the max channel limit (500)."
            : "❌ Unexpected error creating voice channel.";
        logger.errorWrapper("❌ Failed to create voice channel", err, {
          match_id,
          guildId,
        });
        return interaction.editReply({ content: msg }).catch(() => {});
      }

      logger.info("✅ Voice channel created", {
        match_id,
        voiceChannelId: voiceChannel.id,
        name: voiceChannel.name,
      });

      // 💾 Save to DB
      db.run(
        `UPDATE channels SET voiceChannelId = ? WHERE threadId = ?`,
        [voiceChannel.id, threadId],
        (err) => {
          if (err) {
            logger.errorWrapper(
              "❌ Failed to store voiceChannelId in DB",
              err,
              { match_id, threadId }
            );
          } else {
            logger.info("📦 Stored voiceChannelId in DB", {
              voiceChannelId: voiceChannel.id,
            });
          }
        }
      );
      await safeSend(thread, {
        content: `🎤 A private voice channel has been created for this match!\n👉 [Click to Join](https://discord.com/channels/${guildId}/${voiceChannel.id})`,
      });

      await interaction
        .followUp({
          content: "✅ Voice Channel has been created.",
          flags: 64,
        })
        .catch((err) => {
          logger.warn("⚠️ Failed to follow up after VC creation", {
            error: err.message,
          });
        });
    } catch (error) {
      logger.errorWrapper("❌ Uncaught error in create_voice_channel", error, {
        threadId,
        userId: interaction.user.id,
      });

      await interaction
        .editReply({
          content:
            "❌ Failed to create the voice channel due to an unexpected error.",
        })
        .catch(() => {});
    }
  },
};
