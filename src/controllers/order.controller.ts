import type { ModalSubmitInteraction } from "discord.js";
import { createOrder } from "../services/order.service.js";
import { errorLog } from "../../logs/printLogs.js";
import { MessageFlags } from "discord.js";

export async function handleOrderModal(interaction: ModalSubmitInteraction) {
  const cartCode = interaction.fields.getTextInputValue("cart_code").trim();

  if (!/^[A-Za-z0-9]{6}$/.test(cartCode)) {
    await interaction.reply({
      content: "Please enter a valid 6-character cart code.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await createOrder({
      cartCode,
      discordUserId: interaction.user.id,
      username: interaction.user.username,
    });

    await interaction.editReply({
      content: `${result.message}`,
    });
  } catch (error) {
    errorLog(`Order controller error: ${error}`);

    await interaction.editReply({
      content: "Failed to process your order. Please try again later.",
    });
  }
}
