import {
  ChannelType,
  GuildMember,
  ModalSubmitInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { env } from "../config/env.js";

export async function createOrderTicket(interaction: ModalSubmitInteraction) {
  const guild = interaction.guild;

  if (!guild) {
    throw new Error("This command must be used in a server.");
  }

  const displayName =
    interaction.member instanceof GuildMember
      ? interaction.member.displayName
      : (interaction.user.globalName ?? interaction.user.username);

  const channelName =
    `order-${displayName}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || `order-${interaction.user.id}`;

  const ticket = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: env.orderTicketCategoryId,

    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: interaction.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ],
  });

  return ticket;
}
