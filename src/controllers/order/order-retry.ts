import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { Card } from "../../models/card.model.js";
import { decrypt } from "../../utils/encryption.js";
import { createOrder } from "../../services/order.service.js";
import { sendError } from "../../ui/utils/sendError.js";
import { logError } from "../../utils/logger.js";
import { maxPaymentAttempts } from "../../constants/constant.js";
import { isPaymentError } from "./confirm-order-recovery.js";

type CreateOrderResult = Awaited<ReturnType<typeof createOrder>>;

interface RetryOrderMessage {
  title?: string;
  description?: string;
  footer?: string;
  ephemeral?: boolean;
}

interface RetryOrderOptions {
  interaction: ButtonInteraction | ModalSubmitInteraction;
  result: CreateOrderResult;
  card?: InstanceType<typeof Card> | null;
  cartCode: string;
  attemptedCardIds?: Set<string>;
  messages?: {
    retryLimit?: RetryOrderMessage;
    noCardsAvailable?: RetryOrderMessage;
  };
}

interface RetryOrderResult {
  result: CreateOrderResult;
  card: InstanceType<typeof Card> | null;
  paymentAttempts: number;
  attemptedCardIds: Set<string>;
}

const defaultMessages = {
  retryLimit: {
    title: "Unable to Process Your Payment",
    description: [
      "We couldn't complete your checkout after trying multiple payment methods.",
      "",
      "All declined payment methods have been temporarily blocked.",
      "Please contact support for assistance.",
    ].join("\n"),
    footer: "No further payment attempts will be made.",
  },
  noCardsAvailable: {
    title: "No Payment Methods Available",
    description:
      "We couldn't find another available payment method to complete your checkout. Please contact support.",
    footer: "Our team can help you complete your order.",
  },
};

export async function retryOrderWithReplacementCards({
  interaction,
  result,
  card = null,
  cartCode,
  attemptedCardIds = new Set<string>(),
  messages,
}: RetryOrderOptions): Promise<RetryOrderResult | null> {
  let paymentAttempts = 0;

  if (card?._id) {
    attemptedCardIds.add(card._id.toString());
  }

  while (isPaymentError(result) && paymentAttempts < maxPaymentAttempts) {
    paymentAttempts++;

    if (card?._id) {
      const cardId = card._id.toString();

      attemptedCardIds.add(cardId);

      await Card.findByIdAndUpdate(card._id, {
        $set: {
          isLocked: false,
          status: "blocked",
        },
      });
    }

    if (paymentAttempts >= maxPaymentAttempts) {
      await sendError(interaction, {
        ...defaultMessages.retryLimit,
        ...messages?.retryLimit,
      });

      await logError(
        interaction.client,
        "Payment Retry Limit Reached",
        "All payment attempts failed. Every declined card has been blocked.",
        {
          User: interaction.user.id,
          "Failed Attempts": String(paymentAttempts),
          Status: "Maximum payment attempts reached",
        },
      );

      return null;
    }

    const newCard = await Card.findOneAndUpdate(
      {
        isLocked: false,
        status: "active",
        _id: { $nin: [...attemptedCardIds] },
      },
      {
        $set: { isLocked: true },
      },
      {
        sort: { isPin: -1 },
        returnDocument: "after",
      },
    ).exec();

    if (!newCard) {
      await sendError(interaction, {
        ...defaultMessages.noCardsAvailable,
        ...messages?.noCardsAvailable,
      });

      await logError(
        interaction.client,
        "No Cards Available",
        "No active payment methods are available for another checkout attempt.",
        {
          User: interaction.user.id,
          "Failed Attempts": String(paymentAttempts),
          Status: "No active cards available",
        },
      );

      return null;
    }

    card = newCard;
    attemptedCardIds.add(newCard._id.toString());

    result = await createOrder(
      { cartCode },
      {
        cardNumber: decrypt(newCard.encryptedCardNumber),
        cvv: decrypt(newCard.encryptedCardCvv),
        expiryDate: newCard.expiryDate,
        zipcode: newCard.zipcode,
      },
    );
  }

  if (card?._id && (result.code != null || !("data" in result))) {
    await Card.findByIdAndUpdate(card._id, {
      $set: { isLocked: false },
    });
  }

  return {
    result,
    card,
    paymentAttempts,
    attemptedCardIds,
  };
}
