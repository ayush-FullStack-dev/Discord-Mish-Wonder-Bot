import { MessageFlags, type ButtonInteraction } from "discord.js";
import { attemptInteractionResponse } from "../utils/interaction-response.js";

export async function checkBalance(interaction: ButtonInteraction) {
  await attemptInteractionResponse(interaction, () =>
    interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    }),
  );
}
