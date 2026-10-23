import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const postShopCommand = new SlashCommandBuilder()
  .setName("post-shop")
  .setDescription("Post the MiSH Wonder shop panel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
