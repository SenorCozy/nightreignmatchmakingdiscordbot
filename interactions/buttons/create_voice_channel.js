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

      const { match_id, voiceChannelId } =
        (await db.getAsync(
          `SELECT match_id, voiceChannelId FROM channels WHERE threadId = ?`,
          [threadId]
        )) || {};

      if (!match_id) {
        return interaction
          .editReply({
            content: "❌ No match found for this thread.",
          })
          .catch(() => {});
      }

      if (voiceChannelId) {
        return interaction
          .editReply({
            content: "⚠️ A voice channel already exists for this match.",
          })
          .catch(() => {});
      }

      const activePlayers = await db
        .allAsync(
          `SELECT playerId FROM match_players WHERE match_id = ? AND status = 'active'`,
          [match_id]
        )
        .then((rows) => rows.map((r) => r.playerId));

      if (!activePlayers.length) {
        return interaction
          .editReply({
            content: "❌ No active players found for this match.",
          })
          .catch(() => {});
      }

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

      const fetchedChannels = await interaction.guild.channels.fetch();
      if (fetchedChannels.size >= 500) {
        return interaction
          .editReply({
            content:
              "⚠️ Cannot create a voice channel. Server channel limit (500) reached.",
          })
          .catch(() => {});
      }

      const moderatorRoleIds = [
        process.env.TICKET_HANDLER_ROLE,
        process.env.ELDEN_MODERATOR_ROLE,
        process.env.ELDEN_ENFORCER_ROLE,
        process.env.BOT_ROLE,
      ].filter(Boolean);

      function sanitizeUsername(name) {
        let safe = name.toLowerCase().replace(/[^a-z0-9._]/g, "");
        while (safe.includes("..")) {
          safe = safe.replace(/\.\.+/g, ".");
        }
        return safe.slice(0, 32);
      }

      function buildChannelName(prefix, usernames, maxLength = 100) {
        const base = `${prefix}-${usernames.join("-")}`;
        return base.length <= maxLength
          ? base
          : `${prefix}-${usernames.slice(0, 3).join("-")}-etc`;
      }

      const usernames = await Promise.all(
        activePlayers.map(async (id) => {
          try {
            const user = await interaction.client.users.fetch(id);
            return sanitizeUsername(user.username);
          } catch {
            return "unknown";
          }
        })
      );

      const vcName = usernames.length
        ? buildChannelName("match-voice", usernames)
        : `match-voice-${match_id.slice(0, 8)}`;

      let voiceChannel;
      try {
        voiceChannel = await interaction.guild.channels.create({
          name: vcName,
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

      await db.runAsync(
        `UPDATE channels SET voiceChannelId = ? WHERE threadId = ?`,
        [voiceChannel.id, threadId]
      );

      await safeSend(thread, {
        content: `🎤 A private voice channel has been created!\n👉 [Join Now](https://discord.com/channels/${guildId}/${voiceChannel.id})`,
      });

      await interaction
        .followUp({
          content: "✅ Voice Channel has been created.",
          flags: 64,
        })
        .catch((err) =>
          logger.warn("⚠️ Failed to follow up after VC creation", {
            error: err.message,
          })
        );
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
