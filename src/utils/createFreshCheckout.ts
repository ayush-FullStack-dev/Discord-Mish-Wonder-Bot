import { env } from "../config/env.js";
import { ORDER_ERRORS } from "../constants/errors.js";
import { Card } from "../models/card.model.js";
import { Order } from "../models/order.model.js";
import {
  cancelOrder,
  createOrder,
  type CheckoutData,
  type OrderCard,
} from "../services/order.service.js";
import { errorLog, success } from "../../logs/printLogs.js";
import { calculateDiscountedOrderPrice, formatExpiryDate } from "./util.js";

type CheckoutOrder = ReturnType<typeof Order.hydrate>;

interface CreateFreshCheckoutOptions {
  orderId: typeof Order.prototype._id;
  previousCheckoutId: string;
  cardId: typeof Card.prototype._id;
  card: OrderCard;
  previousCheckoutAlreadyCancelled?: boolean;
}

type FreshCheckoutFailure =
  | {
      kind: "payment-error";
      code: "PAYMENT_ERROR";
      message: string;
      previousCheckoutCancelled: true;
    }
  | {
      kind: "create-error" | "unsafe-to-replace";
      code: string;
      message: string;
      previousCheckoutCancelled: boolean;
    };

const DEFINITIVE_CREATE_REJECTIONS = new Set([
  "BAD_CART",
  "CART_REQUIRED",
  "NO_CARD",
  "CARD_REQUIRED",
  "UNAUTHORIZED",
  "RATE_LIMITED",
]);

export type CreateFreshCheckoutResult =
  | {
      kind: "created";
      checkoutId: string;
      order: NonNullable<CheckoutOrder>;
      data: CheckoutData;
    }
  | FreshCheckoutFailure;

async function cancelUntrackedCheckout(
  checkoutId: string,
  cardId: typeof Card.prototype._id,
): Promise<boolean> {
  try {
    const cancellation = await cancelOrder(checkoutId);
    if (!cancellation.ok) {
      await errorLog("Fresh checkout cancellation failed:", {
        checkoutId,
        message: cancellation.message,
      });
      return false;
    }
  } catch (error) {
    await errorLog("Fresh checkout cancellation failed:", {
      checkoutId,
      error,
    });
    return false;
  }

  await Card.findByIdAndUpdate(cardId, {
    $set: { isLocked: false },
  });
  return true;
}

function providerErrorMessage(code: string, message: string): string {
  const error = ORDER_ERRORS[code];
  return [error?.title, message.trim() || error?.description]
    .filter(Boolean)
    .join(": ");
}

function validateCheckoutData(data: CheckoutData): void {
  if (
    typeof data.id !== "string" ||
    data.id.trim().length === 0 ||
    data.id.trim() !== data.id
  ) {
    throw new Error("The provider returned an invalid checkout ID.");
  }

  if (
    !data.price ||
    !Number.isFinite(data.price.total) ||
    data.price.total < 0
  ) {
    throw new Error("The provider returned invalid checkout pricing.");
  }

  const expiresAt = formatExpiryDate(data.expires_in);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new Error("The provider returned an invalid checkout expiry.");
  }
}

