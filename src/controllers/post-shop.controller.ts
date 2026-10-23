import { ChatInputCommandInteraction, Client } from "discord.js";
import { env } from "../config/env.js";
import { createShopPanel } from "../ui/shop-panel.js";
import { requireAdmin } from "../middleware.js";

export async function postShopPanel(
  interaction: ChatInputCommandInteraction,
  client: Client,
) {
  if (!(await requireAdmin(interaction))) return;

  await interaction.deferReply({ ephemeral: true });

  const channel = await client.channels.fetch(env.shopChannelId);

  if (!channel?.isTextBased() || !("send" in channel)) {
    await interaction.editReply("Shop channel not found or unsupported.");
    return;
  }

  await channel.send(createShopPanel());

  await interaction.editReply("Shop panel posted successfully.");
}
