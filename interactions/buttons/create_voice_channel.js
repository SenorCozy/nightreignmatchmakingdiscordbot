const {
  ChannelType,
  PermissionsBitField,
  ButtonBuilder,
  ActionRowBuilder,
} = require("discord.js");
const db = require("../../database");

module.exports = {
  customId: "create_voice_channel",

  async execute(interaction) {
    const thread = interaction.channel;

    try {
      await interaction.deferReply({ flags: 64 }).catch(() => {});

      // ✅ Get match_id and check if VC already exists
      const { match_id, voiceChannelId } = await new Promise(
        (resolve, reject) => {
          db.get(
            `SELECT match_id, voiceChannelId FROM channels WHERE threadId = ?`,
            [thread.id],
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

      // ✅ Get active match players from match_players
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

      const parentChannel = thread.parent;
      if (!parentChannel || !parentChannel.parent) {
        return interaction
          .editReply({
            content: "❌ Parent category for this thread could not be found.",
          })
          .catch(() => {});
      }

      const totalChannels = interaction.guild.channels.cache.size;
      if (totalChannels >= 500) {
        return interaction
          .editReply({
            content:
              "⚠️ Cannot create a voice channel. Server channel limit reached.",
          })
          .catch(() => {});
      }
      const moderatorRoleIds = [
        process.env.TICKET_HANDLER_ROLE,
        process.env.ELDEN_MODERATOR_ROLE,
        process.env.ELDEN_ENFORCER_ROLE,
        process.env.BOT_ROLE,
      ].filter(Boolean);

      // ✅ Create the voice channel with proper permissions
      const voiceChannel = await interaction.guild.channels.create({
        name: `match-voice-${activePlayers.join("-")}`,
        type: ChannelType.GuildVoice,
        parent: parentChannel.parent.id,
        permissionOverwrites: [
          {
            id: interaction.guild.roles.everyone.id,
            deny: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect,
            ],
          },
          // ✅ Grant access to match players
          ...activePlayers.map((id) => ({
            id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect,
              PermissionsBitField.Flags.Speak,
            ],
          })),
          // ✅ Grant access to moderators/staff
          ...moderatorRoleIds.map((roleId) => ({
            id: roleId,
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

      console.info(`✅ Voice channel created: ${voiceChannel.name}`);

      // ✅ Store voiceChannelId in the DB
      db.run(
        `UPDATE channels SET voiceChannelId = ? WHERE threadId = ?`,
        [voiceChannel.id, thread.id],
        (err) => {
          if (err) {
            console.error(
              "❌ Failed to store voiceChannelId in DB:",
              err.message
            );
          }
        }
      );

      await thread.send({
        content: `🎤 A private voice channel has been created for this match! [Click here to Join Voice](https://discord.com/channels/${thread.guild.id}/${voiceChannel.id})`,
      });

      await interaction.followUp({
        content: "✅ Voice Channel has been created.",
        flags: 64,
      });
    } catch (error) {
      console.error("❌ Error handling create_voice_channel:", error.message);
      return interaction
        .editReply({ content: "❌ Failed to create the voice channel." })
        .catch(() => {});
    }
  },
};
