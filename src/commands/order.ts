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
        { name: "Last 24 Hours", value: "last24hours" },
        { name: "Last 30 Days", value: "last30days" },
        { name: "Last 365 Days", value: "last365days" },
        { name: "Today", value: "day" },
        { name: "Yesterday", value: "yesterday" },
        { name: "This Week", value: "week" },
        { name: "This Month", value: "month" },
        { name: "This Year", value: "year" },
        { name: "Previous Month", value: "lastmonth" },
        { name: "Previous Year", value: "lastyear" },
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
