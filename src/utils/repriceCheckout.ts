import type { RepliableInteraction } from "discord.js";
import { Order } from "../models/order.model.js";
import { repriceOrder } from "../services/order.service.js";
import { getDiscountPercentage } from "../services/discount.service.js";
import { calculateDiscountedOrderPrice, formatExpiryDate } from "./util.js";
import { sendLoading } from "../ui/utils/sendLoading.js";

interface RepriceCheckoutOptions {
  interaction: RepliableInteraction;
  checkoutId: string;
  orderId: typeof Order.prototype._id;
  restoreLoading?: {
    title?: string;
    description: string;
    footer?: string;
    ephemeral?: boolean;
  };
}

export async function repriceCheckout({
  interaction,
  checkoutId,
  orderId,
  restoreLoading = {
    title: "Confirming Your Order",
    description: [
      "**Processing Order Confirmation**",
      "",
      "Confirming your order with the provider and processing your wallet payment...",
      "Please wait while we complete the process.",
    ].join("\n"),
    footer: "Do not click confirm again while your order is processing.",
    ephemeral: false,
  },
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
      throw new Error(repriceResult.message || "Failed to reprice checkout.");
    }

    const data = repriceResult.data;
    const appliedDiscountPercentage = await getDiscountPercentage();

    const discountedPrice = calculateDiscountedOrderPrice(
      {
        subtotal: data.price.subtotal,
        service: data.price.service,
        delivery: data.price.delivery,
      },
      appliedDiscountPercentage,
    );

    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      {
        $set: {
          checkoutId: data.id,
          orderId: data.order_id,
          expiresAt: formatExpiryDate(data.expires_in),
          cost: data.price.total,
          total: discountedPrice.total,
          discountPercentage: appliedDiscountPercentage,
          repricedAt: new Date(),
        },
        $inc: { repriceCount: 1 },
      },
      { returnDocument: "after" },
    );

    if (!updatedOrder) {
      throw new Error("Failed to update repriced order.");
    }

    return {
      checkoutId: data.id,
      order: updatedOrder,
    };
  } finally {
    if (restoreLoading) {
      await sendLoading(interaction, restoreLoading);
    }
  }
}
