import type { RepliableInteraction } from "discord.js";
import { Order } from "../models/order.model.js";
import { repriceOrder } from "../services/order.service.js";
import { formatExpiryDate } from "./util.js";
import { sendLoading } from "../ui/utils/sendLoading.js";
import { success } from "../../logs/printLogs.js";

interface RepriceCheckoutOptions {
  interaction: RepliableInteraction;
  checkoutId: string;
  restoreLoading?: {
    title?: string;
    description: string;
    footer?: string;
    ephemeral?: boolean;
  } | null;
}

interface RepriceAndUpdateOrderOptions extends RepriceCheckoutOptions {
  orderId: typeof Order.prototype._id;
}

export class RepricePersistenceError extends Error {
  constructor(
    message: string,
    readonly checkoutId: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "RepricePersistenceError";
  }
}

export class RepriceProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "RepriceProviderError";
  }
}

const defaultRestoreLoading = {
  title: "Confirming Your Order",
  description: [
    "**Processing Order Confirmation**",
    "",
    "Confirming your order with the provider and processing your wallet payment...",
    "Please wait while we complete the process.",
  ].join("\n"),
  footer: "Do not click confirm again while your order is processing.",
  ephemeral: false,
};

async function executeRepriceCheckout({
  interaction,
  checkoutId,
  restoreLoading = defaultRestoreLoading,
}: RepriceCheckoutOptions) {
  await sendLoading(interaction, {
    title: "Updating Checkout",
    description: [
      "**Refreshing checkout details...**",
      "",
      "Please wait while we update the order pricing and checkout information.",
    ].join("\n"),
    footer: "Your order confirmation is still in progress.",
    ephemeral: false,
  });

  try {
    const repriceResult = await repriceOrder(checkoutId);

    if (!repriceResult.ok) {
      throw new RepriceProviderError(
        repriceResult.message || "Failed to reprice checkout.",
        repriceResult.code,
      );
    }

    const data = repriceResult.data;

    const repricedOrderData = {
      checkoutId: data.id,
      orderId: data.order_id,
      cost: data.price.total,
      expiresAt: formatExpiryDate(data.expires_in),
      repricedAt: new Date(),
    };

    return {
      checkoutId: data.id,
      order: repricedOrderData,
      data,
    };
  } finally {
    if (restoreLoading) {
      await sendLoading(interaction, restoreLoading);
    }
  }
}

export async function repriceCheckout(options: RepriceCheckoutOptions) {
  return executeRepriceCheckout(options);
}

export async function repriceAndUpdateOrder({
  interaction,
  checkoutId,
  orderId,
  restoreLoading,
}: RepriceAndUpdateOrderOptions) {
  const repriced = await executeRepriceCheckout({
    interaction,
    checkoutId,
    ...(restoreLoading !== undefined && { restoreLoading }),
  });

  let updatedOrder;
  try {
    updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      {
        $set: repriced.order,
        $inc: { repriceCount: 1 },
      },
      { returnDocument: "after" },
    );
  } catch (error) {
    throw new RepricePersistenceError(
      "Failed to persist repriced checkout.",
      repriced.checkoutId,
      error,
    );
  }

  if (!updatedOrder) {
    throw new RepricePersistenceError(
      "Failed to update repriced order.",
      repriced.checkoutId,
    );
  }

  return {
    ...repriced,
    order: updatedOrder,
  };
}
