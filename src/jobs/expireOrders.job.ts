import cron from "node-cron";
import { Order } from "../models/order.model.js";
import { releaseCardLockIfUnused } from "../services/card.service.js";
import { errorLog } from "../../logs/printLogs.js";

export function startExpireOrdersJob() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const now = new Date();

      const expiredOrders = await Order.find({
        status: "pending",
        expiresAt: { $lte: now },
        confirming: { $ne: true },
      })
        .select("_id card")
        .lean();

      if (!expiredOrders.length) return;

      const orderIds = expiredOrders.map((order) => order._id);
      const cardIds = [
        ...new Set(
          expiredOrders
            .map((order) => order.card?.toString())
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

      for (const cardId of cardIds) {
        await releaseCardLockIfUnused(cardId);
      }
    } catch (error) {
      errorLog("Failed to expire pending orders:", error);
    }
  });
}
