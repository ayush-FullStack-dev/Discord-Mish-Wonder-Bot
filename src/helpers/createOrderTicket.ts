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

  const ticket = await guild.channels.create({
    name: `order-${displayName}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 90),
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
        ],
      },
      {
        id: interaction.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      },
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.Administrator],
      },
    ],
  });

  return ticket;
}
