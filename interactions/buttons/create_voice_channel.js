const {
  ChannelType,
  PermissionsBitField,
  ButtonBuilder,
  ActionRowBuilder,
} = require("discord.js");
const logger = require("../utils/logger");
const db = require("../../database");

module.exports = {
  customId: "create_voice_channel",

  async execute(interaction) {
    const thread = interaction.channel;

    try {
      await interaction.deferReply({ flags: 64 }).catch(() => {});

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

      if (!dbResult || !dbResult.playerIds) {
        return interaction
          .editReply({ content: "❌ No players found for this match." })
          .catch(() => {});
      }

      const { playerIds, voiceChannelId } = dbResult;
      const players = playerIds.split(",");

      if (voiceChannelId) {
        return interaction
          .editReply({
            content:
              "⚠️ A voice channel has already been created for this match.",
          })
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
      const channelLimitReached = totalChannels >= 500;

      if (channelLimitReached) {
        return interaction
          .editReply({
            content:
              "⚠️ Cannot create a voice channel. This server is at the 500 channel limit.",
          })
          .catch(() => {});
      }

      // ✅ Create the voice channel
      const voiceChannel = await interaction.guild.channels.create({
        name: `match-voice-${players.join("-")}`,
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
          ...players.map((id) => ({
            id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect,
              PermissionsBitField.Flags.Speak,
            ],
          })),
        ],
      });

      logger.info(`✅ Voice channel created: ${voiceChannel.name}`);

      db.run(
        `UPDATE channels SET voiceChannelId = ? WHERE threadId = ?`,
        [voiceChannel.id, thread.id],
        (err) => {
          if (err) {
            logger.error(
              `❌ Failed to store voiceChannelId in DB: ${err.message}`
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
      logger.error(`❌ Error handling create_voice_channel: ${error.message}`);
      return interaction
        .editReply({
          content: "❌ An error occurred while creating the voice channel.",
        })
        .catch(() => {});
    }
  },
};