export async function createFreshCheckout({
  orderId,
  previousCheckoutId,
  cardId,
  card,
  previousCheckoutAlreadyCancelled = false,
}: CreateFreshCheckoutOptions): Promise<CreateFreshCheckoutResult> {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new Error(`Order ${String(orderId)} was not found for recovery.`);
  }

  if (
    order.status !== "pending" ||
    !order.confirming ||
    order.checkoutId !== previousCheckoutId
  ) {
    return {
      kind: "unsafe-to-replace",
      code: "ORDER_STATE_CHANGED",
      message:
        "The pending order or its checkout changed during recovery. No fresh checkout was created.",
      previousCheckoutCancelled: previousCheckoutAlreadyCancelled,
    };
  }

  if (!previousCheckoutAlreadyCancelled) {
    const cancellation = await cancelOrder(previousCheckoutId);
    if (!cancellation.ok) {
      return {
        kind: "unsafe-to-replace",
        code: "CHECKOUT_CANCELLATION_FAILED",
        message: `The previous checkout could not be confirmed cancelled: ${cancellation.message}`,
        previousCheckoutCancelled: false,
      };
    }
  }

  const result = await createOrder(
    { cartCode: order.cartCode },
    card,
  );

  if (result.code !== null && result.code !== undefined) {
    if (result.code === "PAYMENT_ERROR") {
      return {
        kind: "payment-error",
        code: "PAYMENT_ERROR",
        message: result.message,
        previousCheckoutCancelled: true,
      };
    }

    const checkoutDefinitelyNotCreated = DEFINITIVE_CREATE_REJECTIONS.has(
      result.code,
    );
    if (checkoutDefinitelyNotCreated) {
      await Card.findByIdAndUpdate(cardId, {
        $set: { isLocked: false },
      });
    } else {
      await errorLog(
        "Fresh checkout creation outcome is uncertain; replacement card remains locked:",
        { orderId: String(orderId), code: result.code },
      );
    }

    return {
      kind: "create-error",
      code: result.code,
      message: [
        providerErrorMessage(result.code, result.message),
        !checkoutDefinitelyNotCreated &&
          "The replacement card remains locked pending reconciliation.",
      ]
        .filter(Boolean)
        .join(" "),
      previousCheckoutCancelled: true,
    };
  }

  if (!("data" in result) || !result.data) {
    await errorLog(
      "Provider may have created an untracked checkout without returning data:",
      { orderId: String(orderId), previousCheckoutId },
    );
    return {
      kind: "create-error",
      code: "INVALID_API_RESPONSE",
      message:
        "The provider response did not contain checkout data. The replacement card remains locked pending reconciliation.",
      previousCheckoutCancelled: true,
    };
  }

  const data = result.data;
  if (
    typeof data.id === "string" &&
    data.id.trim().length > 0 &&
    data.id === previousCheckoutId
  ) {
    await errorLog(
      "Provider returned the previous checkout ID after cancellation:",
      { orderId: String(orderId), checkoutId: data.id },
    );
    return {
      kind: "create-error",
      code: "CHECKOUT_ID_NOT_REPLACED",
      message:
        "The provider returned the previous checkout ID instead of a fresh checkout. The replacement card remains locked pending reconciliation.",
      previousCheckoutCancelled: true,
    };
  }

  let discountedTotal: number;
  let expiresAt: Date;
  try {
    validateCheckoutData(data);

    if (
      data.price.subtotal < env.minimumOrderSubTotal ||
      data.price.subtotal > env.maxOrderSubTotal
    ) {
      throw new Error(
        data.price.subtotal < env.minimumOrderSubTotal
          ? `The order subtotal is below the minimum of $${env.minimumOrderSubTotal}.`
          : `The order subtotal exceeds the maximum of $${env.maxOrderSubTotal}.`,
      );
    }

    discountedTotal = calculateDiscountedOrderPrice(
      {
        subtotal: data.price.subtotal,
        service: data.price.service,
        delivery: data.price.delivery,
      },
      order.discountPercentage,
    ).total;
    expiresAt = formatExpiryDate(data.expires_in);
  } catch (error) {
    const checkoutId =
      typeof data.id === "string" ? data.id.trim() : "";
    let checkoutCancelled = false;
    if (checkoutId) {
      checkoutCancelled = await cancelUntrackedCheckout(checkoutId, cardId);
    } else {
      await errorLog(
        "Fresh checkout response has no usable checkout ID; replacement card remains locked:",
        { orderId: String(orderId), error },
      );
    }

    return {
      kind: "create-error",
      code: "INVALID_CHECKOUT_DATA",
      message: [
        error instanceof Error ? error.message : String(error),
        checkoutId &&
          !checkoutCancelled &&
          "The new checkout could not be confirmed cancelled; contact support.",
      ]
        .filter(Boolean)
        .join(" "),
      previousCheckoutCancelled: true,
    };
  }

  const duplicateCheckout = await Order.exists({
    _id: { $ne: orderId },
    checkoutId: data.id,
  });
  if (duplicateCheckout) {
    await errorLog(
      "Fresh checkout ID already belongs to another local order:",
      { orderId: String(orderId), checkoutId: data.id },
    );
    return {
      kind: "create-error",
      code: "DUPLICATE_CHECKOUT_ID",
      message:
        "The provider returned a checkout ID already associated with another order. The new checkout requires manual reconciliation and its card remains locked.",
      previousCheckoutCancelled: true,
    };
  }

  let updatedOrder: CheckoutOrder | null;
  try {
    updatedOrder = await Order.findOneAndUpdate(
      {
        _id: orderId,
        status: "pending",
        confirming: true,
        checkoutId: previousCheckoutId,
      },
      {
        $set: {
          checkoutId: data.id,
          orderId: data.order_id,
          card: cardId,
          total: discountedTotal,
          cost: data.price.total,
          expiresAt,
          repricedAt: new Date(),
        },
        $inc: { repriceCount: 1 },
      },
      { returnDocument: "after" },
    ).exec();
  } catch (error) {
    const conflictingOrder = await Order.exists({
      _id: { $ne: orderId },
      checkoutId: data.id,
    });

    const cancelled = conflictingOrder
      ? false
      : await cancelUntrackedCheckout(data.id, cardId);
    if (!cancelled) {
      await errorLog(
        "Fresh checkout requires reconciliation after MongoDB update failure:",
        {
          orderId: String(orderId),
          checkoutId: data.id,
          conflictingOrder: Boolean(conflictingOrder),
          error,
        },
      );
    }
    throw error;
  }

  if (!updatedOrder) {
    const conflictingOrder = await Order.exists({
      _id: { $ne: orderId },
      checkoutId: data.id,
    });
    const cancelled = conflictingOrder
      ? false
      : await cancelUntrackedCheckout(data.id, cardId);
    const message = `Fresh checkout ${data.id} could not be attached to order ${String(orderId)}.`;
    await errorLog(
      cancelled
        ? message
        : `${message} ${
            conflictingOrder
              ? "The checkout ID is associated with another order."
              : "Provider cancellation also failed."
          } Manual reconciliation is required.`,
    );
    throw new Error(message);
  }

  success("[FRESH_CHECKOUT_RECOVERY]", {
    orderId: String(orderId),
    previousCheckoutId,
    checkoutId: data.id,
  });

  return {
    kind: "created",
    checkoutId: data.id,
    order: updatedOrder,
    data,
  };
}
