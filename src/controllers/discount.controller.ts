import type { ChatInputCommandInteraction } from "discord.js";
import { requireAdmin } from "../middleware.js";
import {
  getDiscountPercentage,
  updateDiscountPercentage,
} from "../services/discount.service.js";
import { sendError } from "../ui/utils/sendError.js";
import { sendSuccess } from "../ui/utils/sendSuccess.js";
import { logApplicationError } from "../utils/error-handler.js";

export async function handleSetDiscount(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireAdmin(interaction))) return;

  const percentage = interaction.options.getInteger("percentage", true);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    await sendError(interaction, {
      title: "Invalid Discount",
      description: "The discount percentage must be between 0 and 100.",
    });
    return;
  }

  let savedPercentage: number;
  try {
    savedPercentage = await updateDiscountPercentage(percentage);
  } catch (error) {
    logApplicationError("Discount update failed", error);
    await sendError(interaction, {
      title: "Discount Update Failed",
      description: "Unable to save the discount. Please try again later.",
    });
    return;
  }

  await sendSuccess(interaction, {
    title: "Discount Updated",
    description: `The order discount is now **${savedPercentage}%**.`,
  });
}

export async function handleGetDiscount(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireAdmin(interaction))) return;

  let percentage: number;
  try {
    percentage = await getDiscountPercentage();
  } catch (error) {
    logApplicationError("Discount retrieval failed", error);
    await sendError(interaction, {
      title: "Discount Unavailable",
      description:
        "Unable to retrieve the current discount. Please try again later.",
    });
    return;
  }

  await sendSuccess(interaction, {
    title: "Current Discount",
    description: `The current order discount is **${percentage}%**.`,
    footer: "Applied to the subtotal, service fee, and delivery fee.",
  });
}
