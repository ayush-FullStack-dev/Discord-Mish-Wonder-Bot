import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const closeOrderCommand = new SlashCommandBuilder()
  .setName("close-order")
  .setDescription("Close the current order.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
export const closeAllOrdersCommand = new SlashCommandBuilder()
  .setName("close-all-orders")
  .setDescription("Close all orders in the order ticket category.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const earningsCommand = new SlashCommandBuilder()
  .setName("earnings")
  .setDescription("View earnings and profit statistics.")
  .addStringOption((option) =>
    option
      .setName("mode")
      .setDescription("Select the earnings period.")
      .setRequired(true)
      .addChoices(
        { name: "Today", value: "day" },
        { name: "This Week", value: "week" },
        { name: "This Month", value: "month" },
        { name: "This Year", value: "year" },
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);