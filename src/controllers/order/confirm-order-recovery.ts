import type { ButtonInteraction } from "discord.js";
import type { Types } from "mongoose";
import { maxPaymentAttempts } from "../../constants/constant.js";
import { Card } from "../../models/card.model.js";
import { Order } from "../../models/order.model.js";
import { errorLog } from "../../../logs/printLogs.js";
import {
  confirmOrder,
  editOrder,
  type OrderCard,
} from "../../services/order.service.js";
import { decrypt } from "../../utils/encryption.js";
import { repriceAndUpdateOrder } from "../../utils/repriceCheckout.js";

type ConfirmationResult = Awaited<ReturnType<typeof confirmOrder>>;
type RepricedOrder = Awaited<
  ReturnType<typeof repriceAndUpdateOrder>
>["order"];

interface RecoveryLoadingOptions {
  title?: string;
  description: string;
  footer?: string;
  ephemeral?: boolean;
}

interface RecoverCheckoutOptions {
  interaction: ButtonInteraction;
  checkoutId: string;
  orderId: typeof Order.prototype._id;
  card: OrderCard;
  restoreLoading: RecoveryLoadingOptions;
}

type CheckoutRecoveryResult =
  | {
      ok: true;
      checkoutId: string;
      order?: RepricedOrder;
    }
  | {
      ok: false;
      editError: Error;
      repriceError: unknown;
    };

interface ConfirmWithRetryOptions
  extends Omit<RecoverCheckoutOptions, "card"> {
  result: ConfirmationResult;
  activeCardId: Types.ObjectId | undefined;
  attemptedCardIds: Set<string>;
  total: number;
}

type RetryFailure =
  | { kind: "no-card" }
  | { kind: "order-update" }
  | {
      kind: "recovery";
      editError: Error;
      repriceError: unknown;
    };

export interface ConfirmWithRetryResult {
  result: ConfirmationResult;
  checkoutId: string;
  total: number;
  activeCardId: Types.ObjectId | undefined;
  paymentAttempts: number;
  failure?: RetryFailure;
}

function isPaymentError(
  result: ConfirmationResult,
): result is Extract<ConfirmationResult, { code: string }> {
  return "code" in result && result.code === "PAYMENT_ERROR";
}

export async function blockDeclinedCard(
  cardId: Types.ObjectId | undefined,
): Promise<void> {
  if (!cardId) return;

  await Card.findByIdAndUpdate(cardId, {
    $set: { isLocked: false, status: "blocked" },
  });
}

async function unlockReplacementCard(cardId: Types.ObjectId): Promise<void> {
  try {
    await Card.findByIdAndUpdate(cardId, {
      $set: { isLocked: false },
    });
  } catch (error) {
    errorLog("Failed to unlock replacement card during order recovery:", error);
    throw error;
  }
}

export async function selectReplacementCard(
  attemptedCardIds: Set<string>,
) {
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

export async function updateOrderPaymentCard(
  orderId: typeof Order.prototype._id,
  cardId: Types.ObjectId,
) {
  return Order.findOneAndUpdate(
    {
      _id: orderId,
      status: "pending",
      confirming: true,
    },
    {
      $set: { card: cardId },
    },
    {
      returnDocument: "after",
    },
  ).exec();
}

export async function editExistingCheckout(
  checkoutId: string,
  card: OrderCard,
) {
  return editOrder(checkoutId, {
    card: `${card.cardNumber},${card.expiryDate},${card.cvv},${card.zipcode}`,
  });
}

export async function repriceExistingCheckout(
  interaction: ButtonInteraction,
  checkoutId: string,
  orderId: typeof Order.prototype._id,
  restoreLoading?: RecoveryLoadingOptions,
) {
  return repriceAndUpdateOrder({
    interaction,
    checkoutId,
    orderId,
    ...(restoreLoading !== undefined && { restoreLoading }),
  });
}

export async function recoverCheckout({
  interaction,
  checkoutId,
  orderId,
  card,
  restoreLoading,
}: RecoverCheckoutOptions): Promise<CheckoutRecoveryResult> {
  const editResult = await editExistingCheckout(checkoutId, card);

  if (editResult.ok) {
    return { ok: true, checkoutId };
  }

  try {
    const repriced = await repriceExistingCheckout(
      interaction,
      checkoutId,
      orderId,
      restoreLoading,
    );

    return {
      ok: true,
      checkoutId: repriced.checkoutId,
      order: repriced.order,
    };
  } catch (repriceError) {
    return {
      ok: false,
      editError: new Error(
        `${editResult.code}: ${editResult.message}`,
      ),
      repriceError,
    };
  }
}

export async function confirmWithRetry({
  interaction,
  orderId,
  checkoutId,
  restoreLoading,
  result: initialResult,
  activeCardId: initialCardId,
  attemptedCardIds,
  total: initialTotal,
}: ConfirmWithRetryOptions): Promise<ConfirmWithRetryResult> {
  let result = initialResult;
  let currentCheckoutId = checkoutId;
  let currentTotal = initialTotal;
  let activeCardId = initialCardId;

  let paymentAttempts = 0;

  while (isPaymentError(result) && paymentAttempts < maxPaymentAttempts) {
    paymentAttempts++;
    await blockDeclinedCard(activeCardId);

    const replacementCard = await selectReplacementCard(attemptedCardIds);
    if (!replacementCard) {
      return {
        result,
        checkoutId: currentCheckoutId,
        total: currentTotal,
        activeCardId,
        paymentAttempts,
        failure: { kind: "no-card" },
      };
    }

    attemptedCardIds.add(replacementCard._id.toString());
    activeCardId = replacementCard._id;

    const updatedOrder = await updateOrderPaymentCard(
      orderId,
      replacementCard._id,
    );

    if (!updatedOrder) {
      await unlockReplacementCard(replacementCard._id);

      return {
        result,
        checkoutId: currentCheckoutId,
        total: currentTotal,
        activeCardId,
        paymentAttempts,
        failure: { kind: "order-update" },
      };
    }

    const replacementCardDetails: OrderCard = {
      cardNumber: decrypt(replacementCard.encryptedCardNumber),
      cvv: decrypt(replacementCard.encryptedCardCvv),
      expiryDate: replacementCard.expiryDate,
      zipcode: replacementCard.zipcode,
    };

    const recovery = await recoverCheckout({
      interaction,
      checkoutId: currentCheckoutId,
      orderId,
      card: replacementCardDetails,
      restoreLoading,
    });

    if (!recovery.ok) {
      return {
        result,
        checkoutId: currentCheckoutId,
        total: currentTotal,
        activeCardId: undefined,
        paymentAttempts,
        failure: {
          kind: "recovery",
          editError: recovery.editError,
          repriceError: recovery.repriceError,
        },
      };
    }

    currentCheckoutId = recovery.checkoutId;
    if (recovery.order) {
      currentTotal = recovery.order.total;
    }

    result = await confirmOrder(currentCheckoutId);
  }

  return {
    result,
    checkoutId: currentCheckoutId,
    total: currentTotal,
    activeCardId,
    paymentAttempts,
  };
}
