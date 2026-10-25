import type { ModalSubmitInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { createOrder } from "../services/order.service.js";
import {
  attemptInteractionResponse,
  handleInteractionError,
} from "../utils/error-handler.js";
import { sendError } from "../ui/utils/sendError.js";
import { sendLoading } from "../ui/utils/sendLoading.js";
import { sendSuccess } from "../ui/utils/sendSuccess.js";
import { createOrderTicket } from "../helpers/createOrderTicket.js";

const ORDER_ERRORS: Record<
  string,
  { title: string; description: string; footer: string }
> = {
  BAD_CART: {
    title: "Invalid or Expired Cart Code",
    description:
      "Your cart code is invalid or has expired.\nPlease grab your cart again and enter a fresh code.",
    footer: "Try again with a fresh cart code.",
  },
  CART_REQUIRED: {
    title: "Cart Code Required",
    description:
      "We couldn't find a valid cart.\nPlease grab your cart again and submit its code.",
    footer: "Make sure you copy the complete cart code.",
  },
  NO_CARD: {
    title: "No Payment Method Available",
    description:
      "We couldn't prepare your checkout because no payment method is available.\nPlease contact support.",
    footer: "Our support team can help.",
  },
  CARD_REQUIRED: {
    title: "Payment Method Required",
    description:
      "A payment method is required for this checkout.\nPlease contact support for assistance.",
    footer: "Contact support if you need help.",
  },
  UNAUTHORIZED: {
    title: "Service Temporarily Unavailable",
    description:
      "We couldn't authenticate your checkout request.\nPlease try again later.",
    footer: "Contact support if the issue persists.",
  },
  RATE_LIMITED: {
    title: "Too Many Requests",
    description:
      "The checkout service is receiving too many requests.\nPlease wait a moment before trying again.",
    footer: "Please try again shortly.",
  },
  UNKNOWN_ERROR: {
    title: "Something Went Wrong",
    description:
      "We couldn't process your checkout request.\nPlease try again later.",
    footer: "Contact support if the issue persists.",
  },
};

export async function handleOrderModal(interaction: ModalSubmitInteraction) {
  await attemptInteractionResponse(interaction, () =>
    interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    }),
  );

  try {
    const cartCode = interaction.fields.getTextInputValue("cart_code").trim();

    // await sendLoading(interaction, {
    //   title: "Preparing Checkout",
    //   description: [
    //     "**Checking Cart & Restaurant Pricing**",
    //     "",
    //     "Validating your cart and preparing checkout details...",
    //   ].join("\n"),
    //   footer: "No order is placed until you confirm.",
    // });

    // const result = await createOrder({
    //   cartCode,
    //   discordUserId: interaction.user.id,
    //   username: interaction.user.username,
    // });

    // if (result.code) {
    //   await sendError(
    //     interaction,
    //     ORDER_ERRORS[result.code] ?? {
    //       title: "Checkout Failed",
    //       description:
    //         "We couldn't prepare your checkout.\nPlease try again later.",
    //       footer: "Contact support if the issue persists.",
    //     },
    //   );
    //   return;
    // }

    const ticket = await createOrderTicket(interaction);

    await ticket.send({
      content: `<@${interaction.user.id}>`,
      embeds: [
        {
          title: "New Order",
          description: [
            "Welcome! Your order is being processed.",
            "",
            "Please review your order details below.",
            "",
            "Once confirmed, your order will be placed.",
          ].join("\n"),
          color: 0x57f288,
        },
      ],
    });

    await attemptInteractionResponse(interaction, () =>
      sendSuccess(interaction, {
        title: "Order Ticket Ready",
        description: `Continue in ${ticket.toString()} — pricing your cart now.`,
        footer: "Your order stays private inside that ticket.",
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
