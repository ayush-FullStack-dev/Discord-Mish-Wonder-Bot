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
import { createCheckoutPanel } from "../ui/order/createCheckoutPanel.js";
import { accountConfigure, getJobStatus } from "../services/account.service.js";
import { UserChain } from "../models/userChain.model.js";

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
    const oldChain = await UserChain.findOne()
      .sort({ updatedAt: -1 })
      .select("lastChain -_id")
      .lean();

    let lastChain = oldChain?.lastChain || "1";

    await sendLoading(interaction, {
      title: "Creating Your Account",
      description: [
        "**Setting Up Your Account**",
        "",
        "Creating your account and securely processing your registration...",
        "Please wait while we complete the setup.",
      ].join("\n"),
      footer:
        "Please don't close this interaction while your account is being created.",
    });

    const account = await accountConfigure({ count: 1, chain: lastChain });

    if (!account.ok) {
      throw new Error("Failed to create account Please try again later");
    }

    if (account.state === "queued") {
      let accountStatus = await getJobStatus(account.job);

      if (!accountStatus.ok) {
        throw new Error("Failed to fetch account status Please try again later");
      }

      while (!accountStatus.done) {
        await new Promise<void>((resolve) => setTimeout(resolve, 3000));

        accountStatus = await getJobStatus(account.job);

        if (!accountStatus.ok) {
          throw new Error("Failed to fetch account status Please try again later");
        }
      }
    }

    await UserChain.create({
      discordId: interaction.user.id,
      lastChain,
    });

    await sendLoading(interaction, {
      title: "Preparing Checkout",
      description: [
        "**Checking Cart & Restaurant Pricing**",
        "",
        "Validating your cart and preparing checkout details...",
      ].join("\n"),
      footer: "No order is placed until you confirm.",
    });

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
    });

    await ticket.send(
      createCheckoutPanel({
        checkout: {
          id: "chk_8f2a41c07b93",
          status: "pending",
          restaurant: "Bella Vista Kitchen",
          items: [
            {
              name: "Burrito Bowl",
              quantity: 1,
              subtotal: "$20.80",
            },
            {
              name: "Horchata",
              quantity: 2,
              subtotal: "$7.00",
            },
          ],
          price: {
            subtotal: 27.8,
            referral: -15,
            service: 2.99,
            delivery: 0,
            tax: 1.04,
            tip: 3,
            credit: 0,
            total: 19.83,
          },
          fulfillment: "DELIVERY",
          dropoff: "MEET_AT_DOOR",
          address: "742 Example Ave, Springfield, IL, NY",
          referral_code: "REFCODE1234",
          referral_applied: true,
          account: "buyer-04@…",
          card: "•••• 4242",
          expires_in: 900,
        },
        userId: interaction.user.id,
      }),
    );

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
