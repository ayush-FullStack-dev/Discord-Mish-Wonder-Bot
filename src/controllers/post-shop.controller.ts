import {
  ChatInputCommandInteraction,
  Client,
  MessageFlags,
} from "discord.js";
import { env } from "../config/env.js";
import { createShopPanel } from "../ui/shop-panel.js";
import { requireAdmin } from "../middleware.js";
import { attemptInteractionResponse } from "../utils/error-handler.js";

export async function postShopPanel(
  interaction: ChatInputCommandInteraction,
  client: Client,
) {
  if (!(await requireAdmin(interaction))) return;

  await attemptInteractionResponse(interaction, () =>
    interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    }),
  );

  const channel = await client.channels.fetch(env.shopChannelId);

  if (!channel?.isTextBased() || !("send" in channel)) {
    await attemptInteractionResponse(interaction, () =>
      interaction.editReply("Shop channel not found or unsupported."),
    );
    return;
  }

  await channel.send(createShopPanel());

  await attemptInteractionResponse(interaction, () =>
    interaction.editReply("Shop panel posted successfully."),
  );
}
