import type { ButtonInteraction } from "discord.js";
import type { Types } from "mongoose";
import { Card } from "../../models/card.model.js";
import { Order } from "../../models/order.model.js";
import { errorLog } from "../../../logs/printLogs.js";
import { editOrder, type OrderCard } from "../../services/order.service.js";
import { decrypt } from "../../utils/encryption.js";
import { repriceAndUpdateOrder } from "../../utils/repriceCheckout.js";

interface RecoveryLoadingOptions {
  title?: string;
  description: string;
  footer?: string;
  ephemeral?: boolean;
}

interface UpdateCheckoutOptions {
  interaction: ButtonInteraction;
  checkoutId: string;
  orderId: Types.ObjectId;
  confirmationToken: string;
  card: OrderCard;
  paymentAttempts: number;
  repriceInterval: number;
  confirmFailed: boolean;
  restoreLoading: RecoveryLoadingOptions;
}

type RepricedCheckout = Awaited<ReturnType<typeof repriceAndUpdateOrder>>;

interface UpdateCheckoutData {
  checkoutId: string;
  order: RepricedCheckout["order"] | null;
  confirmFailed: boolean;
}

type UpdateCheckoutResult =
  | {
      ok: true;
      message: null;
      data: UpdateCheckoutData;
    }
  | {
      ok: false;
      message: string;
      code: string;
      data: null;
    };

export function isPaymentError(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "code" in result &&
    result.code === "PAYMENT_ERROR"
  );
}

export async function blockDeclinedCard(
  cardId: Types.ObjectId | undefined,
): Promise<void> {
  if (!cardId) return;

  await Card.findByIdAndUpdate(cardId, {
    $set: {
      isLocked: false,
      status: "blocked",
    },
  });
}

export async function selectReplacementCard(attemptedCardIds: Set<string>) {
  return Card.findOneAndUpdate(
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
}

export async function unlockReplacementCard(
  cardId: Types.ObjectId,
): Promise<void> {
  await Card.findByIdAndUpdate(cardId, {
    $set: { isLocked: false },
  });
}

export function getReplacementCardDetails(card: {
  encryptedCardNumber: string;
  encryptedCardCvv: string;
  expiryDate: string;
  zipcode: string;
}): OrderCard {
  return {
    cardNumber: decrypt(card.encryptedCardNumber),
    cvv: decrypt(card.encryptedCardCvv),
    expiryDate: card.expiryDate,
    zipcode: card.zipcode,
  };
}

export async function updateOrderPaymentCard(
  orderId: Types.ObjectId,
  cardId: Types.ObjectId,
  confirmationToken: string,
) {
  return Order.findOneAndUpdate(
    { _id: orderId, status: "pending", confirming: true, confirmationToken },
    { card: cardId },
    { returnDocument: "after" },
  ).exec();
}

export async function editCheckout(checkoutId: string, card: OrderCard) {
  return editOrder(checkoutId, {
    card: `${card.cardNumber},${card.expiryDate},${card.cvv},${card.zipcode}`,
  });
}

export async function repriceCheckout(
  interaction: ButtonInteraction,
  checkoutId: string,
  orderId: Types.ObjectId,
  restoreLoading: RecoveryLoadingOptions,
  confirmationToken: string,
) {
  return repriceAndUpdateOrder({
    interaction,
    checkoutId,
    orderId,
    confirmationToken,
    restoreLoading,
  });
}

export async function updateCheckoutForRetry({
  interaction,
  checkoutId,
  orderId,
  confirmationToken,
  card,
  paymentAttempts,
  repriceInterval,
  confirmFailed,
  restoreLoading,
}: UpdateCheckoutOptions): Promise<UpdateCheckoutResult> {
  try {
    const shouldReprice =
      paymentAttempts % repriceInterval === 0 || paymentAttempts <= 1;

    try {
      if (shouldReprice) {
        const repriced = await repriceCheckout(
          interaction,
          checkoutId,
          orderId,
          restoreLoading,
          confirmationToken,
        );

        return {
          ok: true,
          message: null,
          data: {
            checkoutId: repriced.checkoutId,
            order: repriced.order,
            confirmFailed: false,
          },
        };
      }
    } catch (error) {
      errorLog("[CHECKOUT_RECOVERY_FAILED]", error);

      return {
        ok: false,
        code: "REPRICE_FAIL",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected checkout recovery error occurred.",
        data: null,
      };
    }

    if (!confirmFailed) {
      return {
        ok: true,
        message: null,
        data: {
          checkoutId,
          order: null,
          confirmFailed,
        },
      };
    }

    try {
      const editResult = await editCheckout(checkoutId, card);

      if (!editResult.ok) {
        const isCheckoutError =
          editResult.code === "NO_SUCH_CHECKOUT" ||
          /no checkout with that id|checkout.*(expired|not found|missing)/i.test(
            editResult.message ?? "",
          );

        if (isCheckoutError) {
          errorLog("[CHECKOUT_MISSING]", {
            checkoutId,
            orderId,
            code: editResult.code,
            message: editResult.message,
            action: "Triggering fallback repricing",
          });
        }

        throw new Error(editResult.message ?? "Failed to update checkout.");
      }

      return {
        ok: true,
        message: null,
        data: {
          checkoutId,
          order: null,
          confirmFailed,
        },
      };
    } catch (editError) {
      errorLog("[EDIT_ORDER_FAILED]", editError);

      const repriced = await repriceCheckout(
        interaction,
        checkoutId,
        orderId,
        restoreLoading,
        confirmationToken,
      );

      return {
        ok: true,
        message: null,
        data: {
          checkoutId: repriced.checkoutId,
          order: repriced.order,
          confirmFailed,
        },
      };
    }
  } catch (error) {
    errorLog("[CHECKOUT_RECOVERY_FAILED]", error);

    return {
      ok: false,
      code: "REPRICE_FAIL",
      message:
        error instanceof Error
          ? error.message
          : "An unexpected checkout recovery error occurred.",
      data: null,
    };
  }
}
