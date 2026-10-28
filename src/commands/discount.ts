import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const setDiscountCommand = new SlashCommandBuilder()
  .setName("set-discount")
  .setDescription("Set the order discount percentage.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addIntegerOption((option) =>
    option
      .setName("percentage")
      .setDescription("Discount percentage (0–100).")
      .setMinValue(0)
      .setMaxValue(100)
      .setRequired(true),
  );

export const getDiscountCommand = new SlashCommandBuilder()
  .setName("get-discount")
  .setDescription("View the current order discount percentage.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
