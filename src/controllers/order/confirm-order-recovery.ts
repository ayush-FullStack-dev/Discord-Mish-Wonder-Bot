import type { ButtonInteraction } from "discord.js";
import type { Types } from "mongoose";
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
import { createFreshCheckout } from "../../utils/createFreshCheckout.js";

type ConfirmationResult = Awaited<ReturnType<typeof confirmOrder>>;
type ConfirmedOrderData = Extract<ConfirmationResult, { ok: true }>["data"];
type OrderDocument = ReturnType<typeof Order.hydrate>;
type RepricedOrder = Awaited<ReturnType<typeof repriceAndUpdateOrder>>["order"];
type RecoveryOrder = OrderDocument | RepricedOrder;

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
  previousCheckoutAlreadyCancelled: boolean;
}

interface ConfirmWithRetryOptions {
  interaction: ButtonInteraction;
  orderId: typeof Order.prototype._id;
  checkoutId: string;
  order: OrderDocument;
  activeCardId: Types.ObjectId | undefined;
  attemptedCardIds: Set<string>;
  restoreLoading: RecoveryLoadingOptions;
  previousCheckoutAlreadyCancelled: boolean;
}

export interface ConfirmWithRetryResult {
  checkoutId: string;
  order: RecoveryOrder;
  activeCardId: Types.ObjectId | undefined;
  confirmed: boolean;
  previousCheckoutAlreadyCancelled: boolean;
  data?: ConfirmedOrderData;
}

class CheckoutRecoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CheckoutRecoveryError";
  }
}

function isPaymentError(result: ConfirmationResult): boolean {
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
    await Card.findByIdAndUpdate(cardId, { $set: { isLocked: false } });
  } catch (error) {
    errorLog("Failed to unlock replacement card during order recovery:", error);
    throw error;
  }
}

export async function selectReplacementCard(attemptedCardIds: Set<string>) {
  return Card.findOneAndUpdate(
    {
      isLocked: false,
      status: "active",
      _id: { $nin: [...attemptedCardIds] },
    },
    { $set: { isLocked: true } },
    { sort: { isPin: -1 }, returnDocument: "after" },
  ).exec();
}

export async function updateOrderPaymentCard(
  orderId: typeof Order.prototype._id,
  cardId: Types.ObjectId,
) {
  return Order.findOneAndUpdate(
    { _id: orderId, status: "pending", confirming: true },
    { $set: { card: cardId } },
    { returnDocument: "after" },
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
  restoreLoading: RecoveryLoadingOptions,
) {
  return repriceAndUpdateOrder({
    interaction,
    checkoutId,
    orderId,
    restoreLoading,
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
  previousCheckoutAlreadyCancelled,
}: RecoverCheckoutOptions): Promise<{
  checkoutId: string;
  order: RecoveryOrder;
  previousCheckoutAlreadyCancelled: boolean;
  paymentError: boolean;
}> {
  if (!previousCheckoutAlreadyCancelled) {
    let editSucceeded = false;

    try {
      const editResult = await editExistingCheckout(checkoutId, card);
      editSucceeded = editResult.ok;
    } catch (error) {
      throw new CheckoutRecoveryError(
        "The existing checkout edit outcome could not be verified. No replacement checkout was created.",
        { cause: error },
      );
    }

    if (editSucceeded) {
      return {
        checkoutId,
        order,
        previousCheckoutAlreadyCancelled: false,
        paymentError: false,
      };
    }

    try {
      const repriced = await repriceExistingCheckout(
        interaction,
        checkoutId,
        orderId,
        restoreLoading,
      );

      return {
        checkoutId: repriced.checkoutId,
        order: repriced.order,
        previousCheckoutAlreadyCancelled: false,
        paymentError: false,
      };
    } catch (error) {
      if (!(error instanceof RepriceProviderError)) {
        const message =
          error instanceof RepricePersistenceError
            ? "Repricing may have succeeded but could not be saved."
            : "The repricing outcome could not be verified.";

        throw new CheckoutRecoveryError(
          `${message} No replacement checkout was created.`,
          { cause: error },
        );
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

  if (freshCheckout.kind === "payment-error") {
    return {
      checkoutId,
      order,
      previousCheckoutAlreadyCancelled: true,
      paymentError: true,
    };
  }

  if (freshCheckout.kind !== "created") {
    throw new CheckoutRecoveryError(freshCheckout.message);
  }

  return {
    checkoutId: freshCheckout.checkoutId,
    order: freshCheckout.order,
    previousCheckoutAlreadyCancelled: false,
    paymentError: false,
  };
}

export async function confirmWithRetry({
  interaction,
  orderId,
  checkoutId,
  order,
  activeCardId,
  attemptedCardIds,
  restoreLoading,
  previousCheckoutAlreadyCancelled,
}: ConfirmWithRetryOptions): Promise<ConfirmWithRetryResult> {
  await blockDeclinedCard(activeCardId);

  const replacementCard = await selectReplacementCard(attemptedCardIds);
  if (!replacementCard) {
    throw new CheckoutRecoveryError("No active replacement card is available.");
  }

  const cardId = replacementCard._id;
  attemptedCardIds.add(cardId.toString());

  let updatedOrder: OrderDocument | null;

  try {
    updatedOrder = await updateOrderPaymentCard(orderId, cardId);
  } catch (error) {
    await unlockReplacementCard(cardId);
    throw error;
  }

  if (!updatedOrder) {
    await unlockReplacementCard(cardId);
    throw new CheckoutRecoveryError(
      "The order could not be updated with the replacement card.",
    );
  }

  const card: OrderCard = {
    cardNumber: decrypt(replacementCard.encryptedCardNumber),
    cvv: decrypt(replacementCard.encryptedCardCvv),
    expiryDate: replacementCard.expiryDate,
    zipcode: replacementCard.zipcode,
  };

  const recovery = await recoverCheckout({
    interaction,
    checkoutId,
    orderId,
    cardId,
    card,
    order: updatedOrder,
    restoreLoading,
    previousCheckoutAlreadyCancelled,
  });

  if (recovery.paymentError) {
    await blockDeclinedCard(cardId);

    return {
      checkoutId: recovery.checkoutId,
      order: recovery.order,
      activeCardId: undefined,
      confirmed: false,
      previousCheckoutAlreadyCancelled: true,
    };
  }

  const confirmation = await confirmOrder(recovery.checkoutId);

  if (isPaymentError(confirmation)) {
    await blockDeclinedCard(cardId);

    return {
      checkoutId: recovery.checkoutId,
      order: recovery.order,
      activeCardId: undefined,
      confirmed: false,
      previousCheckoutAlreadyCancelled: false,
    };
  }

  if (!confirmation.ok) {
    throw new CheckoutRecoveryError(
      "The replacement checkout could not be confirmed.",
    );
  }

  return {
    checkoutId: recovery.checkoutId,
    order: recovery.order,
    activeCardId: cardId,
    confirmed: true,
    previousCheckoutAlreadyCancelled: false,
    data: confirmation.data,
  };
}
