import { Order } from "../models/order.model.js";
import { repriceOrder } from "../services/order.service.js";
import { getDiscountPercentage } from "../services/discount.service.js";
import { calculateDiscountedOrderPrice, formatExpiryDate } from "./util.js";
import { errorLog } from "../../logs/printLogs.js";

interface RepriceCheckoutOptions {
  checkoutId: string;
  orderId: typeof Order.prototype._id;
}

export async function repriceCheckout({
  checkoutId,
  orderId,
}: RepriceCheckoutOptions) {
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
        $inc: {
          repriceCount: 1,
        },
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
  } catch (error) {
    throw error;
  }
}
