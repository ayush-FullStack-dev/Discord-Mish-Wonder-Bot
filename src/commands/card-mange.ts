import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const addCardCommand = new SlashCommandBuilder()
  .setName("add-card")
  .setDescription("Add a credit or debit card to the payment card pool.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) =>
    option
      .setName("card-info")
      .setDescription("Enter the credit or debit card info.")
      .setRequired(true),
  );

export const addBulkCardsCommand = new SlashCommandBuilder()
  .setName("add-bulk-cards")
  .setDescription(
    "Add multiple credit or debit cards to the payment card pool.",
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addAttachmentOption((option) =>
    option
      .setName("file")
      .setDescription("Upload a supported card-import file.")
      .setRequired(true),
  );
