import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const closeOrderCommand = new SlashCommandBuilder()
  .setName("close-order")
  .setDescription("Close the current order.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const closeAllOrdersCommand = new SlashCommandBuilder()
  .setName("close-all-orders")
  .setDescription("Close all orders in the order ticket category.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
