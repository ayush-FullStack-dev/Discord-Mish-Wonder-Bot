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
import {
  repriceAndUpdateOrder,
  RepricePersistenceError,
  RepriceProviderError,
} from "../../utils/repriceCheckout.js";
import {
  createFreshCheckout,
  type CreateFreshCheckoutResult,
} from "../../utils/createFreshCheckout.js";

type ConfirmationResult = Awaited<ReturnType<typeof confirmOrder>>;
type RepricedOrder = Awaited<
  ReturnType<typeof repriceAndUpdateOrder>
>["order"];
type OrderDocument = ReturnType<typeof Order.hydrate>;
type FreshCheckoutFailureResult = Exclude<
  CreateFreshCheckoutResult,
  { kind: "created" }
>;

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
  cardId: Types.ObjectId;
  card: OrderCard;
  order: OrderDocument;
  restoreLoading: RecoveryLoadingOptions;
  previousCheckoutAlreadyCancelled?: boolean;
}

type CheckoutRecoveryResult =
  | {
      ok: true;
      checkoutId: string;
      order: OrderDocument | RepricedOrder;
    }
  | {
      ok: false;
      kind: "manual-reconciliation";
      message: string;
      error: unknown;
    }
  | {
      ok: false;
      kind: "fresh-checkout";
      result: FreshCheckoutFailureResult;
    }

interface ConfirmWithRetryOptions
  extends Omit<
    RecoverCheckoutOptions,
    "card" | "cardId" | "previousCheckoutAlreadyCancelled"
  > {
  result: ConfirmationResult;
  activeCardId: Types.ObjectId | undefined;
  attemptedCardIds: Set<string>;
}

type RetryFailure =
  | { kind: "no-card" }
  | { kind: "order-update" }
  | {
      kind: "recovery";
      message: string;
      error: unknown;
    }
  | {
      kind: "fresh-checkout";
      code: string;
      message: string;
    }
  | {
      kind: "retry-limit";
      message: string;
    };

export interface ConfirmWithRetryResult {
  result: ConfirmationResult;
  checkoutId: string;
  order: OrderDocument;
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
  cardId,
  card,
  order,
  restoreLoading,
  previousCheckoutAlreadyCancelled = false,
}: RecoverCheckoutOptions): Promise<CheckoutRecoveryResult> {
  if (!previousCheckoutAlreadyCancelled) {
    const editResult = await editExistingCheckout(checkoutId, card);

    if (editResult.ok) {
      return { ok: true, checkoutId, order };
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
      if (repriceError instanceof RepricePersistenceError) {
        return {
          ok: false,
          kind: "manual-reconciliation",
          message:
            "Repricing may have succeeded but could not be saved. No replacement checkout was created.",
          error: repriceError,
        };
      }

      if (!(repriceError instanceof RepriceProviderError)) {
        return {
          ok: false,
          kind: "manual-reconciliation",
          message:
            "The repricing outcome could not be verified. No replacement checkout was created.",
          error: repriceError,
        };
      }
    }
  }

  const freshCheckout = await createFreshCheckout({
    orderId,
    previousCheckoutId: checkoutId,
    cardId,
    card,
    previousCheckoutAlreadyCancelled,
  });

  if (freshCheckout.kind === "created") {
    return {
      ok: true,
      checkoutId: freshCheckout.checkoutId,
      order: freshCheckout.order,
    };
  }

  return {
    ok: false,
    kind: "fresh-checkout",
    result: freshCheckout,
  };
}

export async function confirmWithRetry({
  interaction,
  orderId,
  checkoutId,
  restoreLoading,
  result: initialResult,
  activeCardId: initialCardId,
  attemptedCardIds,
  order: initialOrder,
}: ConfirmWithRetryOptions): Promise<ConfirmWithRetryResult> {
  let result = initialResult;
  let currentCheckoutId = checkoutId;
  let order = initialOrder;
  let activeCardId = initialCardId;
  let paymentAttempts = 0;
  let previousCheckoutAlreadyCancelled = false;

  while (isPaymentError(result) && paymentAttempts < maxPaymentAttempts) {
    paymentAttempts++;
    await blockDeclinedCard(activeCardId);
    activeCardId = undefined;

    const replacementCard = await selectReplacementCard(attemptedCardIds);
    if (!replacementCard) {
      return {
        result,
        checkoutId: currentCheckoutId,
        order,
        activeCardId,
        paymentAttempts,
        failure: { kind: "no-card" },
      };
    }

    attemptedCardIds.add(replacementCard._id.toString());
    activeCardId = replacementCard._id;

    let updatedOrder: OrderDocument | null;
    try {
      updatedOrder = await updateOrderPaymentCard(
        orderId,
        replacementCard._id,
      );
    } catch (error) {
      await unlockReplacementCard(replacementCard._id);
      throw error;
    }

    if (!updatedOrder) {
      await unlockReplacementCard(replacementCard._id);
      return {
        result,
        checkoutId: currentCheckoutId,
        order,
        activeCardId: undefined,
        paymentAttempts,
        failure: { kind: "order-update" },
      };
    }
    order = updatedOrder;

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
      cardId: replacementCard._id,
      card: replacementCardDetails,
      order,
      restoreLoading,
      previousCheckoutAlreadyCancelled,
    });

    if (!recovery.ok) {
      if (recovery.kind === "fresh-checkout") {
        if (recovery.result.kind === "payment-error") {
          result = {
            ok: false,
            code: "PAYMENT_ERROR",
            message: recovery.result.message,
          };
          previousCheckoutAlreadyCancelled = true;
          continue;
        }

        return {
          result,
          checkoutId: currentCheckoutId,
          order,
          activeCardId: undefined,
          paymentAttempts,
          failure: {
            kind: "fresh-checkout",
            code: recovery.result.code,
            message: recovery.result.message,
          },
        };
      }

      return {
        result,
        checkoutId: currentCheckoutId,
        order,
        activeCardId: undefined,
        paymentAttempts,
        failure: {
          kind: "recovery",
          message: recovery.message,
          error: recovery.error,
        },
      };
    }

    currentCheckoutId = recovery.checkoutId;
    order = recovery.order;
    previousCheckoutAlreadyCancelled = false;

    result = await confirmOrder(currentCheckoutId);
  }

  if (isPaymentError(result)) {
    await blockDeclinedCard(activeCardId);
    activeCardId = undefined;
  }

  const retryLimitReached =
    isPaymentError(result) && paymentAttempts >= maxPaymentAttempts;

  return {
    result,
    checkoutId: currentCheckoutId,
    order,
    activeCardId,
    paymentAttempts,
    ...(retryLimitReached && {
      failure: {
        kind: "retry-limit" as const,
        message:
          "The maximum number of payment attempts was reached. No further card attempts will be made.",
      },
    }),
  };
}
