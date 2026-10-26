import { MessageFlags, type ButtonInteraction } from "discord.js";
import { attemptInteractionResponse } from "../utils/interaction-response.js";
import { handleInteractionError } from "../utils/error-handler.js";
import { sendSuccess } from "../ui/utils/sendSuccess.js";
import { centsToDollars } from "../utils/util.js";
import { getBalance } from "../services/balance.service.js";

export async function checkBalance(interaction: ButtonInteraction) {
  try {
    await attemptInteractionResponse(interaction, () =>
      interaction.deferReply({
        flags: MessageFlags.Ephemeral,
      }),
    );

    const balance = await getBalance(interaction.user.id) || 0n
    const dollarBalance = centsToDollars(balance);

    await sendSuccess(interaction, {
      title: "Your Balance",
      description: `Your current balance is **$${dollarBalance} USD**.`,
      footer: "MishGPT • Wallet",
    });
  } catch (error) {
    return await handleInteractionError(interaction, error);
  }
}
