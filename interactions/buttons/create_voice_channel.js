const { ChannelType, PermissionsBitField } = require("discord.js");
const db = require("../../database");

module.exports = {
  customId: "create_voice_channel",

  async execute(interaction) {
    const thread = interaction.channel;

    try {
      await interaction.deferReply({ flags: 64 }).catch((err) => {
        console.warn("⚠️ Failed to defer interaction reply:", err);
      });

      // 🟦 Fetch match_id and check for existing VC
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
          .catch((err) =>
            console.warn("⚠️ Failed to reply: no match found", err)
          );
      }

      if (voiceChannelId) {
        return interaction
          .editReply({
            content: "⚠️ A voice channel already exists for this match.",
          })
          .catch((err) => console.warn("⚠️ Failed to reply: VC exists", err));
      }

      // 🟦 Get active players
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
          .editReply({
            content: "❌ No active players found for this match.",
          })
          .catch((err) =>
            console.warn("⚠️ Failed to reply: no active players", err)
          );
      }

      const parentChannel = thread?.parent;
      const parentCategory = parentChannel?.parent;

      if (!parentChannel || !parentCategory) {
        return interaction
          .editReply({
            content:
              "❌ Unable to determine the parent category for this thread.",
          })
          .catch((err) =>
            console.warn("⚠️ Failed to reply: no parent category", err)
          );
      }

      const fetchedChannels = await interaction.guild.channels.fetch();
      if (fetchedChannels.size >= 500) {
        return interaction
          .editReply({
            content:
              "⚠️ Cannot create a voice channel. Server channel limit (500) reached.",
          })
          .catch((err) =>
            console.warn("⚠️ Failed to reply: limit reached", err)
          );
      }

      // 🟦 Prepare permissions
      const moderatorRoleIds = [
        process.env.TICKET_HANDLER_ROLE,
        process.env.ELDEN_MODERATOR_ROLE,
        process.env.ELDEN_ENFORCER_ROLE,
        process.env.BOT_ROLE,
      ].filter(Boolean);

      let voiceChannel;
      try {
        // 🟩 Attempt to create the VC
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
        console.error("❌ Voice channel creation failed:", err);
        return interaction
          .editReply({ content: msg })
          .catch((e) => console.warn("⚠️ Failed to reply after VC error:", e));
      }

      console.info(`✅ Voice channel created: ${voiceChannel.name}`);

      db.run(
        `UPDATE channels SET voiceChannelId = ? WHERE threadId = ?`,
        [voiceChannel.id, thread.id],
        (err) => {
          if (err) {
            console.error(
              "❌ Failed to store voiceChannelId in DB:",
              err.message
            );
          } else {
            console.log("📦 Stored voiceChannelId in DB:", voiceChannel.id);
          }
        }
      );

      await thread
        .send({
          content: `🎤 A private voice channel has been created for this match!\n👉 [Click here to Join Voice](https://discord.com/channels/${thread.guild.id}/${voiceChannel.id})`,
        })
        .catch((err) => {
          console.warn("⚠️ Failed to send message to thread:", err);
        });

      await interaction
        .followUp({
          content: "✅ Voice Channel has been created.",
          flags: 64,
        })
        .catch((err) => {
          console.warn("⚠️ Failed to follow up interaction:", err);
        });
    } catch (error) {
      console.error(
        "❌ Uncaught error in create_voice_channel handler:",
        error
      );
      interaction
        .editReply({
          content:
            "❌ Failed to create the voice channel due to an unexpected error.",
        })
        .catch((err) =>
          console.warn("⚠️ Failed to send final error message:", err)
        );
    }
  },
};
