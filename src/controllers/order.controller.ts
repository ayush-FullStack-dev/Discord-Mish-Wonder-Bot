import type { ModalSubmitInteraction } from "discord.js";
import { createOrder } from "../services/order.service.js";
import { MessageFlags } from "discord.js";
import {
  attemptInteractionResponse,
  handleInteractionError,
} from "../utils/error-handler.js";

export async function handleOrderModal(interaction: ModalSubmitInteraction) {
  const cartCode = interaction.fields.getTextInputValue("cart_code").trim();

  if (!/^[A-Za-z0-9]{6}$/.test(cartCode)) {
    await attemptInteractionResponse(interaction, () =>
      interaction.reply({
        content: "Please enter a valid 6-character cart code.",
        flags: MessageFlags.Ephemeral,
      }),
    );
    return;
  }

  await attemptInteractionResponse(interaction, () =>
    interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    }),
  );

  try {
    const result = await createOrder({
      cartCode,
      discordUserId: interaction.user.id,
      username: interaction.user.username,
    });

    await attemptInteractionResponse(interaction, () =>
      interaction.editReply({
        content: `${result.message}`,
      }),
    );
  } catch (error) {
    await handleInteractionError(
      interaction,
      error,
      "Failed to process your order. Please try again later.",
    );
  }
}
