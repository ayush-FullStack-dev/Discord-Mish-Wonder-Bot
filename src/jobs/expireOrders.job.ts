import cron from "node-cron";
import { Order } from "../models/order.model.js";
import { Card } from "../models/card.model.js";

export function startExpireOrdersJob() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const expiredOrders = await Order.find({
        status: "pending",
        expiresAt: { $lte: new Date() },
        confirming: { $ne: true },
      })
        .select("_id card")
        .populate("card", "_id")
        .lean();

      if (!expiredOrders.length) return;

      const orderIds = expiredOrders.map((order) => order._id);
      const cardIds = [
        ...new Set(
          expiredOrders
            .map((order) => order.card?._id?.toString())
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const deletedOrders = await Order.deleteMany({
        _id: { $in: orderIds },
        status: "pending",
        expiresAt: { $lte: new Date() },
        confirming: { $ne: true },
      });

      if (!deletedOrders.deletedCount || !cardIds.length) return;

      const remainingOrders = await Order.distinct("card", {
        card: { $in: cardIds },
        status: "pending",
      });

      const remainingCardIds = new Set(
        remainingOrders.map((id) => id.toString()),
      );

      const unlockCardIds = cardIds.filter((id) => !remainingCardIds.has(id));

      if (unlockCardIds.length) {
        await Card.updateMany(
          {
            _id: { $in: unlockCardIds },
            isLocked: true,
          },
          { $set: { isLocked: false } },
        );
      }
    } catch {}
  });
}
