import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { ADMIN_USERID } from "./constants/constant.js";
import { attemptInteractionResponse } from "./utils/error-handler.js";

export async function requireAdmin(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (!ADMIN_USERID.includes(interaction.user.id)) {
    await attemptInteractionResponse(interaction, () =>
      interaction.reply({
        content: "You are not authorized to use this command.",
        flags: MessageFlags.Ephemeral,
      }),
    );

    return false;
  }

  return true;
}
